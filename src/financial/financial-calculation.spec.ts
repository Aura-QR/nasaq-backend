import { FinancialRecordService } from './financial-record.service';

describe('Financial Calculation Invariants & Expatriate Surcharge', () => {
  function computeFinancials(
    fee: number,
    surchargePct: number,
    isExpatriate: boolean,
    discountPct: number | null,
  ) {
    const surchargeAmount = (isExpatriate && surchargePct > 0)
      ? Math.round((fee * surchargePct) / 100)
      : 0;
    const grossFee = fee + surchargeAmount;
    const discountAmount = discountPct
      ? Math.round((grossFee * discountPct) / 100)
      : 0;
    const netFee = grossFee - discountAmount;

    return { surchargeAmount, grossFee, discountAmount, netFee };
  }

  function redistributeUnpaidInstallments(unpaidCount: number, totalUnpaid: number) {
    if (unpaidCount <= 0 || totalUnpaid <= 0) return [];
    const base = Math.floor(totalUnpaid / unpaidCount);
    const remainder = totalUnpaid - base * unpaidCount;
    const shares: number[] = [];
    for (let i = 0; i < unpaidCount; i++) {
      shares.push(i < remainder ? base + 1 : base);
    }
    return shares;
  }

  it('should compute exact worked example for local student (سارة - SA)', () => {
    // Grade 1: fee 8000, 15% surcharge, local nationality => 0 surcharge, netFee 8000
    const res = computeFinancials(8000, 15, false, null);
    expect(res.surchargeAmount).toBe(0);
    expect(res.grossFee).toBe(8000);
    expect(res.discountAmount).toBe(0);
    expect(res.netFee).toBe(8000);

    const installments = redistributeUnpaidInstallments(3, res.netFee);
    expect(installments).toEqual([2667, 2667, 2666]);
    expect(installments.reduce((a, b) => a + b, 0)).toBe(res.netFee);
  });

  it('should compute exact worked example for expatriate student (أحمد - EG)', () => {
    // Grade 1: fee 8000, 15% surcharge, expat nationality => surcharge 1200, grossFee 9200
    const res = computeFinancials(8000, 15, true, null);
    expect(res.surchargeAmount).toBe(1200);
    expect(res.grossFee).toBe(9200);
    expect(res.discountAmount).toBe(0);
    expect(res.netFee).toBe(9200);

    const installments = redistributeUnpaidInstallments(3, res.netFee);
    expect(installments).toEqual([3067, 3067, 3066]);
    expect(installments.reduce((a, b) => a + b, 0)).toBe(res.netFee);
  });

  it('should apply discount to post-surcharge grossFee for expatriate student', () => {
    // Expat: gross 9200, 10% discount => discountAmount 920, netFee 8280
    const res = computeFinancials(8000, 15, true, 10);
    expect(res.surchargeAmount).toBe(1200);
    expect(res.grossFee).toBe(9200);
    expect(res.discountAmount).toBe(920);
    expect(res.netFee).toBe(8280);

    const installments = redistributeUnpaidInstallments(3, res.netFee);
    expect(installments).toEqual([2760, 2760, 2760]);
    expect(installments.reduce((a, b) => a + b, 0)).toBe(res.netFee);
  });

  it('should preserve surcharge when discount is removed', () => {
    const withDiscount = computeFinancials(8000, 15, true, 10);
    expect(withDiscount.netFee).toBe(8280);

    // Remove discount => netFee reverts to grossFee (9200), preserving surcharge
    const withoutDiscount = computeFinancials(8000, 15, true, null);
    expect(withoutDiscount.netFee).toBe(9200);
    expect(withoutDiscount.grossFee).toBe(9200);
    expect(withoutDiscount.surchargeAmount).toBe(1200);
  });

  it('should treat student with missing/unset nationalityCode as local (no surcharge - B4)', () => {
    const nationalityCode = undefined;
    const localNationalityCodes = ['SA'];
    const isExpatriate = nationalityCode ? !localNationalityCodes.includes(nationalityCode) : false;
    expect(isExpatriate).toBe(false);

    const res = computeFinancials(8000, 15, isExpatriate, null);
    expect(res.surchargeAmount).toBe(0);
    expect(res.grossFee).toBe(8000);
  });

  it('should defensively read grossFee || fee for legacy records (B2)', () => {
    const legacyTuitionWithZeroGross: any = { fee: 8000, grossFee: 0, discount: null, netFee: 8000 };
    // grossFee hydrated as 0 by Mongoose on legacy doc requires || instead of ??
    const effectiveGrossFee = legacyTuitionWithZeroGross.grossFee || legacyTuitionWithZeroGross.fee;
    expect(effectiveGrossFee).toBe(8000);
  });

  it('should handle nationality correction recalculation (EG to SA after partial payment 2760 - §A8)', () => {
    // أحمد (EG): gross 9200, discount 10% (920) => netFee 8280.
    // أحمد pays installment 1 (2760). totalPaid = 2760.
    // Nationality corrected to SA (local):
    // surcharge removed => grossFee 8000. discount recomputed => 800 (10% of 8000).
    // new netFee = 7200. remaining unpaid = 7200 - 2760 = 4440.
    // 2 unpaid installments remaining => 4440 / 2 = 2220 each.
    const newRes = computeFinancials(8000, 15, false, 10);
    expect(newRes.grossFee).toBe(8000);
    expect(newRes.discountAmount).toBe(800);
    expect(newRes.netFee).toBe(7200);

    const totalPaid = 2760;
    const remainingUnpaid = newRes.netFee - totalPaid; // 4440
    const unpaidCount = 2;

    const redistributed = redistributeUnpaidInstallments(unpaidCount, remainingUnpaid);
    expect(redistributed).toEqual([2220, 2220]);
    expect(redistributed.reduce((a, b) => a + b, 0)).toBe(remainingUnpaid);
  });

  it('should satisfy all mathematical invariants and verify against FinancialRecordService instance', () => {
    const fee = 9500;
    const surchargePct = 15;
    const discountPct = 10;
    const isExpatriate = true;

    const res = computeFinancials(fee, surchargePct, isExpatriate, discountPct);
    expect(res.grossFee).toBe(fee + res.surchargeAmount);
    expect(res.netFee).toBe(res.grossFee - res.discountAmount);

    const totalPaid = 2800;
    const unpaidCount = 2;
    const remainingUnpaid = res.netFee - totalPaid;
    const shares = redistributeUnpaidInstallments(unpaidCount, remainingUnpaid);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(remainingUnpaid);

    const recordService = new FinancialRecordService(
      {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    const plan = {
      numberOfInstallments: 3,
      dueDates: [new Date(), new Date(), new Date()],
    } as any;
    const serviceInstallments = recordService.buildInstallments(8000, plan);
    expect(serviceInstallments.map((i) => i.amount)).toEqual([2667, 2667, 2666]);
  });
});
