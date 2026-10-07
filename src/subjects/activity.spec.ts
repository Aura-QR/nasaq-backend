import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Subject, SubjectSchema } from './schemas/subject.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Preparation, PreparationSchema } from '../preparation/schemas/preparation.schema';
import { PreparationService } from '../preparation/preparation.service';
import { SubjectsService } from './subjects.service';
import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import { DailyTrackingService } from '../daily-tracking/daily-tracking.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { ACTIVITY_NOT_PREPARED, ACTIVITY_NOT_TRACKED, isActivityLecture } from './activity.util';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-activity${query}`,
);

/**
 * «نشاط غير دراسي» — a kindergarten breakfast or outdoor play period.
 *
 * On the timetable with its class teacher on it, so her day and the cover
 * board are whole; never prepared, tracked or graded. Every subject is off by
 * default, so nothing that existed before changes.
 */
describe('activity subjects (نشاط غير دراسي)', () => {
  let moduleRef: TestingModule;
  const models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  let termId: any;
  let classId: any;
  let teacherId: any;
  let breakfast: any;  // activity subject
  let reading: any;    // ordinary subject
  let breakfastLecture: any;
  let readingLecture: any;

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);
  const mk = async (model: any, doc: any) => (await model.collection.insertOne(doc)).insertedId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Subject.name, schema: SubjectSchema },
          { name: SubjectOffering.name, schema: SubjectOfferingSchema },
          { name: Lecture.name, schema: LectureSchema },
          { name: Class.name, schema: ClassSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Term.name, schema: TermSchema },
          { name: Preparation.name, schema: PreparationSchema },
          { name: GradeLevel.name, schema: GradeLevelSchema },
        ]),
      ],
    }).compile();
    for (const name of [
      Subject.name, SubjectOffering.name, Lecture.name, Class.name,
      Teacher.name, Term.name, Preparation.name,
    ]) {
      models[name] = moduleRef.get(getModelToken(name));
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(models)) await model.collection.deleteMany({});

    termId = await mk(models[Term.name], {
      academicYearId: yearId, name: 'الترم الأول', order: 1,
      startDate: new Date(), endDate: new Date(), status: 'active', schoolId,
    });
    classId = await mk(models[Class.name], {
      name: 'تمهيدي2', gradeLevelId: gradeId, academicYearId: yearId,
      gender: 'mixed', maxCapacity: 30, isActive: true, schoolId,
    });
    teacherId = await mk(models[Teacher.name], {
      name: 'أ. جوهرة', email: 'jawhara@x.com', isActive: true, schoolId,
    });
    breakfast = await mk(models[Subject.name], {
      subjectName: 'وجبة', isRequiredForPromotion: false, isActivity: true, schoolId,
    });
    reading = await mk(models[Subject.name], {
      subjectName: 'نقرأ ونكتب', isRequiredForPromotion: true, schoolId,
    });
    const offering = (subjectId: any) => mk(models[SubjectOffering.name], {
      subjectId, gradeLevelId: gradeId, termId, periodsPerWeek: 5, schoolId,
    });
    const breakfastOffering = await offering(breakfast);
    const readingOffering = await offering(reading);
    const lecture = (subjectOfferingId: any, slot: number) => mk(models[Lecture.name], {
      classId, subjectOfferingId, termId, teacherId, dayOfWeek: 'sunday', slot,
      preparation: [], schoolId,
    });
    breakfastLecture = await lecture(breakfastOffering, 1);
    readingLecture = await lecture(readingOffering, 2);
  });

  const preparationService = () =>
    new PreparationService(
      models[Preparation.name], models[Lecture.name], models[Teacher.name],
      { resourceCounts: async () => new Map() } as any,
    );
  const TEACHER = () => ({ userId: String(teacherId), role: 'TEACHER', schoolId: String(schoolId) });

  it('is off for every subject that does not say otherwise', async () => {
    const doc: any = await models[Subject.name].collection.findOne({ _id: reading });
    const fresh = new models[Subject.name]({ subjectName: 'العلوم' });
    expect(doc.isActivity).toBeUndefined(); // stored before the flag existed
    expect(fresh.isActivity).toBe(false);
  });

  describe('preparation', () => {
    it('leaves activity periods out of the teacher\'s week', async () => {
      const week: any = await asTenant(() =>
        preparationService().getWeekly({ termId: String(termId) }, TEACHER()),
      );
      expect(week.stats.total).toBe(1);
      const ids = week.days.flatMap((d: any) => d.slots.map((s: any) => s.lectureId));
      expect(ids).toEqual([String(readingLecture)]);
    });

    it('leaves them out of the whole-school summary too', async () => {
      const summary: any = await asTenant(() =>
        preparationService().getWeekly({ termId: String(termId) }, { role: 'OWNER' }),
      );
      expect(summary.stats.total).toBe(1);
    });

    it('refuses a preparation for an activity period', async () => {
      await expect(
        asTenant(() =>
          preparationService().create(
            { lecture: String(breakfastLecture) } as any, String(teacherId), {} as any, [], TEACHER(),
          ),
        ),
      ).rejects.toThrow(ACTIVITY_NOT_PREPARED);
    });

    it('refuses a bulk batch that includes one', async () => {
      await expect(
        asTenant(() =>
          preparationService().createBulk(
            { lectureIds: [String(readingLecture), String(breakfastLecture)] } as any, TEACHER(),
          ),
        ),
      ).rejects.toThrow(ACTIVITY_NOT_PREPARED);
    });
  });

  it('daily tracking refuses a save on an activity period', async () => {
    const lectureDoc: any = await asTenant(() =>
      models[Lecture.name]
        .findById(breakfastLecture)
        .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
        .lean()
        .exec(),
    );
    expect(isActivityLecture(lectureDoc)).toBe(true);

    const service = new DailyTrackingService(
      {} as any,
      {
        findById: () => ({ populate: function () { return this; }, exec: async () => lectureDoc }),
      } as any,
      {} as any, {} as any, {} as any, undefined,
    );
    await expect(
      service.bulkUpsert(
        { lectureId: String(breakfastLecture), date: '2026-10-04', records: [] } as any,
        TEACHER(),
      ),
    ).rejects.toThrow(ACTIVITY_NOT_TRACKED);
  });

  describe('subjects', () => {
    const subjectsService = () =>
      new SubjectsService(
        models[Subject.name], {} as any, {} as any, {} as any, {} as any, {} as any,
        {} as any, models[Class.name], {} as any, models[SubjectOffering.name], {} as any,
        { resolveClassIds: async () => [String(classId)] } as any,
      );

    it('an activity never counts towards passing, whatever was sent', async () => {
      const res: any = await asTenant(() =>
        subjectsService().create({ subjectName: 'لعب بالخارج', isActivity: true, isRequiredForPromotion: true } as any),
      );
      expect(res.subject.isActivity).toBe(true);
      expect(res.subject.isRequiredForPromotion).toBe(false);

      const updated: any = await asTenant(() =>
        subjectsService().update(String(reading), { isActivity: true, isRequiredForPromotion: true } as any),
      );
      expect(updated.isRequiredForPromotion).toBe(false);
    });

    it('is left out of the student\'s subject list', async () => {
      const res: any = await asTenant(() => subjectsService().getMySubjects(String(new Types.ObjectId())));
      expect(res.data.map((s: any) => s.subjectName)).toEqual(['نقرأ ونكتب']);
    });
  });

  describe('grades', () => {
    const gradesService = () =>
      new GradesCriteriaService(
        {} as any, models[Subject.name], {} as any, {} as any, {} as any, {} as any,
        {} as any, models[Class.name], {} as any, {} as any, {} as any,
        models[SubjectOffering.name], models[Term.name], { findById: () => ({ select: () => ({ exec: async () => null }) }) } as any,
        { getSchoolId: () => null } as any,
        { resolveClassIds: async () => [String(classId)] } as any,
      );

    it('has no yearly result, so it never decides promotion', async () => {
      const service = gradesService();
      const spy = jest
        .spyOn(service, 'calculateStudentTermGrade')
        .mockResolvedValue({ percentage: 90, hasGrade: true } as any);

      const results: any[] = await asTenant(() =>
        service.calculateStudentYearlySubjectResults(String(new Types.ObjectId()), String(gradeId), String(yearId)),
      );
      expect(results.map((r) => r.subjectName)).toEqual(['نقرأ ونكتب']);
      spy.mockRestore();
    });

    it('is not among the student\'s graded subjects', async () => {
      const res: any = await asTenant(() => gradesService().getMySubjects(String(new Types.ObjectId())));
      expect(res.data.map((o: any) => o.subjectId?.subjectName)).toEqual(['نقرأ ونكتب']);
    });
  });
});
