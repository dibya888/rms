import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RepairPaidBy } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreateRepairDto, UpdateRepairDto } from './repairs.dto';

@Injectable()
export class RepairsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(ownerId: string) {
    return this.prisma.withOwner(ownerId, (transaction) => transaction.repair.findMany({ where: { ownerId }, include: { unit: { include: { property: true } } }, orderBy: { repairDate: 'desc' } }));
  }

  async create(ownerId: string, dto: CreateRepairDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const unit = await transaction.unit.findFirst({ where: { id: dto.unitId, ownerId, deletedAt: null } });
      if (!unit) throw new NotFoundException('unit not found');
      const repair = await transaction.repair.create({ data: { ownerId, unitId: dto.unitId, repairDate: new Date(dto.repairDate), category: dto.category.trim(), description: dto.description.trim(), cost: new Prisma.Decimal(dto.cost), paidBy: dto.paidBy, status: dto.status, vendorName: dto.vendorName?.trim(), vendorPhone: dto.vendorPhone?.trim(), invoiceNo: dto.invoiceNo?.trim() } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPAIR_ADDED', details: { repairId: repair.id, paidBy: dto.paidBy } } });
      return repair;
    });
  }

  async update(ownerId: string, repairId: string, dto: UpdateRepairDto) {
    const repair = await this.prisma.withOwner(ownerId, async (transaction) => {
      const existing = await transaction.repair.findFirst({ where: { id: repairId, ownerId } });
      if (!existing) throw new NotFoundException('repair not found');
      const updated = await transaction.repair.update({ where: { id: repairId }, data: { ...dto, repairDate: dto.repairDate ? new Date(dto.repairDate) : undefined, cost: dto.cost === undefined ? undefined : new Prisma.Decimal(dto.cost) } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPAIR_UPDATED', details: { repairId } } });
      return updated;
    });
    return repair;
  }

  async remove(ownerId: string, repairId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const existing = await transaction.repair.findFirst({ where: { id: repairId, ownerId } });
      if (!existing) throw new NotFoundException('repair not found');
      const deleted = await transaction.repair.delete({ where: { id: repairId } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPAIR_DELETED', details: { repairId } } });
      return deleted;
    });
  }
}
