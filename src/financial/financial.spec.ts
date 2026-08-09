import { FinancialRecordService } from './financial-record.service';
import { DiscountService } from './discount.service';
import { InstallmentPlan } from './schemas/installment-plan.schema';
import { PaymentStatus } from './enums/payment-status.enum';

describe('Financial Module — Remainder Front-Loading & Linked Discounts', () => {
  let recordService: FinancialRecordService;
  let discountService: DiscountService;

  beforeEach(() => {
    recordService = new FinancialRecordService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    discountService = new DiscountService({} as any, {} as any);
  });

  describe('buildInstallments rounding remainder front-loading', () => {
    it('should front-load remainder onto earliest installments for 8000 EGP / 3 installments (2667 / 2667 / 2666)', () => {
      const plan = {
        numberOfInstallments: 3,
        dueDates: [new Date('2026-09-01'), new Date('2026-12-01'), new Date('2027-03-01')],
      } as InstallmentPlan;

      const installments = recordService.buildInstallments(8000, plan);
      expect(installments).toHaveLength(3);
      expect(installments[0].amount).toBe(2667);
      expect(installments[1].amount).toBe(2667);
      expect(installments[2].amount).toBe(2666);
      expect(installments.reduce((sum, i) => sum + i.amount, 0)).toBe(8000);
    });

    it('should front-load remainder onto earliest installments for 10000 EGP / 3 installments (3334 / 3333 / 3333)', () => {
      const plan = {
        numberOfInstallments: 3,
        dueDates: [new Date('2026-09-01'), new Date('2026-12-01'), new Date('2027-03-01')],
      } as InstallmentPlan;

      const installments = recordService.buildInstallments(10000, plan);
      expect(installments).toHaveLength(3);
      expect(installments[0].amount).toBe(3334);
      expect(installments[1].amount).toBe(3333);
      expect(installments[2].amount).toBe(3333);
      expect(installments.reduce((sum, i) => sum + i.amount, 0)).toBe(10000);
    });

    it('should divide fee evenly when remainder is 0 (9000 EGP / 3 installments -> 3000 / 3000 / 3000)', () => {
      const plan = {
        numberOfInstallments: 3,
        dueDates: [new Date('2026-09-01'), new Date('2026-12-01'), new Date('2027-03-01')],
      } as InstallmentPlan;

      const installments = recordService.buildInstallments(9000, plan);
      expect(installments).toHaveLength(3);
      expect(installments[0].amount).toBe(3000);
      expect(installments[1].amount).toBe(3000);
      expect(installments[2].amount).toBe(3000);
      expect(installments.reduce((sum, i) => sum + i.amount, 0)).toBe(9000);
    });
  });

  describe('redistributeUnpaidInstallments rounding remainder front-loading', () => {
    it('should front-load remainder when redistributing unpaid balance', () => {
      const installments = [
        { status: PaymentStatus.PENDING, amount: 0 },
        { status: PaymentStatus.PENDING, amount: 0 },
        { status: PaymentStatus.PENDING, amount: 0 },
      ];

      (discountService as any).redistributeUnpaidInstallments(installments, 8000);
      expect(installments[0].amount).toBe(2667);
      expect(installments[1].amount).toBe(2667);
      expect(installments[2].amount).toBe(2666);
    });
  });
});
