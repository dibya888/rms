import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { BillStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ReportFilterDto } from './reports.dto';

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async transactions(ownerId: string, filters: ReportFilterDto) {
    const bills = await this.prisma.withOwner(ownerId, (transaction) => transaction.rentBill.findMany({ where: this.billWhere(ownerId, filters), include: { lease: { include: { tenant: true } }, unit: { include: { property: true } }, payments: { orderBy: { paidOn: 'asc' } } }, orderBy: { billMonth: 'desc' } }));
    const rows = bills.map((bill) => ({ id: bill.id, billMonth: bill.billMonth, property: bill.unit.property.name, unit: bill.unit.unitNo, tenant: bill.lease.tenant.name, status: bill.status, houseRent: bill.houseRent, electricity: bill.electricity, water: bill.water, gas: bill.gas, otherBills: bill.otherBills, discount: bill.discount, total: bill.total, paidAmount: bill.paidAmount, outstanding: bill.total.sub(bill.paidAmount), netIncome: bill.status === BillStatus.PAID ? Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount)) : new Prisma.Decimal(0), payments: bill.payments }));
    return { rows, totals: { netIncome: rows.reduce((sum, row) => sum.add(row.netIncome), new Prisma.Decimal(0)), totalBilled: rows.reduce((sum, row) => sum.add(row.total), new Prisma.Decimal(0)), totalPaid: rows.reduce((sum, row) => sum.add(row.paidAmount), new Prisma.Decimal(0)), outstanding: rows.reduce((sum, row) => sum.add(row.outstanding), new Prisma.Decimal(0)) } };
  }

  async excel(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transactions');
    sheet.columns = [{ header: 'Bill month', key: 'billMonth', width: 16 }, { header: 'Property', key: 'property', width: 24 }, { header: 'Unit', key: 'unit', width: 12 }, { header: 'Tenant', key: 'tenant', width: 24 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Net house income', key: 'netIncome', width: 18 }, { header: 'Outstanding', key: 'outstanding', width: 18 }];
    for (const row of report.rows) sheet.addRow({ billMonth: row.billMonth.toISOString().slice(0, 10), property: row.property, unit: row.unit, tenant: row.tenant, status: row.status, netIncome: Number(row.netIncome), outstanding: Number(row.outstanding) });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '315B47' } };
    sheet.addRow({}); sheet.addRow({ property: 'Totals', netIncome: Number(report.totals.netIncome), outstanding: Number(report.totals.outstanding) });
    const buffer = await workbook.xlsx.writeBuffer();
    await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_EXCEL_EXPORTED', details: { filters: { ...filters } } } }));
    return buffer;
  }

  async pdf(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    return new Promise<Buffer>((resolve, reject) => { const document = new PDFDocument({ margin: 48 }); const chunks: Buffer[] = []; document.on('data', (chunk) => chunks.push(chunk)); document.on('end', async () => { try { await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_PDF_EXPORTED', details: { filters: { ...filters } } } })); resolve(Buffer.concat(chunks)); } catch (error) { reject(error); } }); document.on('error', reject); document.fontSize(20).fillColor('#315B47').text('RMS transaction report'); document.moveDown(.5).fontSize(9).fillColor('#52615B').text(`Net house-rent income: ${report.totals.netIncome.toFixed(2)}   Outstanding: ${report.totals.outstanding.toFixed(2)}`); document.moveDown(); report.rows.slice(0, 40).forEach((row) => document.fontSize(9).fillColor('#18211F').text(`${row.billMonth.toISOString().slice(0, 10)}  ${row.property} / ${row.unit}  ${row.tenant}  ${row.status}  income ${row.netIncome.toFixed(2)}  open ${row.outstanding.toFixed(2)}`)); document.end(); });
  }

  async summary(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    return { ...report.totals, billCount: report.rows.length };
  }

  async utilities(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    return report.rows.map((row) => ({ billMonth: row.billMonth, property: row.property, unit: row.unit, tenant: row.tenant, status: row.status, utilities: row.electricity.add(row.water).add(row.gas).add(row.otherBills) }));
  }

  async outstanding(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, { ...filters, status: undefined });
    return report.rows.filter((row) => row.outstanding.gt(0)).map((row) => ({ billMonth: row.billMonth, property: row.property, unit: row.unit, tenant: row.tenant, outstanding: row.outstanding }));
  }

  async groupedIncome(ownerId: string, filters: ReportFilterDto, group: 'property' | 'unit' | 'tenant' | 'month' | 'year') {
    const report = await this.transactions(ownerId, filters);
    const groups = new Map<string, Prisma.Decimal>();
    for (const row of report.rows) {
      const key = group === 'property' ? row.property : group === 'unit' ? `${row.property} / ${row.unit}` : group === 'tenant' ? row.tenant : group === 'year' ? String(row.billMonth.getUTCFullYear()) : row.billMonth.toISOString().slice(0, 7);
      groups.set(key, (groups.get(key) ?? new Prisma.Decimal(0)).add(row.netIncome));
    }
    return [...groups.entries()].map(([key, netIncome]) => ({ key, netIncome }));
  }

  async repairs(ownerId: string, filters: ReportFilterDto) {
    return this.prisma.withOwner(ownerId, (transaction) => transaction.repair.findMany({ where: { ownerId, repairDate: { gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined, lte: filters.dateTo ? new Date(filters.dateTo) : undefined }, unit: { propertyId: filters.propertyId } }, include: { unit: { include: { property: true } } }, orderBy: { repairDate: 'desc' } }));
  }

  private billWhere(ownerId: string, filters: ReportFilterDto): Prisma.RentBillWhereInput {
    const search = filters.search ? [
      { lease: { tenant: { name: { contains: filters.search, mode: 'insensitive' as const } } } },
      { unit: { unitNo: { contains: filters.search, mode: 'insensitive' as const } } },
    ] : undefined;
    return { ownerId, billMonth: { gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined, lte: filters.dateTo ? new Date(filters.dateTo) : undefined }, status: filters.status, unitId: filters.unitId, lease: { tenantId: filters.tenantId }, unit: { propertyId: filters.propertyId }, OR: search };
  }
}
