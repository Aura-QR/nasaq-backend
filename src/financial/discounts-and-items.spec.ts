import mongoose, { Model, Types } from 'mongoose';
import { discountAmountFor, entryFrom, recomputeTuitionDiscounts } from './discount-calc';
import { DiscountService } from './discount.service';
import { FeeItemService } from './fee-item.service';
import { Discount, DiscountSchema } from './schemas/discount.schema';
import { FeeItem, FeeItemSchema } from './schemas/fee-item.schema';
import { StudentFinancialRecord, StudentFinancialRecordSchema } from './schemas/student-financial-record.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

describe('discount-calc', () => {
  it('a fixed 500 is 500 on every grade, a percentage follows the fee', () => {
    expect(discountAmountFor('fixed', 0, 500, 9000)).toBe(500);
    expect(discountAmountFor('fixed', 0, 500, 13000)).toBe(500);
    expect(discountAmountFor('percentage', 5, null, 11000)).toBe(550);
  });

  it('never discounts more than the fee', () => {
    expect(discountAmountFor('fixed', 0, 20000, 11000)).toBe(11000);
  });

  it('stacks discounts and shows the combined share', () => {
    const tuition: any = { fee: 11000, grossFee: 11000, discounts: [
      entryFrom({ name: 'خصم الإخوة', type: 'percentage', percentage: 10 }, 11000),
      entryFrom({ name: 'الطلاب السابقون', type: 'fixed', amount: 500 }, 11000),
    ] };
    recomputeTuitionDiscounts(tuition);
    expect(tuition.netFee).toBe(11000 - 1100 - 500);
    expect(tuition.discount).toMatchObject({ name: 'خصم الإخوة + الطلاب السابقون', discountAmount: 1600, percentage: 14.55 });
    expect(tuition.discounts[1]).toMatchObject({ type: 'fixed', amount: 500, percentage: 4.55 });
  });

  it('reads a discount applied before stacking as one percentage entry', () => {
    const tuition: any = { fee: 11000, grossFee: 11000, discount: { discountId: null, name: 'خصم الاخوه', percentage: 10, discountAmount: 1100 } };
    recomputeTuitionDiscounts(tuition);
    expect(tuition.discounts).toHaveLength(1);
    expect(tuition.netFee).toBe(9900);
  });

  it('re-prices on a fee change: the percentage moves, the fixed amount stays', () => {
    const tuition: any = { fee: 11000, grossFee: 11000, discounts: [
      entryFrom({ name: 'نسبة', type: 'percentage', percentage: 10 }, 11000),
      entryFrom({ name: 'ثابت', type: 'fixed', amount: 500 }, 11000),
    ] };
    tuition.grossFee = 13000;
    recomputeTuitionDiscounts(tuition);
    expect(tuition.discounts.map((d: any) => d.discountAmount)).toEqual([1300, 500]);
    expect(tuition.netFee).toBe(11200);
  });
});

const URI = 'mongodb://localhost:27017/nasaq-discounts-items-test';

describe('DiscountService and FeeItemService', () => {
  const schoolId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const adminId = String(new Types.ObjectId());
  const asTenant = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, async () => await fn());
  const model = <T>(name: string, schema: any): Model<T> =>
    (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);

  let discounts: Model<Discount>;
  let items: Model<FeeItem>;
  let records: Model<StudentFinancialRecord>;
  let discountService: DiscountService;
  let itemService: FeeItemService;

  beforeAll(async () => {
    await mongoose.connect(URI);
    discounts = model(Discount.name, DiscountSchema);
    items = model(FeeItem.name, FeeItemSchema);
    records = model(StudentFinancialRecord.name, StudentFinancialRecordSchema);
    // Installments are FinancialRecordService's own concern, tested there.
    discountService = new DiscountService(discounts, records, { rebalanceSection: () => undefined } as any);
    itemService = new FeeItemService(items, records);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await items.syncIndexes();
    await asTenant(() => records.create({
      schoolId, studentId, academicYearId: new Types.ObjectId(), classId: new Types.ObjectId(), feeConfigId: new Types.ObjectId(),
      tuition: { fee: 11000, grossFee: 11000, netFee: 11000, installments: [] },
    }));
  });

  const tuition = async () => (await asTenant(() => records.findOne({ studentId }).lean()) as any).tuition;

  it('refuses a fixed discount without an amount and a percentage over 100', async () => {
    await expect(asTenant(() => discountService.create({ name: 'س', type: 'fixed' }, adminId))).rejects.toThrow('أدخل مبلغ الخصم');
    await expect(asTenant(() => discountService.create({ name: 'س', type: 'percentage', percentage: 0 }, adminId))).rejects.toThrow('أدخل نسبة الخصم');
  });

  it('stacks a list discount, a fixed one and a custom one, and removes one of them', async () => {
    const siblings: any = (await asTenant(() => discountService.create({ name: 'خصم الإخوة', percentage: 10 }, adminId))).data;
    const returning: any = (await asTenant(() => discountService.create({ name: 'الطلاب السابقون', type: 'fixed', amount: 500 }, adminId))).data;
    await asTenant(() => discountService.applyToTuition(String(studentId), { discountId: String(siblings._id) }, adminId));
    await asTenant(() => discountService.applyToTuition(String(studentId), { discountId: String(returning._id) }, adminId));
    await expect(asTenant(() => discountService.applyToTuition(String(studentId), { discountId: String(returning._id) }, adminId)))
      .rejects.toThrow('مطبق بالفعل');
    await asTenant(() => discountService.applyCustomToTuition(String(studentId), { type: 'fixed', value: 250, reason: 'ظروف خاصة' }, adminId));

    let t = await tuition();
    expect(t.discounts.map((d: any) => d.discountAmount)).toEqual([1100, 500, 250]);
    expect(t.discounts[2]).toMatchObject({ custom: true, reason: 'ظروف خاصة', name: 'خصم خاص' });
    expect(t.netFee).toBe(9150);
    expect(t.discount.discountAmount).toBe(1850);

    await asTenant(() => discountService.removeTuitionEntry(String(studentId), String(t.discounts[0]._id)));
    t = await tuition();
    expect(t.discounts.map((d: any) => d.name)).toEqual(['الطلاب السابقون', 'خصم خاص']);
    expect(t.netFee).toBe(10250);

    await asTenant(() => discountService.removeFromTuition(String(studentId)));
    t = await tuition();
    expect(t.discounts).toEqual([]);
    expect(t.discount).toBeNull();
    expect(t.netFee).toBe(11000);
  });

  it('sells two uniforms at today\'s price, keeps that price after a change, and cancels only unpaid sales', async () => {
    const uniform: any = (await asTenant(() => itemService.create({ name: 'الزي المدرسي', unitPrice: 150 }, adminId))).data;
    const sale: any = (await asTenant(() => itemService.sell(String(uniform._id), String(studentId), { quantity: 2 }, adminId))).data;
    expect(sale).toMatchObject({ name: 'الزي المدرسي × 2', amount: 300, quantity: 2, unitPrice: 150, status: 'unpaid' });

    await asTenant(() => itemService.update(String(uniform._id), { unitPrice: 175 }));
    const paid: any = (await asTenant(() => itemService.sell(String(uniform._id), String(studentId), { quantity: 4, paidAt: '2026-11-05' }, adminId))).data;
    expect(paid).toMatchObject({ amount: 700, status: 'paid', paidAmount: 700 });

    const fees = ((await asTenant(() => records.findOne({ studentId }).lean())) as any).additionalFees;
    expect(fees.map((f: any) => f.amount)).toEqual([300, 700]);

    await expect(asTenant(() => itemService.cancelSale(String(studentId), String(paid.additionalFeeId)))).rejects.toThrow('مسدد');
    await asTenant(() => itemService.cancelSale(String(studentId), String(sale.additionalFeeId)));
    await expect(asTenant(() => itemService.delete(String(uniform._id)))).rejects.toThrow('أوقف تفعيله');
  });
});
