import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PreparationService } from './preparation.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { startOfWeek, lessonDateFor, toDateOnlyString } from './utils/week.util';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';

/**
 * A week deliberately far from "now". Preparations created without an explicit
 * weekOf default to the current week, and an overlap would make every count in
 * here ambiguous depending on the day the suite runs.
 */
const SAT = '2026-11-14'; // the Saturday that opens the week
const SUN = '2026-11-15';
const WED = '2026-11-18';

describe('PreparationService', () => {
  let moduleRef: TestingModule;
  let service: PreparationService;
  let prepModel: any;
  let lectureModel: any;
  let teacherModel: any;
  let classModel: any;
  let offeringModel: any;
  let subjectModel: any;

  const schoolId = new Types.ObjectId();
  const otherSchool = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeLevelId = new Types.ObjectId();
  const academicYearId = new Types.ObjectId();

  let offeringId: any;
  let classA: any;
  let classB: any;
  let teacherA: any;
  let teacherB: any;
  let L1: any;
  let L2: any;
  let L3: any;
  let unassigned: any;

  let OWNER: any;
  let MANAGER: any;
  let TEACHER_A: any;
  let TEACHER_B: any;
  const req = { protocol: 'https', host: 'api.test' };

  /**
   * Every request runs inside a tenant store; without one the tenant plugin
   * scopes each query to schoolId: null and nothing is findable.
   */
  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const mk = async (model: any, doc: any) =>
    (await model.collection.insertOne(doc)).insertedId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Preparation.name, schema: PreparationSchema },
          { name: Lecture.name, schema: LectureSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Class.name, schema: ClassSchema },
          { name: SubjectOffering.name, schema: SubjectOfferingSchema },
          { name: Subject.name, schema: SubjectSchema },
        ]),
      ],
      providers: [PreparationService],
    }).compile();

    service = moduleRef.get(PreparationService);
    prepModel = moduleRef.get(getModelToken(Preparation.name));
    lectureModel = moduleRef.get(getModelToken(Lecture.name));
    teacherModel = moduleRef.get(getModelToken(Teacher.name));
    classModel = moduleRef.get(getModelToken(Class.name));
    offeringModel = moduleRef.get(getModelToken(SubjectOffering.name));
    subjectModel = moduleRef.get(getModelToken(Subject.name));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const m of [
      prepModel,
      lectureModel,
      teacherModel,
      classModel,
      offeringModel,
      subjectModel,
    ]) {
      await m.collection.deleteMany({});
    }

    const subjectId = await mk(subjectModel, {
      subjectName: 'رياضيات',
      isRequiredForPromotion: true,
      schoolId,
    });
    offeringId = await mk(offeringModel, {
      subjectId,
      gradeLevelId,
      termId,
      schoolId,
    });

    const mkClass = (name: string, roomNumber: string, school = schoolId) =>
      mk(classModel, {
        name,
        gradeLevelId,
        academicYearId,
        gender: 'male',
        roomNumber,
        maxCapacity: 30,
        isActive: true,
        schoolId: school,
      });

    classA = await mkClass('أول/١', '101');
    classB = await mkClass('أول/٢', '102');

    teacherA = await mk(teacherModel, {
      name: 'أ. محمد',
      email: 'm@x.com',
      schoolId,
    });
    teacherB = await mk(teacherModel, {
      name: 'أ. سارة',
      email: 's@x.com',
      schoolId,
    });

    const lec = (classId: any, teacherId: any, dayOfWeek: string, slot: number) =>
      mk(lectureModel, {
        classId,
        subjectOfferingId: offeringId,
        termId,
        teacherId,
        dayOfWeek,
        slot,
        preparation: [],
        schoolId,
      });

    L1 = await lec(classA, teacherA, 'sunday', 1);
    L2 = await lec(classB, teacherA, 'sunday', 2);
    L3 = await lec(classA, teacherA, 'monday', 1);
    await lec(classA, teacherB, 'tuesday', 1);
    unassigned = await lec(classB, null, 'wednesday', 3);

    OWNER = { userId: String(new Types.ObjectId()), role: 'OWNER', schoolId, name: 'المالك' };
    MANAGER = { userId: String(new Types.ObjectId()), role: 'MANAGER', schoolId, name: 'المدير' };
    TEACHER_A = { userId: String(teacherA), role: 'TEACHER', schoolId, name: 'أ. محمد' };
    TEACHER_B = { userId: String(teacherB), role: 'TEACHER', schoolId, name: 'أ. سارة' };
  });

  /** The row a MANAGER files, which used to save with no owner at all. */
  const createByManager = () =>
    asTenant(() =>
      service.create(
        { lecture: String(L1), lessonTitle: 'حل المعادلات' } as any,
        MANAGER.userId,
        req,
        [],
        MANAGER,
      ),
    );

  /** A row pinned to the test week, so counts do not depend on today's date. */
  const createInTestWeek = () =>
    asTenant(() =>
      service.create(
        { lecture: String(L2), weekOf: WED } as any,
        OWNER.userId,
        req,
        [],
        OWNER,
      ),
    );

  describe('create', () => {
    it('records the teacher when a MANAGER files on their behalf', async () => {
      const result = await createByManager();
      const raw = await prepModel.collection.findOne({
        _id: new Types.ObjectId(result.data._id),
      });

      // create() used to name TEACHER, SUPERVISOR and OWNER explicitly, so a
      // MANAGER fell through every branch and the row saved submittedBy: null.
      expect(String(raw.submittedBy)).toBe(String(teacherA));
      expect(raw.name).toBe('أ. محمد');
    });

    it('stores the lesson title and denormalises class and term', async () => {
      const result = await createByManager();
      const raw = await prepModel.collection.findOne({
        _id: new Types.ObjectId(result.data._id),
      });

      expect(raw.lessonTitle).toBe('حل المعادلات');
      expect(String(raw.classId)).toBe(String(classA));
      expect(String(raw.termId)).toBe(String(termId));
      expect(raw.reviewStatus).toBe('pending');
    });

    it('defaults to the current week and does not flag it as a guess', async () => {
      const result = await createByManager();
      const raw = await prepModel.collection.findOne({
        _id: new Types.ObjectId(result.data._id),
      });

      expect(String(raw.weekOf)).toBe(String(startOfWeek(new Date())));
      expect(raw.isWeekEstimated).toBe(false);
    });

    it('anchors any day inside a week to that week, and derives the lesson date', async () => {
      const result = await createInTestWeek();

      expect(result.data.weekOf).toBe(SAT);
      // The teacher picked a week; sunday came from the lecture.
      expect(result.data.lessonDate).toBe(SUN);
    });

    it('refuses a lecture with no teacher instead of saving an orphan', async () => {
      await expect(
        asTenant(() =>
          service.create({ lecture: String(unassigned) } as any, OWNER.userId, req, [], OWNER),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('filtering', () => {
    it('rejects an unknown filter by name rather than returning an empty list', async () => {
      // The old code assigned every unrecognised key straight into the query,
      // so a typo came back as a cheerful "no results".
      await expect(
        asTenant(() => service.filtering({ nonsenseKey: 'x' }, {}, OWNER, req)),
      ).rejects.toMatchObject({ status: 400 });

      try {
        await asTenant(() => service.filtering({ nonsenseKey: 'x' }, {}, OWNER, req));
      } catch (error: any) {
        expect(JSON.stringify(error.response.message)).toContain('nonsenseKey');
      }
    });

    it('filters by class, which lives on the lecture and was impossible before', async () => {
      await createByManager();
      await createInTestWeek();

      const result: any = await asTenant(() =>
        service.filtering({ classId: String(classA) }, {}, OWNER, req),
      );

      expect(result).toHaveLength(1);
      expect(String(result[0].classId)).toBe(String(classA));
    });

    it('matches a week from any day inside it, and excludes other weeks', async () => {
      const inWeek = await createInTestWeek();

      const hit: any = await asTenant(() => service.filtering({ weekOf: WED }, {}, OWNER, req));
      expect(hit).toHaveLength(1);
      expect(String(hit[0]._id)).toBe(String(inWeek.data._id));

      const miss: any = await asTenant(() =>
        service.filtering({ weekOf: '2026-12-05' }, {}, OWNER, req),
      );
      expect(miss).toHaveLength(0);
    });

    it('matches a lesson title partially', async () => {
      await createByManager();

      const result: any = await asTenant(() =>
        service.filtering({ lessonTitle: 'معادلات' }, {}, OWNER, req),
      );
      expect(result).toHaveLength(1);
    });

    it('honours the aliases the frontend already sends', async () => {
      await createByManager();
      await createInTestWeek();

      // Both of these used to match nothing, which is why the frontend grew a
      // fallback chain down to `lecture`.
      const byTeacher: any = await asTenant(() =>
        service.filtering({ teacherId: String(teacherA) }, {}, OWNER, req),
      );
      expect(byTeacher).toHaveLength(2);

      const byLectureId: any = await asTenant(() =>
        service.filtering({ lectureId: String(L1) }, {}, OWNER, req),
      );
      expect(byLectureId).toHaveLength(1);

      const byLecture: any = await asTenant(() =>
        service.filtering({ lecture: String(L1) }, {}, OWNER, req),
      );
      expect(byLecture).toHaveLength(1);
    });

    it('does not mistake pagination for a filter', async () => {
      await createByManager();
      await createInTestWeek();

      const result: any = await asTenant(() =>
        service.filtering({ page: 1, limit: 10 }, { page: 1, limit: 10 }, OWNER, req),
      );
      expect(result.data).toHaveLength(2);
      expect(result.totalDocs).toBe(2);
    });

    it('confines a teacher to their own work however they ask', async () => {
      await createByManager();
      await createInTestWeek();

      const otherTeacher: any = await asTenant(() => service.filtering({}, {}, TEACHER_B, req));
      expect(otherTeacher).toHaveLength(0);

      const widened: any = await asTenant(() =>
        service.filtering({ teacherId: String(teacherB) }, {}, TEACHER_A, req),
      );
      expect(widened).toHaveLength(2);
    });

    it('hides other schools', async () => {
      await createByManager();

      const foreignTeacher = await mk(teacherModel, {
        name: 'غريب',
        email: 'f@x.com',
        schoolId: otherSchool,
      });
      await mk(prepModel, {
        lecture: new Types.ObjectId(),
        subject: offeringId,
        submittedBy: foreignTeacher,
        name: 'غريب',
        files: [],
        schoolId: otherSchool,
        weekOf: startOfWeek(SAT),
        reviewStatus: 'pending',
      });

      const result: any = await asTenant(() => service.filtering({}, {}, OWNER, req));
      expect(result.every((p: any) => String(p.schoolId) === String(schoolId))).toBe(true);
    });
  });

  describe('permission failures', () => {
    it('answers 403, not 500, when a teacher reaches for another teacher\'s work', async () => {
      const mine = await createByManager();

      await expect(
        asTenant(() => service.update(String(mine.data._id), {} as any, req, [], TEACHER_B)),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('survives a row with no owner at all', async () => {
      // Exactly the rows the MANAGER bug produced. Calling .toString() on a
      // null submittedBy turned a permission check into a crash.
      const orphan = await mk(prepModel, {
        lecture: L3,
        subject: offeringId,
        submittedBy: null,
        name: '',
        files: [],
        schoolId,
        reviewStatus: 'pending',
      });

      await expect(
        asTenant(() => service.update(String(orphan), {} as any, req, [], TEACHER_A)),
      ).rejects.toMatchObject({ status: 403 });

      await expect(
        asTenant(() => service.delete(String(orphan), TEACHER_A)),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('answers 400 when asked to add no files', async () => {
      const mine = await createByManager();

      await expect(
        asTenant(() => service.addFiles(String(mine.data._id), req, [], OWNER)),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('getWeekly', () => {
    it('reports the gaps, which the plain list can never show', async () => {
      await createByManager();  // current week — deliberately not the test week
      await createInTestWeek();

      const week: any = await asTenant(() =>
        service.getWeekly({ weekOf: WED, teacherId: String(teacherA) }, OWNER, req),
      );

      expect(week.weekOf).toBe(SAT);
      // Counted from the timetable, not from what was uploaded.
      expect(week.stats.total).toBe(3);
      expect(week.stats.submitted).toBe(1);
      expect(week.stats.missing).toBe(2);
    });

    it('hangs each preparation off its slot and leaves the rest null', async () => {
      await createInTestWeek();

      const week: any = await asTenant(() =>
        service.getWeekly({ weekOf: WED, teacherId: String(teacherA) }, OWNER, req),
      );

      const sunday = week.days.find((d: any) => d.dayOfWeek === 'sunday');
      expect(sunday.date).toBe(SUN);
      expect(sunday.slots.find((s: any) => s.slot === 2).preparation).not.toBeNull();
      expect(sunday.slots.find((s: any) => s.slot === 1).preparation).toBeNull();

      const slot1 = sunday.slots.find((s: any) => s.slot === 1);
      expect(slot1.class.name).toBe('أول/١');
      expect(slot1.subject.name).toBe('رياضيات');

      expect(week.days.every((d: any) => d.slots.length > 0)).toBe(true);
    });

    it('summarises per teacher, worst coverage first, when no teacher is named', async () => {
      await createInTestWeek();

      const summary: any = await asTenant(() =>
        service.getWeekly({ weekOf: SAT }, OWNER, req),
      );

      expect(summary.teachers).toHaveLength(2);
      expect(summary.teachers[0].percentage).toBeLessThanOrEqual(
        summary.teachers[1].percentage,
      );

      const rowA = summary.teachers.find((t: any) => t.teacher.name === 'أ. محمد');
      expect(rowA.percentage).toBe(33); // 1 of 3
      const rowB = summary.teachers.find((t: any) => t.teacher.name === 'أ. سارة');
      expect(rowB.submitted).toBe(0);
    });

    it('gives a teacher their own week whoever they ask about', async () => {
      const week: any = await asTenant(() =>
        service.getWeekly({ weekOf: SAT, teacherId: String(teacherB) }, TEACHER_A, req),
      );
      expect(String(week.teacher._id)).toBe(String(teacherA));
    });
  });

  describe('review', () => {
    it('records the outcome, the reason and the reviewer', async () => {
      const prep = await createByManager();

      const reviewed: any = await asTenant(() =>
        service.review(
          String(prep.data._id),
          { reviewStatus: 'needs_revision', reviewNote: 'الأهداف ناقصة' },
          MANAGER,
          req,
        ),
      );

      expect(reviewed.data.reviewStatus).toBe('needs_revision');
      expect(reviewed.data.reviewNote).toBe('الأهداف ناقصة');
      expect(String(reviewed.data.reviewedBy)).toBe(MANAGER.userId);
      expect(reviewed.data.reviewedByName).toBe('المدير');
      expect(reviewed.data.reviewedAt).toBeTruthy();
    });

    it('does not let a teacher approve their own', async () => {
      const prep = await createByManager();

      await expect(
        asTenant(() =>
          service.review(String(prep.data._id), { reviewStatus: 'approved' }, TEACHER_A, req),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('is filterable afterwards', async () => {
      const prep = await createByManager();
      await createInTestWeek();
      await asTenant(() =>
        service.review(String(prep.data._id), { reviewStatus: 'needs_revision' }, MANAGER, req),
      );

      const revised: any = await asTenant(() =>
        service.filtering({ reviewStatus: 'needs_revision' }, {}, OWNER, req),
      );
      expect(revised).toHaveLength(1);

      const pending: any = await asTenant(() =>
        service.filtering({ reviewStatus: 'pending' }, {}, OWNER, req),
      );
      expect(pending).toHaveLength(1);
    });
  });

  describe('after the Friday cleanup cron', () => {
    /**
     * The cron replaces `preparation.lecture` with a plain snapshot object,
     * which severs the ref. Everything below has to keep working across that.
     */
    const flatten = async (id: string) =>
      prepModel.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            lecture: {
              _id: String(L2),
              classId: { _id: String(classB), name: 'أول/٢' },
              dayOfWeek: 'sunday',
              slot: 2,
              subjectOfferingId: String(offeringId),
              termId: String(termId),
            },
          },
        },
      );

    it('still matches a snapshotted preparation to its slot', async () => {
      const prep = await createInTestWeek();
      await flatten(prep.data._id);

      const week: any = await asTenant(() =>
        service.getWeekly({ weekOf: SAT, teacherId: String(teacherA) }, OWNER, req),
      );
      expect(week.stats.submitted).toBe(1);
    });

    it('still filters by class — the whole reason it is denormalised', async () => {
      const prep = await createInTestWeek();
      await flatten(prep.data._id);

      const result: any = await asTenant(() =>
        service.filtering({ classId: String(classB) }, {}, OWNER, req),
      );
      expect(result).toHaveLength(1);
    });

    it('still derives the lesson date from the snapshot', async () => {
      const prep = await createInTestWeek();
      await flatten(prep.data._id);

      const one: any = await asTenant(() => service.findOne(String(prep.data._id), req));
      expect(one.weekOf).toBe(SAT);
      expect(one.lessonDate).toBe(SUN);
    });
  });

  describe('week maths', () => {
    it('anchors a Saturday to itself', () => {
      expect(toDateOnlyString(startOfWeek(SAT))).toBe(SAT);
    });

    it('keeps a Friday in the week that opened', () => {
      expect(toDateOnlyString(startOfWeek('2026-11-20'))).toBe(SAT);
    });

    it('opens a new week on the next Saturday', () => {
      expect(toDateOnlyString(startOfWeek('2026-11-21'))).toBe('2026-11-21');
    });

    it('resolves a weekday to its date inside the week', () => {
      expect(toDateOnlyString(lessonDateFor(startOfWeek(SAT), 'thursday'))).toBe('2026-11-19');
    });

    it('rejects a malformed date instead of producing an Invalid Date', () => {
      expect(() => startOfWeek('not-a-date')).toThrow(/غير صالحة/);
    });
  });
});
