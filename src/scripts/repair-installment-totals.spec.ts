import * as mongoose from 'mongoose';
import { planRepair, repairAll } from './repair-installment-totals';

/**
 * The repair against real documents, on its own database. What matters most is
 * what it does NOT touch: a healthy schedule, a paid amount, a bus the student
 * is not enrolled in.
 */
describe('repair-installment-totals', () => {
  let connection: mongoose.Connection;
  let db: mongoose.mongo.Db;
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  const inst = (n: number, amount: number, paidAmount = 0) => ({
    _id: new mongoose.Types.ObjectId(),
    installmentNumber: n, amount, paidAmount, dueDate: new Date('2026-09-01'),
    status: paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending',
    payments: paidAmount ? [{ amount: paidAmount, paidAt: new Date(), type: 'payment' }] : [],
  });

  const record = (tuitionInstallments: any[], extra: any = {}) => {
    const totalPaid = tuitionInstallments.reduce((s, i) => s + i.paidAmount, 0);
    return {
      _id: new mongoose.Types.ObjectId(),
      schoolId: new mongoose.Types.ObjectId(),
      studentId: new mongoose.Types.ObjectId(),
      updatedAt: new Date('2026-09-10'),
      tuition: {
        fee: 90000, grossFee: 90000, netFee: 90000, discount: null, totalPaid,
        status: tuitionInstallments.every((i) => i.status === 'paid') ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid',
        installments: tuitionInstallments,
      },
      bus: { enrolled: false, fee: 0, netFee: 0, totalPaid: 0, status: 'unpaid', installments: [] },
      trips: [],
      ...extra,
    };
  };

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(process.env.TEST_REPAIR_MONGODB_URI || 'mongodb://localhost:27017/nasaq-repair-installments-test')
      .asPromise();
    db = connection.db;
  });
  beforeEach(async () => {
    await db.collection('studentFinancialRecords').deleteMany({});
    await db.collection('students').deleteMany({});
  });
  afterAll(async () => {
    await db.dropDatabase();
    await connection.close();
    log.mockRestore();
  });

  it('repairs the screenshot case: an installment for what is still owed, and no longer "paid"', async () => {
    const broken = record([inst(1, 30000, 30000), inst(2, 25000, 25000), inst(3, 25000, 25000)]);
    await db.collection('studentFinancialRecords').insertOne(broken);

    const dry = await repairAll(db, { apply: false });
    expect(dry).toMatchObject({ scanned: 1, affected: 1, repaired: 0 });
    // A dry run writes nothing.
    expect((await db.collection('studentFinancialRecords').findOne({ _id: broken._id }))!.tuition.installments).toHaveLength(3);

    const applied = await repairAll(db, { apply: true });
    expect(applied).toMatchObject({ affected: 1, repaired: 1, skipped: 0 });

    const after: any = await db.collection('studentFinancialRecords').findOne({ _id: broken._id });
    expect(after.tuition.installments).toHaveLength(4);
    expect(after.tuition.installments[3]).toMatchObject({ installmentNumber: 4, amount: 10000, paidAmount: 0, status: 'pending' });
    expect(after.tuition.installments[3]._id).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(after.tuition.status).toBe('partial');
    expect(after.tuition.totalPaid).toBe(80000);
    // What was paid is exactly what it was.
    expect(after.tuition.installments.slice(0, 3).map((i: any) => [i.amount, i.paidAmount, i.payments.length]))
      .toEqual([[30000, 30000, 1], [25000, 25000, 1], [25000, 25000, 1]]);
  });

  it('raises open installments when the record broke before they were paid', async () => {
    const broken = record([inst(1, 30000, 30000), inst(2, 25000, 10000), inst(3, 25000)]);
    await db.collection('studentFinancialRecords').insertOne(broken);
    await repairAll(db, { apply: true });

    const after: any = await db.collection('studentFinancialRecords').findOne({ _id: broken._id });
    expect(after.tuition.installments.reduce((s: number, i: any) => s + i.amount, 0)).toBe(90000);
    expect(after.tuition.installments[1].paidAmount).toBe(10000);
    expect(after.tuition.installments[1].amount).toBeGreaterThan(10000);
  });

  it('leaves a healthy record alone — including one with a partly paid installment', async () => {
    const healthy = record([inst(1, 30000, 30000), inst(2, 30000, 10000), inst(3, 30000)]);
    await db.collection('studentFinancialRecords').insertOne(healthy);
    expect(planRepair(healthy)).toEqual([]);
    const summary = await repairAll(db, { apply: true });
    expect(summary).toMatchObject({ scanned: 1, affected: 0, repaired: 0 });
    expect((await db.collection('studentFinancialRecords').findOne({ _id: healthy._id }))!.updatedAt)
      .toEqual(new Date('2026-09-10'));
  });

  it('does not invent a bus debt for a student who is not enrolled', () => {
    const r = record([inst(1, 90000, 0)], {
      bus: { enrolled: false, fee: 500, netFee: 500, totalPaid: 0, status: 'unpaid', installments: [] },
    });
    expect(planRepair(r)).toEqual([]);
  });

  it('repairs a broken trip too', () => {
    const r = record([inst(1, 90000, 0)], {
      trips: [{ name: 'رحلة', fee: 1000, netFee: 1000, discount: null, totalPaid: 800, status: 'paid',
        installments: [inst(1, 400, 400), inst(2, 400, 400)] }],
    });
    const changes = planRepair(r);
    expect(changes.map((c) => c.path)).toEqual(['trips.0']);
    expect(changes[0].section.installments[2]).toMatchObject({ amount: 200, status: 'pending' });
  });

  describe('--reshape on named records', () => {
    // The four states the first run left on a live system: totals right, the
    // stranded amount piled onto the partly paid first installment.
    const liveStates: [string, number, number, number, number[]][] = [
      ['طارق', 15000, 7000, 3000, [5000, 5000, 5000]],
      ['يزيد', 16000, 6000, 1000, [5334, 5333, 5333]],
      ['وريف', 11000, 4890, 1834, [3667, 3667, 3666]],
      ['ياسمين', 11000, 5000, 2000, [3667, 3667, 3666]],
    ];
    const lopsided = (netFee: number, first: number, paid: number) => {
      const rest = (netFee - first) / 2;
      const r = record([inst(1, first, paid), inst(2, rest), inst(3, rest)]);
      r.tuition.fee = r.tuition.grossFee = r.tuition.netFee = netFee;
      return r;
    };

    it('restores each of the four to its plan, payments untouched', async () => {
      const docs = liveStates.map(([, netFee, first, paid]) => lopsided(netFee, first, paid));
      await db.collection('studentFinancialRecords').insertMany(docs);

      const summary = await repairAll(db, { apply: true, reshapeRecordIds: docs.map((d) => String(d._id)) });
      expect(summary).toMatchObject({ scanned: 4, affected: 4, repaired: 4 });

      for (const [index, [, netFee, , paid, plan]] of liveStates.entries()) {
        const after: any = await db.collection('studentFinancialRecords').findOne({ _id: docs[index]._id });
        expect(after.tuition.installments.map((i: any) => i.amount)).toEqual(plan);
        expect(after.tuition.installments[0].paidAmount).toBe(paid);
        expect(after.tuition.installments[0].payments).toHaveLength(1);
        expect(after.tuition.installments[0].status).toBe('partial');
        expect(after.tuition.totalPaid).toBe(paid);
        expect(after.tuition.installments.reduce((s: number, i: any) => s + i.amount, 0)).toBe(netFee);
      }
    });

    it('leaves them alone on a normal run — they already add up', async () => {
      const doc = lopsided(15000, 7000, 3000);
      await db.collection('studentFinancialRecords').insertOne(doc);
      expect(await repairAll(db, { apply: true })).toMatchObject({ affected: 0 });
    });

    it('touches only the records it is given', async () => {
      const named = lopsided(15000, 7000, 3000);
      const other = lopsided(11000, 5000, 2000);
      await db.collection('studentFinancialRecords').insertMany([named, other]);

      await repairAll(db, { apply: true, reshapeRecordIds: [String(named._id)] });
      const untouched: any = await db.collection('studentFinancialRecords').findOne({ _id: other._id });
      expect(untouched.tuition.installments.map((i: any) => i.amount)).toEqual([5000, 3000, 3000]);
    });

    it('refuses to run without an explicit list', async () => {
      await expect(repairAll(db, { apply: true, reshapeRecordIds: [] })).rejects.toThrow('--records');
      await expect(repairAll(db, { apply: true, reshapeRecordIds: ['not-an-id'] })).rejects.toThrow('--records');
    });
  });

  it('is idempotent', async () => {
    await db.collection('studentFinancialRecords').insertOne(
      record([inst(1, 30000, 30000), inst(2, 25000, 25000), inst(3, 25000, 25000)]),
    );
    await repairAll(db, { apply: true });
    expect(await repairAll(db, { apply: true })).toMatchObject({ affected: 0, repaired: 0 });
  });
});
