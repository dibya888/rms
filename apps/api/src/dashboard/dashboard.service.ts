import { Inject, Injectable } from '@nestjs/common';
import { BillStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary(ownerId: string, now = new Date()) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const unresolved: BillStatus[] = [BillStatus.DUE, BillStatus.PARTIAL, BillStatus.LATE];
    const [unitCounts, totalTenants, paidBills, unresolvedBills, currentMonthDueBills, repairs, utilityBills, trendBills, trendRepairs, recentPayments, recentRepairs, recentDue] = await Promise.all([
      transaction.unit.groupBy({ by: ['status'], where: { ownerId, deletedAt: null }, _count: { _all: true } }),
      transaction.tenant.count({ where: { ownerId, deletedAt: null, status: 'ACTIVE' } }),
      transaction.rentBill.findMany({ where: { ownerId, status: BillStatus.PAID, paymentDate: { gte: monthStart, lt: nextMonth } }, select: { houseRent: true, discount: true } }),
      transaction.rentBill.findMany({ where: { ownerId, status: { in: unresolved } }, select: { total: true, paidAmount: true } }),
      transaction.rentBill.findMany({ where: { ownerId, billMonth: { gte: monthStart, lt: nextMonth }, status: { in: unresolved } }, select: { total: true, paidAmount: true } }),
      transaction.repair.aggregate({ where: { ownerId, paidBy: 'OWNER', repairDate: { gte: monthStart, lt: nextMonth } }, _sum: { cost: true } }),
      transaction.rentBill.findMany({ where: { ownerId, status: BillStatus.PAID, paymentDate: { gte: monthStart, lt: nextMonth } }, select: { electricity: true, water: true, gas: true, otherBills: true } }),
      transaction.rentBill.findMany({ where: { ownerId, status: BillStatus.PAID, paymentDate: { gte: sixMonthsAgo, lt: nextMonth } }, select: { paymentDate: true, houseRent: true, discount: true } }),
      transaction.repair.findMany({ where: { ownerId, paidBy: 'OWNER', repairDate: { gte: sixMonthsAgo, lt: nextMonth } }, select: { repairDate: true, cost: true } }),
      transaction.payment.findMany({ where: { ownerId }, include: { bill: { include: { lease: { include: { tenant: true } }, unit: true } } }, orderBy: { paidOn: 'desc' }, take: 8 }),
      transaction.repair.findMany({ where: { ownerId }, orderBy: { repairDate: 'desc' }, take: 8 }),
      transaction.rentBill.findMany({ where: { ownerId, status: { in: unresolved } }, include: { lease: { include: { tenant: true } } }, orderBy: { dueDate: 'asc' }, take: 8 }),
    ]);
    const income = paidBills.reduce((sum, bill) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount))), new Prisma.Decimal(0));
    const outstanding = unresolvedBills.reduce((sum, bill) => sum.add(bill.total.sub(bill.paidAmount)), new Prisma.Decimal(0));
    const monthDue = currentMonthDueBills.reduce((sum, bill) => sum.add(bill.total.sub(bill.paidAmount)), new Prisma.Decimal(0));
    const ownerRepairCost = repairs._sum.cost ?? new Prisma.Decimal(0);
    const utilityBreakdown = utilityBills.reduce((totals, bill) => ({ electricity: totals.electricity.add(bill.electricity), water: totals.water.add(bill.water), gas: totals.gas.add(bill.gas), other: totals.other.add(bill.otherBills) }), { electricity: new Prisma.Decimal(0), water: new Prisma.Decimal(0), gas: new Prisma.Decimal(0), other: new Prisma.Decimal(0) });
    const utilities = utilityBreakdown.electricity.add(utilityBreakdown.water).add(utilityBreakdown.gas).add(utilityBreakdown.other);
    const trend = Array.from({ length: 6 }, (_, index) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const total = trendBills.filter((bill) => bill.paymentDate && bill.paymentDate >= start && bill.paymentDate < end).reduce((sum, bill) => sum.add(Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount))), new Prisma.Decimal(0));
      const repairTotal = trendRepairs.filter((repair) => repair.repairDate >= start && repair.repairDate < end).reduce((sum, repair) => sum.add(repair.cost), new Prisma.Decimal(0));
      return { month: start.toISOString().slice(0, 7), income: total, repair: repairTotal };
    });
    const count = (status: string) => unitCounts.find((item) => item.status === status)?._count._all ?? 0;
    const paymentsWithTenant = recentPayments.map((payment) => ({ id: payment.id, amount: payment.amount, paidOn: payment.paidOn, method: payment.method, tenantName: payment.bill.lease.tenant.name, unitNo: payment.bill.unit.unitNo }));
    return { totalUnits: count('AVAILABLE') + count('OCCUPIED'), occupiedUnits: count('OCCUPIED'), availableUnits: count('AVAILABLE'), totalTenants, thisMonthIncome: income, totalOutstanding: outstanding, thisMonthDue: monthDue, thisMonthOwnerRepairCost: ownerRepairCost, thisMonthUtilityBills: utilities, thisMonthUtilityBreakdown: utilityBreakdown, thisMonthNetProfit: income.sub(ownerRepairCost), monthlyIncomeTrend: trend, recentPayments: paymentsWithTenant, recentRepairs, recentDue };
    });
  }
}
