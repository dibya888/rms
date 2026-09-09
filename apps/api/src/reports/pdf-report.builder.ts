import PDFDocument from 'pdfkit';
import { RMS_ICON_BASE64 } from './rms-icon';

const BRAND = '#315B47';
const BRAND_DARK = '#20362A';
const TEXT = '#1C2622';
const MUTED = '#5B6B63';
const STRIPE = '#F2F6F1';
const BORDER = '#DCE4DC';
const HEADER_TEXT = '#F7FBF7';

const ICON_BUFFER = Buffer.from(RMS_ICON_BASE64, 'base64');

export type PdfAlign = 'left' | 'right' | 'center';

export interface PdfColumn<Row = Record<string, unknown>> {
  key: string;
  header: string;
  width?: number;
  align?: PdfAlign;
  format?: (value: unknown, row: Row) => string;
}

export interface PdfTotal {
  label: string;
  value: string;
}

export interface PdfReportOptions<Row = Record<string, unknown>> {
  title: string;
  subtitle?: string;
  ownerName?: string;
  generatedAt?: Date;
  filters?: string[];
  columns: PdfColumn<Row>[];
  rows: Row[];
  totals?: PdfTotal[];
  orientation?: 'portrait' | 'landscape';
  emptyMessage?: string;
}

/** Renders a filtered dataset into a clean, branded, paginated PDF report and resolves the finished buffer. */
export function buildPdfReport<Row = Record<string, unknown>>(options: PdfReportOptions<Row>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: options.orientation ?? 'portrait', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const left = doc.page.margins.left;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const footerLimit = doc.page.height - doc.page.margins.bottom;

    const explicitWidth = options.columns.reduce((sum, col) => sum + (col.width ?? 0), 0);
    const flexColumns = options.columns.filter((col) => !col.width).length;
    const flexWidth = flexColumns ? Math.max(0, pageWidth - explicitWidth) / flexColumns : 0;
    const widths = options.columns.map((col) => col.width ?? flexWidth);

    const headerRowHeight = 22;
    const rowHeight = 20;
    const cellPad = 6;

    function drawPageHeader() {
      const top = doc.page.margins.top;
      const bandHeight = 44;
      doc.rect(left - doc.page.margins.left, 0, doc.page.width, bandHeight).fill(BRAND);
      doc.image(ICON_BUFFER, left, (bandHeight - 26) / 2, { width: 26, height: 26 });
      doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(12).text('RMS', left + 34, bandHeight / 2 - 12);
      doc.fillColor('#CFE0D3').font('Helvetica').fontSize(7.5).text('RENT MANAGEMENT SYSTEM', left + 34, bandHeight / 2 + 2, { characterSpacing: 0.6 });
      doc.fillColor(HEADER_TEXT).font('Helvetica-Bold').fontSize(15).text(options.title, left, bandHeight / 2 - 16, { width: pageWidth, align: 'right' });
      if (options.subtitle) {
        doc.fillColor('#CFE0D3').font('Helvetica').fontSize(8.5).text(options.subtitle, left, bandHeight / 2 + 2, { width: pageWidth, align: 'right' });
      }

      doc.y = top + bandHeight - 4;
      const metaBits = [options.ownerName ? `Prepared for ${options.ownerName}` : null, `Generated ${(options.generatedAt ?? new Date()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`].filter(Boolean);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(metaBits.join('   •   '), left, doc.y, { width: pageWidth });
      if (options.filters?.length) {
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8).text(`Filters: ${options.filters.join('   •   ')}`, left, doc.y + 2, { width: pageWidth });
      }

      doc.moveDown(1);
      const ruleY = doc.y;
      doc.moveTo(left, ruleY).lineTo(left + pageWidth, ruleY).strokeColor(BORDER).lineWidth(1).stroke();
      doc.y = ruleY + 14;
    }

    function drawTableHeader(): number {
      const y = doc.y;
      doc.rect(left, y, pageWidth, headerRowHeight).fill(BRAND);
      let x = left;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(HEADER_TEXT);
      for (let i = 0; i < options.columns.length; i++) {
        const col = options.columns[i];
        doc.text(col.header.toUpperCase(), x + cellPad, y + 7, { width: widths[i] - cellPad * 2, align: col.align ?? 'left', characterSpacing: 0.3 });
        x += widths[i];
      }
      return y + headerRowHeight;
    }

    function ensureSpace(y: number, needed: number): number {
      if (y + needed <= footerLimit - 22) return y;
      doc.addPage();
      drawPageHeader();
      return drawTableHeader();
    }

    drawPageHeader();
    let y = drawTableHeader();

    if (!options.rows.length) {
      doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9.5).text(options.emptyMessage ?? 'No records match the selected filters.', left, y + 16, { width: pageWidth, align: 'center' });
      y += 40;
    }

    options.rows.forEach((row, index) => {
      y = ensureSpace(y, rowHeight);
      if (index % 2 === 1) doc.rect(left, y, pageWidth, rowHeight).fill(STRIPE);
      let x = left;
      doc.font('Helvetica').fontSize(8.3).fillColor(TEXT);
      for (let i = 0; i < options.columns.length; i++) {
        const col = options.columns[i];
        const raw = (row as Record<string, unknown>)[col.key];
        const text = col.format ? col.format(raw, row) : raw === null || raw === undefined ? '' : String(raw);
        doc.text(text, x + cellPad, y + 5.5, { width: widths[i] - cellPad * 2, align: col.align ?? 'left', ellipsis: true, lineBreak: false });
        x += widths[i];
      }
      doc.moveTo(left, y + rowHeight).lineTo(left + pageWidth, y + rowHeight).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += rowHeight;
    });

    if (options.totals?.length) {
      y = ensureSpace(y, options.totals.length * 16 + 18);
      y += 8;
      doc.moveTo(left, y).lineTo(left + pageWidth, y).strokeColor(BRAND).lineWidth(1.1).stroke();
      y += 8;
      for (const total of options.totals) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND_DARK).text(total.label, left, y, { width: pageWidth * 0.72, align: 'right' });
        doc.text(total.value, left + pageWidth * 0.72, y, { width: pageWidth * 0.28, align: 'right' });
        y += 16;
      }
    }

    const range = doc.bufferedPageRange();
    const savedBottomMargin = doc.page.margins.bottom;
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Footer sits inside the bottom margin band by design. Writing there
      // normally trips pdfkit's automatic page-break check (it thinks the
      // content overflowed the page and silently inserts a blank page), so
      // the margin is zeroed for just these two calls, then restored.
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - savedBottomMargin + 10;
      doc.moveTo(left, footerY - 6).lineTo(left + pageWidth, footerY - 6).strokeColor(BORDER).lineWidth(0.75).stroke();
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
        .text('Generated by RMS · Rent Management System', left, footerY, { width: pageWidth / 2, align: 'left', lineBreak: false })
        .text(`Page ${i - range.start + 1} of ${range.count}`, left + pageWidth / 2, footerY, { width: pageWidth / 2, align: 'right', lineBreak: false });
      doc.page.margins.bottom = savedBottomMargin;
    }

    doc.end();
  });
}

export function moneyFmt(value: unknown): string {
  const num = Number(String(value ?? 0));
  return Number.isFinite(num) ? num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
}

export function dateFmt(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}
