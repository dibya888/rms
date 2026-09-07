import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BillStatus, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { calculateBillTotal, determineBillStatus } from './billing.rules';
import { GenerateBillsDto, RecordPaymentDto } from './billing.dto';

@Injectable()
export class BillingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listBills(ownerId: string) {
    return this.prisma.withOwner(ownerId, (transaction) => transaction.rentBill.findMany({ where: { ownerId }, include: { lease: { include: { tenant: true } }, unit: { include: { property: true } }, payments: { include: { recordedBy: { select: { id: true, email: true } } }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] } }, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }] }));
  }

  async generateBills(ownerId: string, dto: GenerateBillsDto) {
    const month = new Date(dto.billMonth);
    const billMonth = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const defaults = await transaction.billDefault.findUnique({ where: { ownerId } });
      const dueDay = defaults?.dueDay ?? 5;
      const dueDate = new Date(Date.UTC(billMonth.getUTCFullYear(), billMonth.getUTCMonth(), dueDay));
      const leases = await transaction.leaseAgreement.findMany({ where: { ownerId, status: 'ACTIVE', tenant: { status: 'ACTIVE' }, unit: { status: 'OCCUPIED', deletedAt: null } } });
      let created = 0;
      for (const lease of leases) {
        const existing = await transaction.rentBill.findUnique({ where: { leaseId_billMonth: { leaseId: lease.id, billMonth } } });
        if (existing) continue;
        const electricity = defaults?.electricity ?? new Prisma.Decimal(0);
        const water = defaults?.water ?? new Prisma.Decimal(0);
        const gas = defaults?.gas ?? new Prisma.Decimal(0);
        await transaction.rentBill.create({ data: { ownerId, leaseId: lease.id, unitId: lease.unitId, billMonth, houseRent: lease.monthlyRent, electricity, water, gas, total: calculateBillTotal({ houseRent: lease.monthlyRent, electricity, water, gas, otherBills: 0, fine: 0, discount: 0 }), dueDate, status: BillStatus.DUE } });
        created += 1;
      }
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'MONTH_GENERATED', details: { billMonth, created } } });
      return { billMonth, created };
    });
  }

  async recordPayment(ownerId: string, billId: string, dto: RecordPaymentDto, recordedByUserId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const bill = await transaction.rentBill.findFirst({ where: { id: billId, ownerId }, include: { payments: { orderBy: { paidOn: 'desc' } } } });
      if (!bill) throw new NotFoundException('bill not found');
      const total = calculateBillTotal({ houseRent: bill.houseRent, electricity: dto.electricity ?? bill.electricity, water: dto.water ?? bill.water, gas: dto.gas ?? bill.gas, otherBills: dto.otherBills ?? bill.otherBills, fine: dto.fine ?? bill.fine, discount: dto.discount ?? bill.discount });
      const payment = await transaction.payment.create({ data: { ownerId, billId, amount: new Prisma.Decimal(dto.amount), paidOn: new Date(dto.paidOn), method: dto.method, notes: dto.notes, recordedByUserId } });
      const aggregate = await transaction.payment.aggregate({ where: { billId, ownerId }, _sum: { amount: true } });
      const paidAmount = aggregate._sum.amount ?? new Prisma.Decimal(0);
      const status = determineBillStatus(total, paidAmount, new Date(dto.paidOn), bill.dueDate);
      const receiptNo = status === BillStatus.PAID && !bill.receiptNo ? await this.nextReceipt(transaction, ownerId, new Date(dto.paidOn).getUTCFullYear()) : bill.receiptNo;
      const updated = await transaction.rentBill.update({ where: { id: bill.id }, data: { electricity: dto.electricity ?? bill.electricity, water: dto.water ?? bill.water, gas: dto.gas ?? bill.gas, otherBills: dto.otherBills ?? bill.otherBills, fine: dto.fine ?? bill.fine, discount: dto.discount ?? bill.discount, total, paidAmount, status, paymentDate: status === BillStatus.PAID ? new Date(dto.paidOn) : bill.paymentDate, receiptNo } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: recordedByUserId, action: 'RENT_PAYMENT', details: { billId, amount: dto.amount, status } } });
      return { bill: updated, payment };
    });
  }

  async undoLatestPayment(ownerId: string, billId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const bill = await transaction.rentBill.findFirst({ where: { id: billId, ownerId }, include: { payments: { orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] } } });
      if (!bill) throw new NotFoundException('bill not found');
      if (bill.payments.length === 0) throw new ConflictException('bill has no payments');
      const deletedPayment = bill.payments[0];
      await transaction.payment.delete({ where: { id: deletedPayment.id } });
      const remaining = bill.payments.slice(1);
      const paidAmount = remaining.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
      const latestPaidOn = remaining[0]?.paidOn ?? null;
      const status = determineBillStatus(bill.total, paidAmount, latestPaidOn, bill.dueDate);
      const updated = await transaction.rentBill.update({ where: { id: bill.id }, data: { paidAmount, status, paymentDate: status === BillStatus.PAID ? latestPaidOn : null, receiptNo: status === BillStatus.PAID ? bill.receiptNo : null } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'PAYMENT_DELETED', details: { billId, paymentId: deletedPayment.id, amount: deletedPayment.amount.toString() } } });
      return updated;
    });
  }

    async correctPayment(ownerId: string, paymentId: string, dto: { amount: number; paidOn: string; method: PaymentMethod; notes?: string }, correctedByUserId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const payment = await transaction.payment.findFirst({ where: { id: paymentId, ownerId }, include: { bill: true } });
      if (!payment) throw new NotFoundException('payment not found');

      if (dto.amount <= 0) throw new ConflictException('payment amount must be greater than zero');

      const oldPayment = {
        amount: payment.amount.toString(),
        paidOn: payment.paidOn.toISOString(),
        method: payment.method,
        notes: payment.notes
      };

      const updatedPayment = await transaction.payment.update({
        where: { id: paymentId },
        data: {
          amount: new Prisma.Decimal(dto.amount),
          paidOn: new Date(dto.paidOn),
          method: dto.method,
          notes: dto.notes
        }
      });

      const payments = await transaction.payment.findMany({
        where: { billId: payment.billId, ownerId },
        orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }]
      });

      const paidAmount = payments.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
      const latestPaidOn = payments[0]?.paidOn ?? null;

      const status = determineBillStatus(payment.bill.total, paidAmount, latestPaidOn, payment.bill.dueDate);

      const receiptNo = status === BillStatus.PAID
        ? payment.bill.receiptNo ?? await this.nextReceipt(transaction, ownerId, latestPaidOn?.getUTCFullYear() ?? new Date().getUTCFullYear())
        : null;

      const updatedBill = await transaction.rentBill.update({
        where: { id: payment.billId },
        data: {
          paidAmount,
          status,
          paymentDate: status === BillStatus.PAID ? latestPaidOn : null,
          receiptNo
        }
      });

      await transaction.auditLog.create({
        data: {
          ownerId,
          actorUserId: correctedByUserId,
          action: 'RENT_PAYMENT',
          details: {
            type: 'PAYMENT_CORRECTED',
            paymentId,
            billId: payment.billId,
            oldPayment,
            newPayment: {
              amount: dto.amount,
              paidOn: dto.paidOn,
              method: dto.method,
              notes: dto.notes
            },
            status
          }
        }
      });

      return { bill: updatedBill, payment: updatedPayment };
    });
  }

  async updateDefaults(ownerId: string, values: { electricity: number; water: number; gas: number; dueDay: number }) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const defaults = await transaction.billDefault.upsert({ where: { ownerId }, update: { electricity: new Prisma.Decimal(values.electricity), water: new Prisma.Decimal(values.water), gas: new Prisma.Decimal(values.gas), dueDay: values.dueDay }, create: { ownerId, electricity: new Prisma.Decimal(values.electricity), water: new Prisma.Decimal(values.water), gas: new Prisma.Decimal(values.gas), dueDay: values.dueDay } });
      const bills = await transaction.rentBill.findMany({ where: { ownerId, status: { in: [BillStatus.DUE, BillStatus.PARTIAL, BillStatus.LATE] } } });
      for (const bill of bills) {
        const total = calculateBillTotal({ houseRent: bill.houseRent, electricity: defaults.electricity, water: defaults.water, gas: defaults.gas, otherBills: bill.otherBills, fine: bill.fine, discount: bill.discount });
        await transaction.rentBill.update({ where: { id: bill.id }, data: { electricity: defaults.electricity, water: defaults.water, gas: defaults.gas, total } });
      }
      return defaults;
    });
  }

  private async nextReceipt(transaction: Prisma.TransactionClient, ownerId: string, year: number) {
    const sequence = await transaction.receiptSequence.upsert({ where: { ownerId_year: { ownerId, year } }, update: { nextValue: { increment: 1 } }, create: { ownerId, year, nextValue: 2 } });
    return `RCP-${year}-${String(sequence.nextValue - 1).padStart(6, '0')}`;
  }
}
