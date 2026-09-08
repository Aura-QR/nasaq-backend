import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PreparationContentModule } from './preparation-content.module';
import { PreparationService } from './preparation.service';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { CurriculumService } from '../curriculum/curriculum.service';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { CaslModule } from '../casl/casl.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';

/**
 * Preparing a week in one press, with each period's own lesson.
 *
 * `POST /preparation/bulk` took a list of lectures and ONE `lessonTitle`
 * applied to all of them. That covers "the same lesson to three sections" and
 * nothing else — a teacher's actual week is six maths periods teaching six
 * different lessons, which the single-title form could not express, so she
 * filed them one at a time. `items` is that missing shape.
 */
describe('createBulk — a lesson per lecture', () => {
  let module: TestingModule;
  let preparation: PreparationService;
  let curriculum: CurriculumService;
  let catalog: CatalogService;

  const school = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const mathsSubject = new Types.ObjectId();
  const scienceSubject = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const mathsOffering = new Types.ObjectId();
  const scienceOffering = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const L1 = new Types.ObjectId();
  const L2 = new Types.ObjectId();
  const SCIENCE_LECTURE = new Types.ObjectId();

  const owner = {
    userId: String(new Types.ObjectId()),
    schoolId: String(school),
    role: 'OWNER',
    permissions: ['*'],
  };
  const req = { protocol: 'https', host: 'api.test' };

  const model = (name: string): any => module.get(getModelToken(name));
  const asA = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run(
      { schoolId: String(school), isAdminContext: false },
      async () => await fn(),
    );
  const insert = (name: string, doc: any) => model(name).collection.insertOne(doc);

  let mathsLessons: any[] = [];
  let scienceLesson: string;

  const bulk = (dto: any) =>
    asA(() => preparation.createBulk(dto as any, owner, req, []));

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(
          process.env.TEST_MONGODB_URI ||
            'mongodb://localhost:27017/nasaq-bulk-lesson-test',
          { dbName: 'nasaq-bulk-lesson-test' },
        ),
        MongooseModule.forFeature([
          { name: Lecture.name, schema: LectureSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Class.name, schema: ClassSchema },
        ]),
        PreparationContentModule,
        CurriculumModule,
        CatalogModule,
        CaslModule,
        TenancyModule,
      ],
      providers: [
        PreparationService,
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();

    preparation = module.get(PreparationService);
    curriculum = module.get(CurriculumService);
    catalog = module.get(CatalogService);

    await Promise.all(
      ['CurriculumUnit', 'CurriculumLesson', 'CatalogSubject', 'CatalogUnit', 'CatalogLesson'].map(
        (n) => model(n).init(),
      ),
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    for (const name of [
      'Preparation',
      'CurriculumUnit',
      'CurriculumLesson',
      'CatalogSubject',
      'CatalogUnit',
      'CatalogLesson',
      'Subject',
      'SubjectOffering',
      'GradeLevel',
      'Lecture',
      'Teacher',
      'Class',
    ]) {
      await model(name).collection.deleteMany({});
    }

    await insert('Subject', { _id: mathsSubject, schoolId: school, subjectName: 'رياضيات' });
    await insert('Subject', { _id: scienceSubject, schoolId: school, subjectName: 'علوم' });
    await insert('GradeLevel', { _id: gradeId, schoolId: school, name: 'السادس', order: 6 });
    await insert('SubjectOffering', {
      _id: mathsOffering,
      schoolId: school,
      subjectId: mathsSubject,
      gradeLevelId: gradeId,
    });
    await insert('SubjectOffering', {
      _id: scienceOffering,
      schoolId: school,
      subjectId: scienceSubject,
      gradeLevelId: gradeId,
    });
    await insert('Class', {
      _id: classId,
      schoolId: school,
      name: 'س/1',
      gradeLevelId: gradeId,
    });
    await insert('Teacher', {
      _id: teacherId,
      schoolId: school,
      name: 'سمر',
      email: 'samar@example.test',
    });
    for (const [id, offering, slot] of [
      [L1, mathsOffering, 1],
      [L2, mathsOffering, 2],
      [SCIENCE_LECTURE, scienceOffering, 3],
    ] as any[]) {
      await insert('Lecture', {
        _id: id,
        schoolId: school,
        classId,
        subjectOfferingId: offering,
        teacherId,
        preparation: [],
        dayOfWeek: 'sunday',
        slot,
      });
    }

    // The school's own curriculum, imported from the platform catalogue —
    // exactly the path a real school takes.
    const maths = await catalog.seedSubject({
      subjectId: '900101',
      subjectName: 'الرياضيات',
      lessons: [
        { id: '900101,1,1', unit: 'الإحصاء', lessonName: 'المتوسط الحسابي' },
        { id: '900101,1,2', unit: 'الإحصاء', lessonName: 'التمثيل بالأعمدة' },
      ],
    } as any);
    await asA(() =>
      curriculum.import({
        catalogSubjectId: String(maths.subjectId),
        subjectId: String(mathsSubject),
        gradeLevelId: String(gradeId),
      } as any),
    );
    const mathsUnits = await asA(() => curriculum.listUnits({} as any));
    mathsLessons = await asA(() =>
      curriculum.listLessons(String(mathsUnits[0]._id)),
    );

    const science = await catalog.seedSubject({
      subjectId: '900202',
      subjectName: 'العلوم',
      lessons: [{ id: '900202,1,1', unit: 'المادة', lessonName: 'حالات المادة' }],
    } as any);
    await asA(() =>
      curriculum.import({
        catalogSubjectId: String(science.subjectId),
        subjectId: String(scienceSubject),
        gradeLevelId: String(gradeId),
      } as any),
    );
    const scienceUnits = await asA(() =>
      curriculum.listUnits({ subjectId: String(scienceSubject) } as any),
    );
    scienceLesson = String(
      (await asA(() => curriculum.listLessons(String(scienceUnits[0]._id))))[0]._id,
    );
  });

  it('gives each lecture the lesson it was asked for', async () => {
    const result: any = await bulk({
      items: [
        { lectureId: String(L1), lessonId: String(mathsLessons[0]._id) },
        { lectureId: String(L2), lessonId: String(mathsLessons[1]._id) },
      ],
    });

    expect(result.created).toBe(2);

    const rows = await model('Preparation').collection.find({}).toArray();
    const titleByLecture = new Map(
      rows.map((r: any) => [String(r.lecture), r.lessonTitle]),
    );
    expect(titleByLecture.get(String(L1))).toBe('المتوسط الحسابي');
    expect(titleByLecture.get(String(L2))).toBe('التمثيل بالأعمدة');
  });

  it('stores the lesson reference, not just its name', async () => {
    await bulk({ items: [{ lectureId: String(L1), lessonId: String(mathsLessons[0]._id) }] });

    const row: any = await model('Preparation').collection.findOne({});
    expect(String(row.lessonId)).toBe(String(mathsLessons[0]._id));
  });

  it("brings the school's own objectives across, which is the point of picking a lesson", async () => {
    await asA(() =>
      curriculum.updateLesson(String(mathsLessons[0]._id), {
        objectives: ['أن يحسب المتوسط الحسابي'],
      } as any),
    );

    await bulk({ items: [{ lectureId: String(L1), lessonId: String(mathsLessons[0]._id) }] });

    const row: any = await model('Preparation').collection.findOne({});
    expect(row.objectives).toEqual(['أن يحسب المتوسط الحسابي']);
  });

  it('prepares two subjects in one press, each against its own curriculum', async () => {
    const result: any = await bulk({
      items: [
        { lectureId: String(L1), lessonId: String(mathsLessons[0]._id) },
        { lectureId: String(SCIENCE_LECTURE), lessonId: scienceLesson },
      ],
    });

    expect(result.created).toBe(2);
    const rows = await model('Preparation').collection.find({}).toArray();
    expect(rows.map((r: any) => r.lessonTitle).sort()).toEqual(
      ['المتوسط الحسابي', 'حالات المادة'].sort(),
    );
  });

  describe('a lesson that does not belong to its lecture', () => {
    it('is refused', async () => {
      await expect(
        bulk({ items: [{ lectureId: String(L1), lessonId: scienceLesson }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves nothing behind, even when it is the last item', async () => {
      // The check runs before any write. Without that, the first item's
      // preparation would survive a request that failed.
      await expect(
        bulk({
          items: [
            { lectureId: String(L1), lessonId: String(mathsLessons[0]._id) },
            { lectureId: String(SCIENCE_LECTURE), lessonId: String(mathsLessons[1]._id) },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(await model('Preparation').collection.countDocuments()).toBe(0);
    });

    it('is refused for a lesson id that exists nowhere', async () => {
      await expect(
        bulk({
          items: [{ lectureId: String(L1), lessonId: String(new Types.ObjectId()) }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('still accepts an item with no lesson, for a school with no curriculum yet', async () => {
    const result: any = await bulk({
      items: [{ lectureId: String(L1) }, { lectureId: String(L2) }],
      lessonTitle: 'مراجعة عامة',
    });

    expect(result.created).toBe(2);
    const rows = await model('Preparation').collection.find({}).toArray();
    expect(rows.every((r: any) => r.lessonTitle === 'مراجعة عامة')).toBe(true);
  });

  it('keeps the old lectureIds shape working', async () => {
    const result: any = await bulk({
      lectureIds: [String(L1), String(L2)],
      lessonTitle: 'حل المعادلات',
    });

    expect(result.created).toBe(2);
    const rows = await model('Preparation').collection.find({}).toArray();
    expect(rows.every((r: any) => r.lessonTitle === 'حل المعادلات')).toBe(true);
    expect(rows.every((r: any) => !r.lessonId)).toBe(true);
  });

  it('treats the same lecture twice as one', async () => {
    const result: any = await bulk({
      items: [
        { lectureId: String(L1), lessonId: String(mathsLessons[0]._id) },
        { lectureId: String(L1), lessonId: String(mathsLessons[1]._id) },
      ],
    });

    expect(result.created).toBe(1);
    expect(await model('Preparation').collection.countDocuments()).toBe(1);
  });

  it('refuses an empty request rather than reporting nothing done', async () => {
    await expect(bulk({ items: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bulk({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports the lesson each preparation was filed under', async () => {
    const result: any = await bulk({
      items: [{ lectureId: String(L1), lessonId: String(mathsLessons[0]._id) }],
    });
    expect(result.results[0]).toMatchObject({
      status: 'created',
      lessonTitle: 'المتوسط الحسابي',
    });
  });
});
