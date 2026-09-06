import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PropertyType, UnitType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CreatePropertyDto, CreateUnitDto, UpdatePropertyDto, UpdateUnitDto } from './portfolio.dto';

@Injectable()
export class PortfolioService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listProperties(ownerId: string) {
    return this.prisma.withOwner(ownerId, (transaction) => transaction.property.findMany({ where: { ownerId, deletedAt: null }, include: { units: { where: { deletedAt: null } } }, orderBy: { createdAt: 'desc' } }));
  }

  createProperty(ownerId: string, dto: CreatePropertyDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const property = await transaction.property.create({ data: { ...dto, ownerId } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'PROPERTY_ADDED', details: { propertyId: property.id } } });
      return property;
    });
  }

  async updateProperty(ownerId: string, propertyId: string, dto: UpdatePropertyDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      await this.requireProperty(transaction, ownerId, propertyId);
      const property = await transaction.property.update({ where: { id: propertyId }, data: dto });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'PROPERTY_UPDATED', details: { propertyId } } });
      return property;
    });
  }

  async deleteProperty(ownerId: string, propertyId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      await this.requireProperty(transaction, ownerId, propertyId);
      const property = await transaction.property.update({ where: { id: propertyId }, data: { deletedAt: new Date() } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'PROPERTY_DELETED', details: { propertyId } } });
      return property;
    });
  }

  async listUnits(ownerId: string, propertyId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      await this.requireProperty(transaction, ownerId, propertyId);
      return transaction.unit.findMany({ where: { ownerId, propertyId, deletedAt: null }, orderBy: { unitNo: 'asc' } });
    });
  }

  async createUnit(ownerId: string, propertyId: string, dto: CreateUnitDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      await this.requireProperty(transaction, ownerId, propertyId);
      this.validateAttributes(dto.unitType, dto.unitAttributes);
      try {
        const unit = await transaction.unit.create({ data: { ownerId, propertyId, unitNo: dto.unitNo.trim(), unitType: dto.unitType, rent: new Prisma.Decimal(dto.rent), unitAttributes: dto.unitAttributes as Prisma.InputJsonObject } });
        await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'UNIT_ADDED', details: { unitId: unit.id } } });
        return unit;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('unit number already exists in this property');
        throw error;
      }
    });
  }

  async updateUnit(ownerId: string, unitId: string, dto: UpdateUnitDto) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const unit = await transaction.unit.findFirst({ where: { id: unitId, ownerId, deletedAt: null } });
      if (!unit) throw new NotFoundException('unit not found');
      const attributes = dto.unitAttributes ?? unit.unitAttributes;
      this.validateAttributes(unit.unitType, attributes as Record<string, unknown>);
      const updated = await transaction.unit.update({ where: { id: unitId }, data: { ...dto, rent: dto.rent === undefined ? undefined : new Prisma.Decimal(dto.rent), unitAttributes: attributes as Prisma.InputJsonObject } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'UNIT_UPDATED', details: { unitId } } });
      return updated;
    });
  }

  async deleteUnit(ownerId: string, unitId: string) {
    return this.prisma.withOwner(ownerId, async (transaction) => {
      const unit = await transaction.unit.findFirst({ where: { id: unitId, ownerId, deletedAt: null } });
      if (!unit) throw new NotFoundException('unit not found');
      if (unit.status === 'OCCUPIED') throw new ConflictException('occupied units cannot be deleted');
      const deleted = await transaction.unit.update({ where: { id: unitId }, data: { deletedAt: new Date() } });
      await transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'UNIT_DELETED', details: { unitId } } });
      return deleted;
    });
  }

  private async requireProperty(transaction: Prisma.TransactionClient, ownerId: string, propertyId: string) {
    const property = await transaction.property.findFirst({ where: { id: propertyId, ownerId, deletedAt: null } });
    if (!property) throw new NotFoundException('property not found');
    return property;
  }

  private validateAttributes(unitType: UnitType, attributes: Record<string, unknown>) {
    const required = unitType === UnitType.FLAT ? ['bedrooms', 'bathrooms'] : ['floor', 'frontageSqft', 'category'];
    if (required.some((key) => attributes[key] === undefined)) throw new ConflictException(`${unitType} unitAttributes are missing required fields`);
  }
}
