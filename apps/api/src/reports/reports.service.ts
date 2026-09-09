import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { BillStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ReportFilterDto } from './reports.dto';
import { buildPdfReport, dateFmt, moneyFmt, PdfColumn } from './pdf-report.builder';

type TransactionRow = {
  id: string; billMonth: Date; property: string; unit: string; tenant: string; status: BillStatus;
  houseRent: Prisma.Decimal; electricity: Prisma.Decimal; water: Prisma.Decimal; gas: Prisma.Decimal;
  otherBills: Prisma.Decimal; discount: Prisma.Decimal; total: Prisma.Decimal; paidAmount: Prisma.Decimal;
  outstanding: Prisma.Decimal; netIncome: Prisma.Decimal; payments: unknown;
};

const TRANSACTION_COLUMNS: PdfColumn<TransactionRow>[] = [
  { key: 'billMonth', header: 'Bill month', width: 70, format: dateFmt },
  { key: 'property', header: 'Property', width: 92 },
  { key: 'unit', header: 'Unit', width: 44 },
  { key: 'tenant', header: 'Tenant', width: 92 },
  { key: 'status', header: 'Status', width: 52 },
  { key: 'total', header: 'Billed', align: 'right', format: moneyFmt },
  { key: 'paidAmount', header: 'Paid', align: 'right', format: moneyFmt },
  { key: 'outstanding', header: 'Outstanding', align: 'right', format: moneyFmt },
  { key: 'netIncome', header: 'Net income', align: 'right', format: moneyFmt },
];

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async exportReport(ownerId: string, reportName: string, format: 'pdf' | 'xlsx', filters: ReportFilterDto) {
    const data = reportName === 'summary' ? await this.summary(ownerId, filters) : reportName === 'transactions' ? await this.transactions(ownerId, filters) : reportName === 'utilities' ? await this.utilities(ownerId, filters) : reportName === 'outstanding' ? await this.outstanding(ownerId, filters) : reportName === 'repairs' ? await this.repairs(ownerId, filters) : reportName.startsWith('income/') ? await this.groupedIncome(ownerId, filters, reportName.slice(7) as 'property' | 'unit' | 'tenant' | 'month' | 'year') : undefined;
    if (data === undefined) throw new NotFoundException('report not found');
    const rows = Array.isArray(data) ? data : 'rows' in data && Array.isArray(data.rows) ? data.rows : [data];

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(reportName.replaceAll('/', '-'));
      sheet.addRows(rows.map((row) => typeof row === 'object' && row !== null ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Prisma.Decimal ? value.toString() : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : value])) : { value: row }));
      const buffer = await workbook.xlsx.writeBuffer();
      await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_EXCEL_EXPORTED', details: { report: reportName, filters: { ...filters } } } }));
      return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer };
    }

    const buffer = await this.renderNamedReportPdf(ownerId, reportName, rows, filters);
    await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_PDF_EXPORTED', details: { report: reportName, filters: { ...filters } } } }));
    return { contentType: 'application/pdf', buffer };
  }

  async transactions(ownerId: string, filters: ReportFilterDto) {
    const bills = await this.prisma.withOwner(ownerId, (transaction) => transaction.rentBill.findMany({ where: this.billWhere(ownerId, filters), include: { lease: { include: { tenant: true } }, unit: { include: { property: true } }, payments: { orderBy: { paidOn: 'asc' } } }, orderBy: { billMonth: 'desc' } }));
    const rows: TransactionRow[] = bills.map((bill) => ({ id: bill.id, billMonth: bill.billMonth, property: bill.unit.property.name, unit: bill.unit.unitNo, tenant: bill.lease.tenant.name, status: bill.status, houseRent: bill.houseRent, electricity: bill.electricity, water: bill.water, gas: bill.gas, otherBills: bill.otherBills, discount: bill.discount, total: bill.total, paidAmount: bill.paidAmount, outstanding: bill.total.sub(bill.paidAmount), netIncome: bill.status === BillStatus.PAID ? Prisma.Decimal.max(new Prisma.Decimal(0), bill.houseRent.sub(bill.discount)) : new Prisma.Decimal(0), payments: bill.payments }));
    return { rows, totals: { netIncome: rows.reduce((sum, row) => sum.add(row.netIncome), new Prisma.Decimal(0)), totalBilled: rows.reduce((sum, row) => sum.add(row.total), new Prisma.Decimal(0)), totalPaid: rows.reduce((sum, row) => sum.add(row.paidAmount), new Prisma.Decimal(0)), outstanding: rows.reduce((sum, row) => sum.add(row.outstanding), new Prisma.Decimal(0)) } };
  }

  async excel(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Transactions');
    sheet.columns = [{ header: 'Bill month', key: 'billMonth', width: 16 }, { header: 'Property', key: 'property', width: 24 }, { header: 'Unit', key: 'unit', width: 12 }, { header: 'Tenant', key: 'tenant', width: 24 }, { header: 'Status', key: 'status', width: 12 }, { header: 'Billed', key: 'total', width: 14 }, { header: 'Paid', key: 'paidAmount', width: 14 }, { header: 'Net house income', key: 'netIncome', width: 18 }, { header: 'Outstanding', key: 'outstanding', width: 18 }];
    for (const row of report.rows) sheet.addRow({ billMonth: row.billMonth.toISOString().slice(0, 10), property: row.property, unit: row.unit, tenant: row.tenant, status: row.status, total: Number(row.total), paidAmount: Number(row.paidAmount), netIncome: Number(row.netIncome), outstanding: Number(row.outstanding) });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '315B47' } };
    sheet.addRow({}); sheet.addRow({ property: 'Totals', total: Number(report.totals.totalBilled), paidAmount: Number(report.totals.totalPaid), netIncome: Number(report.totals.netIncome), outstanding: Number(report.totals.outstanding) });
    sheet.getRow(sheet.rowCount).font = { bold: true };
    const buffer = await workbook.xlsx.writeBuffer();
    await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_EXCEL_EXPORTED', details: { filters: { ...filters } } } }));
    return buffer;
  }

  async pdf(ownerId: string, filters: ReportFilterDto) {
    const report = await this.transactions(ownerId, filters);
    const buffer = await buildPdfReport<TransactionRow>({
      title: 'Transactions Report',
      subtitle: 'Owner-scoped billing and collection history',
      ownerName: await this.ownerName(ownerId),
      filters: this.filterSummary(filters),
      orientation: 'landscape',
      columns: TRANSACTION_COLUMNS,
      rows: report.rows,
      totals: [
        { label: 'Total billed', value: moneyFmt(report.totals.totalBilled) },
        { label: 'Total collected', value: moneyFmt(report.totals.totalPaid) },
        { label: 'Outstanding balance', value: moneyFmt(report.totals.outstanding) },
        { label: 'Net house-rent income', value: moneyFmt(report.totals.netIncome) },
      ],
      emptyMessage: 'No bills match the selected filters.',
    });
    await this.prisma.withOwner(ownerId, (transaction) => transaction.auditLog.create({ data: { ownerId, actorUserId: ownerId, action: 'REPORT_PDF_EXPORTED', details: { filters: { ...filters } } } }));
    return buffer;
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

  private async ownerName(ownerId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { fullName: true } });
    return user?.fullName;
  }

  private filterSummary(filters: ReportFilterDto): string[] {
    const parts: string[] = [];
    // PDFKit's built-in Helvetica only supports WinAnsi/CP1252, which has no
    // arrow glyph (→) — it silently prints mangled fallback characters
    // instead. Stick to plain ASCII for anything that ends up in the PDF.
    if (filters.dateFrom || filters.dateTo) parts.push(`${filters.dateFrom ?? 'earliest'} to ${filters.dateTo ?? 'latest'}`);
    if (filters.status) parts.push(`Status: ${filters.status}`);
    if (filters.search) parts.push(`Search: "${filters.search}"`);
    return parts.length ? parts : ['All records'];
  }

  private async renderNamedReportPdf(ownerId: string, reportName: string, rows: unknown[], filters: ReportFilterDto): Promise<Buffer> {
    const ownerName = await this.ownerName(ownerId);
    const filterSummary = this.filterSummary(filters);
    const base = { ownerName, filters: filterSummary };

    if (reportName === 'transactions') {
      const transactionRows = rows as TransactionRow[];
      const totals = transactionRows.reduce((sum, row) => ({ billed: sum.billed.add(row.total), paid: sum.paid.add(row.paidAmount), outstanding: sum.outstanding.add(row.outstanding), net: sum.net.add(row.netIncome) }), { billed: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), outstanding: new Prisma.Decimal(0), net: new Prisma.Decimal(0) });
      return buildPdfReport<TransactionRow>({ ...base, title: 'Transactions Report', subtitle: 'Owner-scoped billing and collection history', orientation: 'landscape', columns: TRANSACTION_COLUMNS, rows: transactionRows, totals: [{ label: 'Total billed', value: moneyFmt(totals.billed) }, { label: 'Total collected', value: moneyFmt(totals.paid) }, { label: 'Outstanding balance', value: moneyFmt(totals.outstanding) }, { label: 'Net house-rent income', value: moneyFmt(totals.net) }], emptyMessage: 'No bills match the selected filters.' });
    }

    if (reportName === 'summary') {
      const summaryRow = rows[0] as { netIncome: Prisma.Decimal; totalBilled: Prisma.Decimal; totalPaid: Prisma.Decimal; outstanding: Prisma.Decimal; billCount: number };
      const metricRows = [
        { metric: 'Bills in range', value: String(summaryRow.billCount) },
        { metric: 'Total billed', value: moneyFmt(summaryRow.totalBilled) },
        { metric: 'Total collected', value: moneyFmt(summaryRow.totalPaid) },
        { metric: 'Outstanding balance', value: moneyFmt(summaryRow.outstanding) },
        { metric: 'Net house-rent income', value: moneyFmt(summaryRow.netIncome) },
      ];
      return buildPdfReport({ ...base, title: 'Summary Report', subtitle: 'Portfolio-wide totals for the selected period', columns: [{ key: 'metric', header: 'Metric', width: 260 }, { key: 'value', header: 'Value', align: 'right' }], rows: metricRows });
    }

    if (reportName === 'utilities') {
      return buildPdfReport({ ...base, title: 'Utilities Report', subtitle: 'Electricity, water, gas, and other billed charges', columns: [{ key: 'billMonth', header: 'Bill month', width: 80, format: dateFmt }, { key: 'property', header: 'Property', width: 130 }, { key: 'unit', header: 'Unit', width: 60 }, { key: 'tenant', header: 'Tenant', width: 130 }, { key: 'status', header: 'Status', width: 60 }, { key: 'utilities', header: 'Utilities', align: 'right', format: moneyFmt }], rows: rows as Record<string, unknown>[], emptyMessage: 'No bills match the selected filters.' });
    }

    if (reportName === 'outstanding') {
      const outstandingRows = rows as { outstanding: Prisma.Decimal }[];
      const total = outstandingRows.reduce((sum, row) => sum.add(row.outstanding), new Prisma.Decimal(0));
      return buildPdfReport({ ...base, title: 'Outstanding Balances', subtitle: 'Bills with an unpaid amount as of today', columns: [{ key: 'billMonth', header: 'Bill month', width: 90, format: dateFmt }, { key: 'property', header: 'Property', width: 150 }, { key: 'unit', header: 'Unit', width: 70 }, { key: 'tenant', header: 'Tenant', width: 150 }, { key: 'outstanding', header: 'Outstanding', align: 'right', format: moneyFmt }], rows: rows as Record<string, unknown>[], totals: [{ label: 'Total outstanding', value: moneyFmt(total) }], emptyMessage: 'Nothing outstanding — every bill in range is fully paid.' });
    }

    if (reportName === 'repairs') {
      type RepairRow = { repairDate: Date; unit: { unitNo: string; property: { name: string } }; category: string; description: string; cost: Prisma.Decimal; status: string };
      const repairRows = rows as RepairRow[];
      const flattened = repairRows.map((repair) => ({ repairDate: repair.repairDate, property: repair.unit.property.name, unit: repair.unit.unitNo, category: repair.category, description: repair.description, cost: repair.cost, status: repair.status }));
      const totalCost = repairRows.reduce((sum, repair) => sum.add(repair.cost), new Prisma.Decimal(0));
      return buildPdfReport({ ...base, title: 'Repairs & Maintenance Report', subtitle: 'Logged repair work and cost across the portfolio', columns: [{ key: 'repairDate', header: 'Date', width: 62, format: dateFmt }, { key: 'property', header: 'Property', width: 88 }, { key: 'unit', header: 'Unit', width: 44 }, { key: 'category', header: 'Category', width: 78 }, { key: 'description', header: 'Description', width: 152 }, { key: 'status', header: 'Status', width: 60 }, { key: 'cost', header: 'Cost', align: 'right', format: moneyFmt }], rows: flattened, orientation: 'landscape', totals: [{ label: 'Total repair cost', value: moneyFmt(totalCost) }], emptyMessage: 'No repairs logged for the selected filters.' });
    }

    if (reportName.startsWith('income/')) {
      const group = reportName.slice(7);
      const groupLabel = group === 'property' ? 'Property' : group === 'unit' ? 'Unit' : group === 'tenant' ? 'Tenant' : group === 'year' ? 'Year' : 'Month';
      const incomeRows = rows as { key: string; netIncome: Prisma.Decimal }[];
      const total = incomeRows.reduce((sum, row) => sum.add(row.netIncome), new Prisma.Decimal(0));
      return buildPdfReport({ ...base, title: `Income by ${groupLabel}`, subtitle: 'Net house-rent income for the selected period', columns: [{ key: 'key', header: groupLabel, width: 320 }, { key: 'netIncome', header: 'Net income', align: 'right', format: moneyFmt }], rows: incomeRows, totals: [{ label: 'Total net income', value: moneyFmt(total) }], emptyMessage: 'No income to report for the selected filters.' });
    }

    return buildPdfReport({ ...base, title: 'RMS Report', columns: [{ key: 'value', header: 'Value' }], rows: [] });
  }

  private billWhere(ownerId: string, filters: ReportFilterDto): Prisma.RentBillWhereInput {
    const search = filters.search ? [
      { lease: { tenant: { name: { contains: filters.search, mode: 'insensitive' as const } } } },
      { unit: { unitNo: { contains: filters.search, mode: 'insensitive' as const } } },
    ] : undefined;
    return { ownerId, billMonth: { gte: filters.dateFrom ? new Date(filters.dateFrom) : undefined, lte: filters.dateTo ? new Date(filters.dateTo) : undefined }, status: filters.status, unitId: filters.unitId, lease: { tenantId: filters.tenantId }, unit: { propertyId: filters.propertyId }, OR: search };
  }
}
