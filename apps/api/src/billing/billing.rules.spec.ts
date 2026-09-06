import { Prisma } from '@prisma/client';
import { calculateBillTotal, calculateSettlement, determineBillStatus } from './billing.rules';

describe('billing rules', () => {
  const dueDate = new Date('2026-09-05T00:00:00.000Z');

  it('calculates the bill total with discount subtracted', () => {
    expect(calculateBillTotal({ houseRent: 1000, electricity: 50, water: 20, gas: 10, otherBills: 5, fine: 3, discount: 8 }).toString()).toBe('1080');
  });

  it.each([
    ['DUE', 0, '2026-09-04T00:00:00.000Z'],
    ['PARTIAL', 100, '2026-09-04T00:00:00.000Z'],
    ['LATE', 0, '2026-09-06T00:00:00.000Z'],
    ['LATE', 100, '2026-09-06T00:00:00.000Z'],
    ['PAID', 1000, '2026-09-06T00:00:00.000Z'],
  ])('returns %s for paidAmount %s and payment date %s', (expected: string, paidAmount: number, paidOn: string) => {
    expect(determineBillStatus(new Prisma.Decimal(1000), new Prisma.Decimal(paidAmount), new Date(paidOn), dueDate)).toBe(expected);
  });

  it('returns the three settlement outcomes using decimal arithmetic', () => {
    expect(calculateSettlement([100], 500).result).toBe('REFUND');
    expect(calculateSettlement([500], 100).result).toBe('PAYABLE');
    expect(calculateSettlement([500], 500).result).toBe('SETTLED');
  });
});
