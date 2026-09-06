import { BillStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';

export function calculateBillTotal(values: {
  houseRent: Prisma.Decimal | number | string;
  electricity: Prisma.Decimal | number | string;
  water: Prisma.Decimal | number | string;
  gas: Prisma.Decimal | number | string;
  otherBills: Prisma.Decimal | number | string;
  fine: Prisma.Decimal | number | string;
  discount: Prisma.Decimal | number | string;
}) {
  return new Prisma.Decimal(values.houseRent)
    .add(values.electricity)
    .add(values.water)
    .add(values.gas)
    .add(values.otherBills)
    .add(values.fine)
    .sub(values.discount);
}

export function determineBillStatus(total: Prisma.Decimal, paidAmount: Prisma.Decimal, paidOn: Date | null, dueDate: Date): BillStatus {
  const late = paidOn !== null && paidOn.getTime() > dueDate.getTime();
  if (paidAmount.gte(total)) return BillStatus.PAID;
  if (paidAmount.gt(0)) return late ? BillStatus.LATE : BillStatus.PARTIAL;
  return late ? BillStatus.LATE : BillStatus.DUE;
}

export function calculateSettlement(unpaidAmounts: Array<Prisma.Decimal | number | string>, securityDeposit: Prisma.Decimal | number | string) {
  const unpaidDue = unpaidAmounts.reduce<Prisma.Decimal>((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
  const deposit = Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(securityDeposit));
  const finalBalance = deposit.sub(unpaidDue);
  if (finalBalance.gt(0)) return { unpaidDue, securityDeposit: deposit, refundAmount: finalBalance, payableAmount: new Prisma.Decimal(0), result: 'REFUND' as const };
  if (finalBalance.lt(0)) return { unpaidDue, securityDeposit: deposit, refundAmount: new Prisma.Decimal(0), payableAmount: finalBalance.abs(), result: 'PAYABLE' as const };
  return { unpaidDue, securityDeposit: deposit, refundAmount: new Prisma.Decimal(0), payableAmount: new Prisma.Decimal(0), result: 'SETTLED' as const };
}
