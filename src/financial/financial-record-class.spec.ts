import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import {
  StudentFinancialRecord,
  StudentFinancialRecordSchema,
} from './schemas/student-financial-record.schema';
import { InstallmentPlan, InstallmentPlanSchema } from './schemas/installment-plan.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { FinancialRecordService } from './financial-record.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-financial-class${query}`,
);

/**
 * GET /financial/records showed no class: a record opened by the bus or an
 * extra fee (not tuition) never got a classId, and the populate left out the
 * class name anyway.
 */
describe('financial records carry the student\'s class', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const ids: Record<string, Types.ObjectId> = {};
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  beforeAll(async () => {
    const models = [
      [StudentFinancialRecord.name, StudentFinancialRecordSchema], [InstallmentPlan.name, InstallmentPlanSchema],
      [Student.name, StudentSchema], [Class.name, ClassSchema], [Enrollment.name, EnrollmentSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema }))),
      ],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    for (const [key, name] of [['a', '1/أ'], ['b', '1/ب']] as const) {
      ids[`${key}Class`] = (await m.Class.collection.insertOne({ name, academicYearId: yearId, schoolId })).insertedId;
      ids[`${key}Student`] = (await m.Student.collection.insertOne({ name: `طالبة ${key}`, email: `${key}@t.test`, schoolId })).insertedId;
      await m.Enrollment.collection.insertOne({ studentId: ids[`${key}Student`], classId: ids[`${key}Class`],
        academicYearId: yearId, status: 'active', schoolId });
    }
    // a: opened by tuition, classId set. b: opened by the bus, no classId.
    await m.StudentFinancialRecord.collection.insertOne({ studentId: ids.aStudent, academicYearId: yearId,
      classId: ids.aClass, schoolId, createdAt: new Date(1) });
    await m.StudentFinancialRecord.collection.insertOne({ studentId: ids.bStudent, academicYearId: yearId,
      schoolId, createdAt: new Date(2) });
  });

  const service = () =>
    new FinancialRecordService(m.StudentFinancialRecord, {} as any, m.InstallmentPlan, {} as any, m.Student,
      m.Class, {} as any, {} as any, {} as any, {} as any);
  const classOf = (rows: any[], student: Types.ObjectId) =>
    rows.find((r) => String(r.studentId._id) === String(student))?.classId?.name;

  it('lists every record with its class name, from the record or the enrolment', async () => {
    const res: any = await asSchool(() => service().find({}, { page: 1, limit: 10 }));
    expect(classOf(res.data, ids.aStudent)).toBe('1/أ');
    expect(classOf(res.data, ids.bStudent)).toBe('1/ب');
  });

  it('filters by class, including records with no classId of their own', async () => {
    const res: any = await asSchool(() => service().find({ classId: String(ids.bClass) }, { page: 1, limit: 10 }));
    expect(res.data.map((r: any) => String(r.studentId._id))).toEqual([String(ids.bStudent)]);
    expect(res.totalDocs).toBe(1);
  });
});
