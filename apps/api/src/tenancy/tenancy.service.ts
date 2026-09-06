import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { calculateSettlement } from '../billing/billing.rules';
import { StorageService } from '../storage.service';
import { CreateTenantDto, MoveOutDto, SettleDto } from './tenancy.dto';

@Injectable()
export class TenancyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(StorageService) private readonly storage: StorageService) {}

  listTenants(ownerId: string) {
    return this.prisma.withOwner(ownerId, (transaction) => transaction.tenant.findMany({ where: { ownerId, deletedAt: null }, include: { unit: { include: { property: true } }, leases: { orderBy: { startDate: 'desc' } } }, orderBy: { createdAt: 'desc' } }));
  }

  async createTenant(ownerId: string, dto: CreateTenantDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const unit = await transaction.unit.findFirst({ where: { id: dto.unitId, ownerId, deletedAt: null } });
      if (!unit) throw new NotFoundException('unit not found');
      if (unit.status !== 'AVAILABLE') throw new ConflictException('unit already has an active tenant');

      const tenant = await transaction.tenant.create({
        data: {
          ownerId,
          unitId: unit.id,
          name: dto.name.trim(),
          phone: dto.phone.trim(),
          email: dto.email?.trim().toLowerCase(),
          nationalId: dto.nationalId?.trim(),
          address: dto.address.trim(),
          moveInDate: new Date(dto.moveInDate),
          leases: { create: { ownerId, unitId: unit.id, monthlyRent: new Prisma.Decimal(dto.monthlyRent), securityDeposit: new Prisma.Decimal(dto.securityDeposit), depositDate: dto.depositDate ? new Date(dto.depositDate) : undefined, depositNote: dto.depositNote, startDate: new Date(dto.moveInDate) } },
        },
        include: { leases: true, unit: true },
      });
      await transaction.unit.update({ where: { id: unit.id }, data: { status: 'OCCUPIED' } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'TENANT_ADDED', details: { tenantId: tenant.id, unitId: unit.id } } });
      return tenant;
    });
  }

  async moveOut(ownerId: string, tenantId: string, dto: MoveOutDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const tenant = await transaction.tenant.findFirst({ where: { id: tenantId, ownerId, status: 'ACTIVE', deletedAt: null }, include: { leases: { where: { status: 'ACTIVE' } }, unit: true } });
      if (!tenant || !tenant.unit || tenant.leases.length === 0) throw new NotFoundException('active tenant not found');
      const settlement = await this.calculateForLease(transaction, ownerId, tenant.id, tenant.leases[0].id);
      await transaction.tenant.update({ where: { id: tenant.id }, data: { status: 'MOVED_OUT', unitId: null, moveOutDate: new Date(dto.moveOutDate), moveOutReason: dto.moveOutReason.trim() } });
      await transaction.leaseAgreement.updateMany({ where: { ownerId, tenantId: tenant.id, status: 'ACTIVE' }, data: { status: 'ENDED', endDate: new Date(dto.moveOutDate) } });
      await transaction.unit.update({ where: { id: tenant.unit.id }, data: { status: 'AVAILABLE' } });
      const persistedSettlement = await transaction.moveOutSettlement.create({ data: { ownerId, tenantId: tenant.id, unitId: tenant.unit.id, moveOutDate: new Date(dto.moveOutDate), unpaidDue: settlement.unpaidDue, securityDeposit: settlement.securityDeposit, refundAmount: settlement.refundAmount, payableAmount: settlement.payableAmount, result: settlement.result, reason: dto.moveOutReason.trim() } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'TENANT_MOVED_OUT', details: { tenantId: tenant.id, unitId: tenant.unit.id } } });
      return { tenantId: tenant.id, unitId: tenant.unit.id, settlementId: persistedSettlement.id, status: 'MOVED_OUT' as const, settlement };
    });
  }

  async previewSettlement(ownerId: string, tenantId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const tenant = await transaction.tenant.findFirst({ where: { id: tenantId, ownerId, deletedAt: null }, include: { unit: true, leases: { where: { status: { in: ['ACTIVE', 'ENDED'] } }, orderBy: { startDate: 'desc' }, take: 1 } } });
      if (!tenant || !tenant.unit || tenant.leases.length === 0) throw new NotFoundException('tenant lease not found');
      return this.calculateForLease(transaction, ownerId, tenant.id, tenant.leases[0].id);
    });
  }

  async settle(ownerId: string, settlementId: string, dto: SettleDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const current = await transaction.moveOutSettlement.findFirst({ where: { id: settlementId, ownerId } });
      if (!current) throw new NotFoundException('settlement not found');
      const updated = await transaction.moveOutSettlement.update({ where: { id: current.id }, data: { result: dto.result, refundAmount: new Prisma.Decimal(dto.refundAmount), payableAmount: new Prisma.Decimal(dto.payableAmount), reason: `${current.reason ?? ''}\n${dto.reason}`.trim(), settledAt: new Date() } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'SETTLEMENT_SETTLED', details: { settlementId } } });
      return updated;
    });
  }

  async uploadIdDocument(ownerId: string, tenantId: string, file: Express.Multer.File) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const tenant = await transaction.tenant.findFirst({ where: { id: tenantId, ownerId, deletedAt: null } });
      if (!tenant) throw new NotFoundException('tenant not found');
      const path = await this.storage.saveTenantDocument(ownerId, tenantId, file);
      const updated = await transaction.tenant.update({ where: { id: tenantId }, data: { idDocumentPath: path } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'TENANT_UPDATED', details: { tenantId, documentUploaded: true } } });
      return updated;
    });
  }

  private async calculateForLease(transaction: Prisma.TransactionClient, ownerId: string, tenantId: string, leaseId: string) {
    const bills = await transaction.rentBill.findMany({ where: { ownerId, leaseId, status: { in: ['DUE', 'PARTIAL', 'LATE'] } } });
    const lease = await transaction.leaseAgreement.findUniqueOrThrow({ where: { id: leaseId } });
    return calculateSettlement(bills.map((bill) => bill.total.sub(bill.paidAmount)), lease.securityDeposit);
  }
}
