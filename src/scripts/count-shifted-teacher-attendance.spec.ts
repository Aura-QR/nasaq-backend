import * as mongoose from 'mongoose';
import { countShifted } from './count-shifted-teacher-attendance';

describe('count-shifted-teacher-attendance (read-only)', () => {
  const dbName = `nasaq-shifted-count-${Date.now()}`;
  let client: mongoose.mongo.MongoClient;
  let db: mongoose.mongo.Db;
  const school = new mongoose.Types.ObjectId();
  const before = new Date('2026-09-14T00:00:00Z');
  const after = new Date('2026-09-15T00:00:00Z');
  const createdBefore = { createdAt: before };

  beforeAll(async () => {
    client = await mongoose.mongo.MongoClient.connect('mongodb://127.0.0.1:27017');
    db = client.db(dbName);
    await db.collection('schools').insertOne({ _id: school, name: 'مدرسة', settings: { timezone: 'Asia/Riyadh' } });
    const base = { schoolId: school, teacherId: new mongoose.Types.ObjectId(), name: 'معلم', date: new Date('2026-09-10T00:00:00Z') };
    await db.collection('teacherAttendance').insertMany([
      // typed 07:45, stored as 07:45 UTC = 10:45 Riyadh
      { ...base, ...createdBefore, method: 'manual', recordedBy: new mongoose.Types.ObjectId(), checkInAt: new Date('2026-09-10T07:45:00Z'), lateMinutes: 195, updatedAt: before },
      // a location check-in someone edited
      { ...base, ...createdBefore, method: 'location', recordedBy: new mongoose.Types.ObjectId(), checkInAt: new Date('2026-09-10T08:00:00Z'), updatedAt: before },
      // untouched location check-in: not a candidate
      { ...base, ...createdBefore, method: 'location', recordedBy: null, checkInAt: new Date('2026-09-10T04:40:00Z'), updatedAt: before },
      // manual entry created after the fix: not a candidate
      { ...base, createdAt: after, method: 'manual', recordedBy: new mongoose.Types.ObjectId(), checkInAt: new Date('2026-09-14T04:45:00Z'), updatedAt: after },
      // old manual entry whose note was edited after the fix: its time is still wrong
      { ...base, ...createdBefore, date: new Date('2026-09-11T00:00:00Z'), method: 'manual', recordedBy: new mongoose.Types.ObjectId(), checkInAt: new Date('2026-09-11T07:45:00Z'), lateMinutes: 195, updatedAt: after },
    ]);
  });

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it('counts manual and edited records written before the cutoff, and shows the local time undone', async () => {
    const before = await db.collection('teacherAttendance').find().toArray();
    const [report] = await countShifted(db, { before: '2026-09-14T11:43:46Z' });

    // Hamdy's recheck: a note edited after the fix moved updatedAt and dropped
    // the record from the count, though its time was never corrected.
    expect(report).toMatchObject({ schoolName: 'مدرسة', timezone: 'Asia/Riyadh', manual: 2, edited: 1, touchedAfterFix: 1 });
    expect(report.samples[0]).toMatchObject({ stored: '10:45', ifShifted: '07:45', lateMinutes: 195, kind: 'manual', touchedAfterFix: false });
    expect(report.samples.find((sample) => sample.date === '2026-09-11')).toMatchObject({ kind: 'manual', touchedAfterFix: true });

    // Read-only: the collection is exactly as it was.
    expect(await db.collection('teacherAttendance').find().toArray()).toEqual(before);
  });
});
