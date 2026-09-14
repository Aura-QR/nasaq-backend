import { FinancialRecordService } from './financial-record.service';
import { FeeStatus, PaymentStatus } from './enums/payment-status.enum';

/**
 * Installments must add up to what the student owes.
 *
 * Four copies of a redistribution set each unsettled installment's amount to
 * its share of the *remaining balance*, forgetting what had already been paid
 * on a partly paid one. The case that surfaced it, from a live school:
 * 90,000 over three installments, the second partly paid when the fee
 * criteria were re-saved — installments became 30,000 / 25,000 / 25,000, the
 * student paid all three, the page said "paid in full", and 10,000 was owed
 * with no installment able to take it.
 */
describe('FinancialRecordService.rebalanceInstallments', () => {
  const svc: FinancialRecordService = Object.create(FinancialRecordService.prototype);

  const total = (xs: any[], key: 'amount' | 'paidAmount') =>
    xs.reduce((sum, i) => sum + (Number(i[key]) || 0), 0);

  const inst = (n: number, amount: number, paidAmount = 0) => ({
    installmentNumber: n,
    amount,
    paidAmount,
    dueDate: new Date('2026-09-01'),
    status: paidAmount >= amount ? PaymentStatus.PAID : paidAmount > 0 ? PaymentStatus.PARTIAL : PaymentStatus.PENDING,
    payments: [],
  });

  const pay = (i: any, amount: number) => {
    i.paidAmount += amount;
    i.status = i.paidAmount >= i.amount ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
  };

  describe('the student from the screenshot', () => {
    it('keeps what was paid on a partly paid installment when the balance is shared out', () => {
      const installments = [inst(1, 30000, 30000), inst(2, 30000, 10000), inst(3, 30000)];
      // A real change, so the schedule does get redistributed: fee 90,000 -> 100,000.
      svc.rebalanceInstallments(installments, 100000);

      expect(total(installments, 'amount')).toBe(100000);
      // The settled first installment keeps 30,000; the other 70,000 splits
      // evenly — not 40,000 / 30,000, which piled the difference onto the
      // partly paid one.
      expect(installments.map((i) => i.amount)).toEqual([30000, 35000, 35000]);
      expect(installments[1].amount).toBeGreaterThan(installments[1].paidAmount);
    });

    it('never ends "paid in full" with money still owed', () => {
      const section: any = {
        fee: 90000, grossFee: 90000, netFee: 90000, discount: null,
        installments: [inst(1, 30000, 30000), inst(2, 30000, 10000), inst(3, 30000)],
      };
      // A discount applied and removed again — two rebalances.
      section.netFee = 81000;
      section.discount = { percentage: 10 };
      svc.rebalanceSection(section);
      section.netFee = 90000;
      section.discount = null;
      svc.rebalanceSection(section);

      expect(total(section.installments, 'amount')).toBe(90000);
      // Pay off every installment in full.
      section.installments.forEach((i: any) => pay(i, i.amount - i.paidAmount));
      svc.rebalanceSection(section);

      expect(section.totalPaid).toBe(90000);
      expect(section.status).toBe(FeeStatus.PAID);
    });
  });

  /*
   * The four records the first repair run reshaped on a live system. It kept
   * the money right but piled the stranded amount onto each student's first,
   * partly paid installment. Forced, the rule restores the plan the parent was
   * given — the same amounts buildInstallments produces for that fee.
   */
  describe.each([
    ['طارق',   15000, [7000, 3000], [5000, 5000, 5000]],
    ['يزيد',   16000, [6000, 1000], [5334, 5333, 5333]],
    ['وريف',   11000, [4890, 1834], [3667, 3667, 3666]],
    ['ياسمين', 11000, [5000, 2000], [3667, 3667, 3666]],
  ])('%s: a lopsided repair corrected back to the plan', (_, netFee, [firstAmount, firstPaid], plan) => {
    const lopsided = () => {
      const rest = (netFee - firstAmount) / 2;
      return [inst(1, firstAmount, firstPaid), inst(2, rest), inst(3, rest)];
    };

    it('is what a fresh schedule for that fee would be', () => {
      const installments = lopsided();
      svc.rebalanceInstallments(installments, netFee, { force: true });

      const fresh = svc.buildInstallments(netFee, { numberOfInstallments: 3, dueDates: ['a', 'b', 'c'] } as any);
      expect(installments.map((i) => i.amount)).toEqual(plan);
      expect(installments.map((i) => i.amount)).toEqual(fresh.map((i: any) => i.amount));
      // Nothing that was paid moved, and the first installment is only partly due.
      expect(installments[0].paidAmount).toBe(firstPaid);
      expect(installments[0].status).toBe(PaymentStatus.PARTIAL);
      expect(total(installments, 'amount')).toBe(netFee);
    });

    it('is not reshaped by an ordinary recalculation — it already adds up', () => {
      const installments = lopsided();
      svc.rebalanceInstallments(installments, netFee);
      expect(installments[0].amount).toBe(firstAmount);
    });
  });

  it('closes a partly paid installment at what was paid when its even share would be less', () => {
    // 6,000 over three would be 2,000 each, but 3,000 is already paid on the
    // first: it closes at 3,000 and the other two share the remaining 3,000.
    const installments = [inst(1, 5000, 3000), inst(2, 5000), inst(3, 5000)];
    svc.rebalanceInstallments(installments, 6000);
    expect(installments.map((i) => [i.amount, i.status])).toEqual([
      [3000, PaymentStatus.PAID],
      [1500, PaymentStatus.PENDING],
      [1500, PaymentStatus.PENDING],
    ]);
  });

  it('leaves a schedule alone when nothing changed', () => {
    // Re-saving the same fee criteria, or editing a student's name, must not
    // reshuffle amounts a parent has already been told.
    const installments = [inst(1, 30000, 30000), inst(2, 30000, 10000), inst(3, 30000)];
    svc.rebalanceInstallments(installments, 90000);
    expect(installments.map((i) => i.amount)).toEqual([30000, 30000, 30000]);
  });

  it('gives a fee increase after everything was paid an installment of its own', () => {
    const installments = [inst(1, 30000, 30000), inst(2, 25000, 25000), inst(3, 25000, 25000)];
    svc.rebalanceInstallments(installments, 90000);

    expect(installments).toHaveLength(4);
    expect(installments[3]).toMatchObject({
      installmentNumber: 4, amount: 10000, paidAmount: 0, status: PaymentStatus.PENDING,
    });
    expect(total(installments, 'amount')).toBe(90000);
  });

  it('shares a fee increase across the installments still open', () => {
    const installments = [inst(1, 30000, 30000), inst(2, 30000), inst(3, 30000)];
    svc.rebalanceInstallments(installments, 100000);
    expect(installments.map((i) => i.amount)).toEqual([30000, 35000, 35000]);
  });

  it('closes open installments at what was paid when a discount leaves nothing owed', () => {
    const installments = [inst(1, 30000, 30000), inst(2, 30000, 20000), inst(3, 30000)];
    // 50% discount: 45,000 owed, 50,000 already paid — the student is in credit.
    svc.rebalanceInstallments(installments, 45000);

    expect(installments.map((i) => [i.amount, i.status])).toEqual([
      [30000, PaymentStatus.PAID],
      [20000, PaymentStatus.PAID],
      [0, PaymentStatus.PAID],
    ]);
    // Nothing is pushed below what was actually paid.
    installments.forEach((i) => expect(i.amount).toBeGreaterThanOrEqual(i.paidAmount));
  });

  it('front-loads the remainder the way a new schedule does', () => {
    // A fresh schedule: nothing paid, every installment pending.
    const fresh = (n: number) => ({ ...inst(n, 0), status: PaymentStatus.PENDING });
    const installments = [fresh(1), fresh(2), fresh(3)];
    svc.rebalanceInstallments(installments, 8000);
    expect(installments.map((i) => i.amount)).toEqual([2667, 2667, 2666]);
  });

  describe('rebalanceSection', () => {
    it('brings totalPaid and status with the installments', () => {
      const section: any = {
        fee: 90000, netFee: 90000, discount: null,
        installments: [inst(1, 30000, 30000), inst(2, 25000, 25000), inst(3, 25000, 25000)],
        totalPaid: 80000, status: FeeStatus.PAID,
      };
      svc.rebalanceSection(section);
      expect(section.totalPaid).toBe(80000);
      expect(section.status).toBe(FeeStatus.PARTIAL); // no longer "paid in full"
    });
  });

  describe('effectiveNetFee', () => {
    it('falls back to the fee when netFee was never written and there is no discount', () => {
      // Reading a stray 0 as "nothing owed" would close every open installment.
      expect(svc.effectiveNetFee({ fee: 500, netFee: 0, discount: null })).toBe(500);
      expect(svc.effectiveNetFee({ fee: 500, grossFee: 575, netFee: 0, discount: null })).toBe(575);
    });

    it('trusts netFee when a discount is applied, including a full one', () => {
      expect(svc.effectiveNetFee({ fee: 500, netFee: 400, discount: { percentage: 20 } })).toBe(400);
      expect(svc.effectiveNetFee({ fee: 500, netFee: 0, discount: { percentage: 100 } })).toBe(0);
    });
  });
});
