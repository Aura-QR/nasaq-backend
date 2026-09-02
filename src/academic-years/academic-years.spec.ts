import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AcademicYearsService } from './academic-years.service';
import { AcademicYear, AcademicYearSchema } from './schemas/academic-year.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test-years';

describe('AcademicYearsService.remove', () => {
  let moduleRef: TestingModule;
  let service: AcademicYearsService;
  const m: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: AcademicYear.name, schema: AcademicYearSchema },
          { name: Enrollment.name, schema: EnrollmentSchema },
          { name: Class.name, schema: ClassSchema },
          { name: Term.name, schema: TermSchema },
          { name: Lecture.name, schema: LectureSchema },
        ]),
      ],
      providers: [AcademicYearsService],
    }).compile();

    service = moduleRef.get(AcademicYearsService);
    for (const n of [AcademicYear.name, Enrollment.name, Class.name, Term.name, Lecture.name]) {
      m[n] = moduleRef.get(getModelToken(n));
    }
  });

  afterAll(async () => { await moduleRef?.close(); });

  beforeEach(async () => {
    // Raw collections: the models are tenant-scoped and would delete nothing
    // outside a tenant context, leaking rows into the next test.
    for (const n of Object.keys(m)) await m[n].collection.deleteMany({});
  });

  const mkYear = async (name: string, status = 'archived') =>
    (await m[AcademicYear.name].collection.insertOne({
      name, status, setupStep: 0, schoolId,
      startDate: new Date(), endDate: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    })).insertedId;

  it('deletes an empty year and reports what went with it', async () => {
    const keep = await mkYear('2025/2026');
    const doomed = await mkYear('Aura 2027', 'active');
    const klass = (await m[Class.name].collection.insertOne({
      name: '1/1', academicYearId: doomed, schoolId,
    })).insertedId;
    await m[Lecture.name].collection.insertMany([
      { classId: klass, schoolId, dayOfWeek: 1, slot: 1 },
      { classId: klass, schoolId, dayOfWeek: 1, slot: 2 },
    ]);
    await m[Term.name].collection.insertOne({ name: 'ف1', academicYearId: doomed, schoolId });

    const res: any = await asTenant(() => service.remove(String(doomed)));

    expect(res.deleted).toEqual({
      academicYear: 'Aura 2027', classes: 1, lectures: 2, terms: 1,
    });
    expect(await m[AcademicYear.name].collection.countDocuments({ _id: doomed })).toBe(0);
    expect(await m[Lecture.name].collection.countDocuments({})).toBe(0);
    // and nothing is left pointing at a year that no longer exists
    expect(await m[Class.name].collection.countDocuments({ academicYearId: doomed })).toBe(0);
    expect(String(res.activeYear._id)).toBe(String(keep));
  });

  it('refuses while students are enrolled in the year', async () => {
    await mkYear('other');
    const doomed = await mkYear('has-students');
    await m[Enrollment.name].collection.insertOne({ academicYearId: doomed, schoolId });

    await expect(asTenant(() => service.remove(String(doomed)))).rejects.toThrow(/تسجيل طالب/);
    expect(await m[AcademicYear.name].collection.countDocuments({ _id: doomed })).toBe(1);
  });

  it('refuses when a class inside it still holds students', async () => {
    await mkYear('other');
    const doomed = await mkYear('has-class-students');
    const klass = (await m[Class.name].collection.insertOne({
      name: '2/3', academicYearId: doomed, schoolId,
    })).insertedId;
    await m[Enrollment.name].collection.insertOne({ classId: klass, schoolId });

    await expect(asTenant(() => service.remove(String(doomed)))).rejects.toThrow(/2\/3/);
    // and refusing must not have deleted anything on the way
    expect(await m[Class.name].collection.countDocuments({ _id: klass })).toBe(1);
  });

  it('refuses to remove the only year a school has', async () => {
    const only = await mkYear('only', 'active');
    await expect(asTenant(() => service.remove(String(only)))).rejects.toThrow(/الوحيدة/);
  });

  it('leaves the active year alone when an archived one is removed', async () => {
    const active = await mkYear('current', 'active');
    const doomed = await mkYear('old');

    const res: any = await asTenant(() => service.remove(String(doomed)));

    expect(res.activeYear).toBeNull();
    const still = await m[AcademicYear.name].collection.findOne({ _id: active });
    expect(still.status).toBe('active');
  });

  it('never leaves the school without an active year', async () => {
    await mkYear('a');
    await mkYear('b');
    const doomed = await mkYear('c', 'active');

    await asTenant(() => service.remove(String(doomed)));

    const actives = await m[AcademicYear.name].collection
      .countDocuments({ schoolId, status: 'active' });
    expect(actives).toBe(1);
  });

  it('does not touch another school\'s years', async () => {
    const otherSchool = new Types.ObjectId();
    await m[AcademicYear.name].collection.insertOne({
      name: 'theirs', status: 'active', schoolId: otherSchool,
    });
    await mkYear('mine-keep');
    const doomed = await mkYear('mine-doomed', 'active');

    await asTenant(() => service.remove(String(doomed)));

    const theirs = await m[AcademicYear.name].collection.findOne({ schoolId: otherSchool });
    expect(theirs.status).toBe('active');
  });

  it('404s on a year that does not exist', async () => {
    await expect(
      asTenant(() => service.remove(String(new Types.ObjectId()))),
    ).rejects.toThrow(/غير موجودة/);
  });
});
