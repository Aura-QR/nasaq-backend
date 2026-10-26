import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { StudentStatisticsService } from './student-statistics.service';
import { Student, StudentSchema } from './schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Stage, StageSchema } from '../stages/schemas/stage.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';

dotenv.config();

describe('StudentStatisticsService', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();
  const models: Record<string, any> = {};
  let service: StudentStatisticsService;
  const ids: Record<string, string> = {};

  const model = (name: string, schema: any) => mongoose.models[name] || mongoose.model(name, schema);
  const run = <T>(fn: () => Promise<T>) => contextService.runWithTenant(schoolId, false, fn);

  let seq = 0;
  const student = (classId: any, gender: string, nationality?: string, nationalityCode?: string) => {
    seq++;
    return models.student.create({
      firstName: 'ط', familyName: 'ع', fatherName: 'م', birthDate: new Date('2015-01-01'),
      gender, nationality, nationalityCode, phoneNumber: `05${seq}`, email: `s${seq}-${schoolId}@t.test`,
      address: 'مكة', classId,
    });
  };

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');
    models.student = model(Student.name, StudentSchema);
    models.class = model(Class.name, ClassSchema);
    models.grade = model(GradeLevel.name, GradeLevelSchema);
    models.stage = model(Stage.name, StageSchema);
    models.year = model(AcademicYear.name, AcademicYearSchema);
    const schoolModel = model(School.name, SchoolSchema);
    service = new StudentStatisticsService(models.student, models.class, models.grade, models.stage, models.year, schoolModel, contextService);

    await run(async () => {
      const old = await models.year.create({ name: 'y1', startDate: new Date('2025-08-01'), endDate: new Date('2026-06-01'), status: 'archived' });
      const year = await models.year.create({ name: 'y2', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-01'), status: 'active' });
      const kg = await models.stage.create({ name: 'رياض الأطفال', order: 1 });
      const pri = await models.stage.create({ name: 'الابتدائية', order: 2 });
      const kg1 = await models.grade.create({ name: 'روضة أولى', order: 1, stageId: kg._id });
      const g1 = await models.grade.create({ name: 'الأول', order: 2, stageId: pri._id });
      const mk = (name: string, gradeLevelId: any, academicYearId: any, gender = 'female') =>
        models.class.create({ name, gradeLevelId, academicYearId, gender, maxCapacity: 30 });
      const a = await mk('روضة أ', kg1._id, year._id, 'both');
      const b = await mk('أول أ', g1._id, year._id);
      const empty = await mk('أول ب', g1._id, year._id);
      const archived = await mk('قديم', g1._id, old._id);
      Object.assign(ids, { kg: String(kg._id), pri: String(pri._id), g1: String(g1._id), a: String(a._id), b: String(b._id), empty: String(empty._id) });

      await student(a._id, 'male', 'المملكة العربية السعودية');
      await student(a._id, 'female', 'سعودي', 'SA');
      await student(a._id, 'male', 'اليمن');
      await student(b._id, 'female', 'المملكة العربية السعودية');
      await student(b._id, 'female', 'مصر');
      await student(b._id, 'female', '');
      await student(archived._id, 'female', 'مصر'); // last year's class: not counted
      const left = await student(b._id, 'male', 'مصر');
      await models.student.updateOne({ _id: left._id }, { isActive: false }); // inactive: not counted
    });
  });

  afterAll(async () => {
    await Promise.all(Object.values(models).map((m) => m.deleteMany({ schoolId })));
    await mongoose.disconnect();
  });

  it('counts the active year by gender and nationality, reading labels without codes', async () => {
    const r = await run(() => service.getStatistics());
    expect(r.total).toMatchObject({
      total: 6, male: 2, female: 4, saudi: 3, nonSaudi: 2, unspecifiedNationality: 1,
      maleSaudi: 1, maleNonSaudi: 1, femaleSaudi: 2, femaleNonSaudi: 1,
    });
    expect(r.byNationality.map((n: any) => [n.code, n.total])).toEqual([['SA', 3], ['YE', 1], ['EG', 1], [null, 1]]);
    expect(r.unspecifiedStudents).toHaveLength(1);
    expect(r.unspecifiedStudents[0]).toMatchObject({ name: 'ط م ع', className: 'أول أ' });
  });

  it('breaks down by stage, grade and class, keeping empty classes', async () => {
    const r = await run(() => service.getStatistics());
    expect(r.byStage.map((s: any) => [s.name, s.total, s.classCount])).toEqual([['رياض الأطفال', 3, 1], ['الابتدائية', 3, 2]]);
    expect(r.byClass.find((c: any) => c.classId === ids.empty)).toMatchObject({ total: 0, gradeLevelName: 'الأول', stageName: 'الابتدائية' });
    expect(r.byClass.some((c: any) => c.name === 'قديم')).toBe(false);
  });

  it('applies filters before every breakdown', async () => {
    const nonSaudi = await run(() => service.getStatistics({ nationality: 'non_saudi' }));
    expect(nonSaudi.total.total).toBe(2);
    expect(nonSaudi.byClass.find((c: any) => c.classId === ids.a).total).toBe(1);

    const girlsPrimary = await run(() => service.getStatistics({ stageId: ids.pri, gender: 'female' }));
    expect(girlsPrimary.total).toMatchObject({ total: 3, saudi: 1, nonSaudi: 1, unspecifiedNationality: 1 });
    expect(girlsPrimary.byStage.map((s: any) => s.stageId)).toEqual([ids.pri]);

    const egypt = await run(() => service.getStatistics({ nationality: 'eg', gender: '' as any }));
    expect(egypt.total.total).toBe(1);
  });

  it('refuses unknown filter values', async () => {
    await expect(run(() => service.getStatistics({ gender: 'x' }))).rejects.toThrow();
    await expect(run(() => service.getStatistics({ nationality: 'arab' }))).rejects.toThrow();
    await expect(run(() => service.getStatistics({ classId: 'nope' }))).rejects.toThrow();
  });
});
