import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as mongoose from 'mongoose';
import { SchoolSchema } from '../platform/schools/schemas/school.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { FinancialRecordService } from './financial-record.service';
import { PaymentVoidService } from './payment-void.service';
import { StudentFinancialRecordSchema } from './schemas/student-financial-record.schema';

/**
 * Voiding a payment recorded by mistake, against a real database — the
 * operation is a conditional updateOne on dotted array paths, and a mock would
 * only confirm what the code already assumes.
 *
 * Its own database: suites share a process, and a collection another suite
 * clears is how the preparation specs used to fail in a different place each
 * run.
 */
describe('PaymentVoidService', () => {
  const schoolId = new mongoose.Types.ObjectId();
  const otherSchool = new mongoose.Types.ObjectId();
  const owner = { userId: new mongoose.Types.ObjectId().toString(), role: 'OWNER' };
  const cashier = { userId: new mongoose.Types.ObjectId().toString(), role: 'MANAGER' };
  const colleague = { userId: new mongoose.Types.ObjectId().toString(), role: 'MANAGER' };

  let connection: mongoose.Connection;
  let records: mongoose.Model<any>;
  let schools: mongoose.Model<any>;
  let service: PaymentVoidService;

  const as = <T>(school: mongoose.Types.ObjectId, fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(school), isAdminContext: false }, fn);

  const payment = (amount: number, by: string, extra: any = {}) => ({
    amount,
    paidAt: new Date('2026-09-01'),
    recordedBy: new mongoose.Types.ObjectId(by),
    recordedAt: new Date(),
    type: 'payment',
    ...extra,
  });

  /** A student with 3 tuition installments of 1000, the first fully paid. */
  const seed = async (tuitionPayments: any[] = [payment(1000, cashier.userId)], extra: any = {}) => {
    const paid = tuitionPayments.reduce((s, p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0);
    return as(schoolId, async () => {
      const doc = await records.create({
        studentId: new mongoose.Types.ObjectId(),
        academicYearId: new mongoose.Types.ObjectId(),
        classId: new mongoose.Types.ObjectId(),
        feeConfigId: new mongoose.Types.ObjectId(),
        tuition: {
          fee: 3000,
          netFee: 3000,
          totalPaid: paid,
          status: paid > 0 ? 'partial' : 'unpaid',
          installments: [
            { installmentNumber: 1, amount: 1000, dueDate: new Date(), paidAmount: paid,
              status: paid >= 1000 ? 'paid' : paid > 0 ? 'partial' : 'pending', payments: tuitionPayments },
            { installmentNumber: 2, amount: 1000, dueDate: new Date(), paidAmount: 0, status: 'pending', payments: [] },
            { installmentNumber: 3, amount: 1000, dueDate: new Date(), paidAmount: 0, status: 'pending', payments: [] },
          ],
        },
        ...extra,
      });
      return String(doc.studentId);
    });
  };

  const tuitionVoid = (overrides: any = {}) => ({
    section: 'tuition' as const,
    installmentNumber: 1,
    paymentIndex: 0,
    expectedAmount: 1000,
    reason: 'سُجّلت بالخطأ',
    ...overrides,
  });

  const reload = (studentId: string) =>
    as(schoolId, () => records.findOne({ studentId: new mongoose.Types.ObjectId(studentId) }).lean().exec());

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(process.env.TEST_VOID_MONGODB_URI || 'mongodb://localhost:27017/nasaq-payment-void-test')
      .asPromise();
    records = connection.model('StudentFinancialRecord', StudentFinancialRecordSchema);
    schools = connection.model('School', SchoolSchema);
    const financialRecordService = Object.create(FinancialRecordService.prototype);
    service = new PaymentVoidService(records as any, schools as any, financialRecordService);
  });

  beforeEach(async () => {
    await records.deleteMany({}).setOptions({ skipTenantScope: true });
    await schools.deleteMany({});
  });

  afterAll(async () => {
    await records.deleteMany({}).setOptions({ skipTenantScope: true });
    await schools.deleteMany({});
    await connection.close();
  });

  describe('what a void does to the money', () => {
    it('takes the amount back out, keeps the entry, and records who, when and why', async () => {
      const studentId = await seed();
      await as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), owner));

      const after: any = await reload(studentId);
      const inst = after.tuition.installments[0];
      expect(inst.paidAmount).toBe(0);
      expect(inst.status).toBe('pending');
      expect(after.tuition.totalPaid).toBe(0);
      expect(after.tuition.status).toBe('unpaid');

      // Still there — a void is part of the record, not a way to rewrite it.
      expect(inst.payments).toHaveLength(1);
      expect(inst.payments[0].amount).toBe(1000);
      expect(inst.payments[0].voidedAt).toBeInstanceOf(Date);
      expect(String(inst.payments[0].voidedBy)).toBe(owner.userId);
      expect(inst.payments[0].voidReason).toBe('سُجّلت بالخطأ');
    });

    it('leaves the other payments on the installment counted', async () => {
      const studentId = await seed([payment(600, cashier.userId), payment(400, cashier.userId)]);
      await as(schoolId, () =>
        service.voidPayment(studentId, tuitionVoid({ paymentIndex: 1, expectedAmount: 400 }), owner),
      );
      const inst: any = (await reload(studentId) as any).tuition.installments[0];
      expect(inst.paidAmount).toBe(600);
      expect(inst.status).toBe('partial');
      expect(inst.payments[0].voidedAt).toBeUndefined();
    });

    it('recomputes the section total across every installment', async () => {
      const studentId = await seed();
      await as(schoolId, () =>
        records.updateOne(
          { studentId: new mongoose.Types.ObjectId(studentId) },
          {
            $set: {
              'tuition.installments.1.paidAmount': 250,
              'tuition.installments.1.status': 'partial',
              'tuition.installments.1.payments': [payment(250, cashier.userId)],
              'tuition.totalPaid': 1250,
            },
          },
        ).exec(),
      );
      await as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), owner));
      const after: any = await reload(studentId);
      expect(after.tuition.totalPaid).toBe(250);
      expect(after.tuition.status).toBe('partial');
    });

    it('voids a bus, a trip and an additional-fee payment the same way', async () => {
      const tripId = new mongoose.Types.ObjectId();
      const feeId = new mongoose.Types.ObjectId();
      const inst = (amount: number, paid: number) => ({
        installmentNumber: 1, amount, dueDate: new Date(), paidAmount: paid,
        status: paid >= amount ? 'paid' : 'partial', payments: [payment(paid, cashier.userId)],
      });
      const studentId = await seed([], {
        bus: { enrolled: true, fee: 500, netFee: 500, totalPaid: 500, status: 'paid', installments: [inst(500, 500)] },
        trips: [{ _id: tripId, name: 'رحلة', fee: 200, netFee: 200, totalPaid: 200, status: 'paid', installments: [inst(200, 200)] }],
        additionalFees: [{ additionalFeeId: feeId, name: 'زي', amount: 150, status: 'paid', paidAmount: 150,
          payments: [payment(150, cashier.userId)] }],
      });

      await as(schoolId, () => service.voidPayment(studentId,
        { section: 'bus', installmentNumber: 1, paymentIndex: 0, expectedAmount: 500, reason: 'خطأ' }, owner));
      await as(schoolId, () => service.voidPayment(studentId,
        { section: 'trip', tripId: String(tripId), installmentNumber: 1, paymentIndex: 0, expectedAmount: 200, reason: 'خطأ' }, owner));
      await as(schoolId, () => service.voidPayment(studentId,
        { section: 'additionalFee', additionalFeeId: String(feeId), paymentIndex: 0, expectedAmount: 150, reason: 'خطأ' }, owner));

      const after: any = await reload(studentId);
      expect([after.bus.totalPaid, after.bus.status]).toEqual([0, 'unpaid']);
      expect([after.trips[0].totalPaid, after.trips[0].status]).toEqual([0, 'unpaid']);
      expect([after.additionalFees[0].paidAmount, after.additionalFees[0].status]).toEqual([0, 'unpaid']);
      expect(after.additionalFees[0].payments[0].voidReason).toBe('خطأ');
    });
  });

  describe('who may void', () => {
    it('lets the owner void any payment, including one somebody else recorded long ago', async () => {
      const studentId = await seed([payment(1000, cashier.userId, { recordedAt: new Date('2026-01-01') })]);
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), owner))).resolves.toBeDefined();
    });

    it('lets whoever recorded it void it the same day', async () => {
      const studentId = await seed();
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), cashier))).resolves.toBeDefined();
    });

    it('refuses the recorder on a later day', async () => {
      const yesterday = new Date(Date.now() - 36 * 3600 * 1000);
      const studentId = await seed([payment(1000, cashier.userId, { recordedAt: yesterday })]);
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), cashier)))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect((await reload(studentId) as any).tuition.installments[0].paidAmount).toBe(1000);
    });

    it('refuses someone who did not record it, even the same day', async () => {
      const studentId = await seed();
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), colleague)))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    /*
     * The reason recordedAt has no schema default: a payment recorded before
     * the field existed must not look as if it was entered today.
     */
    it('refuses the recorder on a payment with no recording time — only the owner can', async () => {
      const legacy = payment(1000, cashier.userId);
      delete (legacy as any).recordedAt;
      const studentId = await seed([legacy]);
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), cashier)))
        .rejects.toThrow('مالك المدرسة');
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), owner))).resolves.toBeDefined();
    });

    it("measures 'the same day' in the school's timezone, not the server's", async () => {
      // 23:30 in Riyadh on the 1st is 20:30 UTC — still the 1st in Riyadh.
      expect(PaymentVoidService.dayIn('2026-09-01T20:30:00Z', 'Asia/Riyadh')).toBe('2026-09-01');
      // 00:30 in Riyadh on the 2nd is 21:30 UTC on the 1st — already the 2nd there.
      expect(PaymentVoidService.dayIn('2026-09-01T21:30:00Z', 'Asia/Riyadh')).toBe('2026-09-02');
    });

    it('falls back to Riyadh rather than failing open on a broken timezone setting', () => {
      expect(PaymentVoidService.dayIn('2026-09-01T21:30:00Z', 'Not/AZone')).toBe('2026-09-02');
    });
  });

  describe('what it refuses', () => {
    it('refuses to void twice, and does not subtract twice', async () => {
      const studentId = await seed([payment(600, cashier.userId), payment(400, cashier.userId)]);
      const dto = tuitionVoid({ paymentIndex: 1, expectedAmount: 400 });
      await as(schoolId, () => service.voidPayment(studentId, dto, owner));
      await expect(as(schoolId, () => service.voidPayment(studentId, dto, owner)))
        .rejects.toBeInstanceOf(BadRequestException);
      expect((await reload(studentId) as any).tuition.installments[0].paidAmount).toBe(600);
    });

    /*
     * Two presses of "void" that both read the record before either wrote.
     * The conditional update lets exactly one through.
     */
    it('lets exactly one of two simultaneous voids land', async () => {
      const studentId = await seed([payment(600, cashier.userId), payment(400, cashier.userId)]);
      const dto = tuitionVoid({ paymentIndex: 1, expectedAmount: 400 });
      const results = await Promise.allSettled([
        as(schoolId, () => service.voidPayment(studentId, dto, owner)),
        as(schoolId, () => service.voidPayment(studentId, dto, owner)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await reload(studentId) as any).tuition.installments[0].paidAmount).toBe(600);
    });

    it('refuses a refund entry — voiding is for payments', async () => {
      const studentId = await seed([
        payment(1000, cashier.userId),
        payment(200, cashier.userId, { type: 'refund' }),
      ]);
      await expect(as(schoolId, () =>
        service.voidPayment(studentId, tuitionVoid({ paymentIndex: 1, expectedAmount: 200 }), owner),
      )).rejects.toThrow('قيد استرداد');
    });

    it('refuses a payment part of which was already refunded', async () => {
      const studentId = await seed([
        payment(1000, cashier.userId),
        payment(300, cashier.userId, { type: 'refund' }),
      ]);
      await expect(as(schoolId, () => service.voidPayment(studentId, tuitionVoid(), owner)))
        .rejects.toThrow('استُرد');
      expect((await reload(studentId) as any).tuition.installments[0].paidAmount).toBe(700);
    });

    it('refuses when the amount on the page no longer matches the entry', async () => {
      const studentId = await seed();
      await expect(as(schoolId, () =>
        service.voidPayment(studentId, tuitionVoid({ expectedAmount: 999 }), owner),
      )).rejects.toBeInstanceOf(ConflictException);
    });

    it("cannot reach another school's student", async () => {
      const studentId = await seed();
      await expect(as(otherSchool, () => service.voidPayment(studentId, tuitionVoid(), owner)))
        .rejects.toThrow('لا يوجد سجل مالي');
      expect((await reload(studentId) as any).tuition.installments[0].paidAmount).toBe(1000);
    });
  });
});
