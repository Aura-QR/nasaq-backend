import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Types } from 'mongoose';
import * as request from 'supertest';
import { PreparationContentModule } from './preparation-content.module';
import { PreparationContentService } from './preparation-content.service';
import { PreparationService } from './preparation.service';
import { LessonContentService } from './lesson-content.service';
import { ExamsModule } from '../exams/exams.module';
import { PreparationController } from './preparation.controller';
import { CurriculumModule } from '../curriculum/curriculum.module';
import { CurriculumService } from '../curriculum/curriculum.service';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { LibraryModule } from '../library/library.module';
import { LibraryService } from '../library/library.service';
import { CaslModule } from '../casl/casl.module';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import { TenancyModule } from '../tenancy/tenancy.module';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { REQUIRED_RESOURCE_MESSAGE } from './constants/preparation-constants';
import { unlink } from 'fs/promises';
import { join } from 'path';

describe('Structured preparation integration', () => {
  let module: TestingModule, app: INestApplication;
  let content: PreparationContentService,
    preparation: PreparationService,
    curriculum: CurriculumService,
    catalog: CatalogService,
    library: LibraryService;
  const schoolA = new Types.ObjectId(),
    schoolB = new Types.ObjectId();
  const teacherId = new Types.ObjectId(),
    otherTeacher = new Types.ObjectId(),
    studentId = new Types.ObjectId();
  const subjectId = new Types.ObjectId(),
    gradeId = new Types.ObjectId(),
    offeringId = new Types.ObjectId(),
    classId = new Types.ObjectId(),
    lectureId = new Types.ObjectId();
  const users: Record<string, any> = {
    teacher: {
      userId: String(teacherId),
      schoolId: String(schoolA),
      role: 'TEACHER',
      permissions: [
        'school.preparation.create',
        'school.preparation.read',
        'school.preparation.update',
        'school.preparation.delete',
      ],
    },
    other: {
      userId: String(otherTeacher),
      schoolId: String(schoolA),
      role: 'TEACHER',
      permissions: ['school.preparation.update', 'school.preparation.read'],
    },
    owner: {
      userId: String(new Types.ObjectId()),
      schoolId: String(schoolA),
      role: 'OWNER',
      permissions: ['*'],
    },
    ownerB: {
      userId: String(new Types.ObjectId()),
      schoolId: String(schoolB),
      role: 'OWNER',
      permissions: ['*'],
    },
    student: {
      userId: String(studentId),
      schoolId: String(schoolA),
      role: 'STUDENT',
      permissions: ['school.preparation.read'],
    },
    platform: {
      userId: String(new Types.ObjectId()),
      schoolId: null,
      role: 'SUPER_ADMIN',
      permissions: ['*'],
    },
  };
  const fakeAuth = {
    canActivate: (ctx: any) => {
      const req = ctx.switchToHttp().getRequest();
      req.user = users[req.headers['x-test-user']];
      return !!req.user;
    },
  };
  const model = (name: string): any => module.get(getModelToken(name));
  const tenant = <T>(school: Types.ObjectId, fn: () => Promise<T>) =>
    tenantLocalStorage.run(
      { schoolId: String(school), isAdminContext: false },
      async () => await fn(),
    );
  const asA = <T = any>(fn: () => Promise<T>) => tenant(schoolA, fn);
  const insert = (name: string, doc: any) =>
    model(name).collection.insertOne(doc);
  const req = { protocol: 'https', host: 'api.test' };
  let lessonId: string, libraryId: string, catalogId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(
          process.env.TEST_MONGODB_URI ||
            'mongodb://localhost:27017/nasaq-structured-test',
          { dbName: 'nasaq-structured-test' },
        ),
        MongooseModule.forFeature([
          { name: Lecture.name, schema: LectureSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Class.name, schema: ClassSchema },
        ]),
        PreparationContentModule,
        ExamsModule,
        CurriculumModule,
        CatalogModule,
        LibraryModule,
        CaslModule,
        TenancyModule,
      ],
      controllers: [PreparationController],
      providers: [
        PreparationService,
        // The controller gained POST /:id/generate. Nothing here exercises it
        // — the service has its own suite — but Nest resolves the constructor.
        LessonContentService,
        { provide: APP_GUARD, useValue: fakeAuth },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: AbilitiesGuard },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(fakeAuth)
      .compile();
    content = module.get(PreparationContentService);
    preparation = module.get(PreparationService);
    curriculum = module.get(CurriculumService);
    catalog = module.get(CatalogService);
    library = module.get(LibraryService);
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    await Promise.all(
      [
        'CurriculumUnit',
        'CurriculumLesson',
        'CatalogSubject',
        'CatalogUnit',
        'CatalogLesson',
      ].map((n) => model(n).init()),
    );
  });
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const name of [
      'Preparation',
      'PreparationResource',
      'CurriculumUnit',
      'CurriculumLesson',
      'CatalogSubject',
      'CatalogUnit',
      'CatalogLesson',
      'Library',
      'Subject',
      'SubjectOffering',
      'GradeLevel',
      'Lecture',
      'Teacher',
      'Class',
      'Student',
      'Enrollment',
      'Exam',
      'Project',
    ]) {
      await model(name).collection.deleteMany({});
    }
    await insert('Subject', {
      _id: subjectId,
      schoolId: schoolA,
      subjectName: 'رياضيات',
    });
    await insert('GradeLevel', {
      _id: gradeId,
      schoolId: schoolA,
      name: 'الأول',
      order: 1,
    });
    await insert('SubjectOffering', {
      _id: offeringId,
      schoolId: schoolA,
      subjectId,
      gradeLevelId: gradeId,
    });
    await insert('Class', {
      _id: classId,
      schoolId: schoolA,
      gradeLevelId: gradeId,
      name: 'أول أ',
    });
    await insert('Teacher', {
      _id: teacherId,
      schoolId: schoolA,
      name: 'المعلم',
      email: 'test@example.com',
    });
    await insert('Lecture', {
      _id: lectureId,
      schoolId: schoolA,
      classId,
      subjectOfferingId: offeringId,
      teacherId,
      preparation: [],
      dayOfWeek: 'sunday',
      slot: 1,
    });
    await insert('Student', {
      _id: studentId,
      schoolId: schoolA,
      classId,
      email: 'student@example.com',
    });
    const seeded = await catalog.seedSubject({
      subjectId: '900001',
      subjectName: 'رياضيات',
      lessons: [
        { id: '900001,1,1', unit: 'الجمع', lessonName: 'الأعداد' },
        { id: '900001,1,2,3', unit: 'الجمع', lessonName: 'تدريب -- الجمع' },
      ],
    });
    catalogId = String(seeded.subjectId);
    await asA(() =>
      curriculum.import({
        catalogSubjectId: catalogId,
        subjectId: String(subjectId),
        gradeLevelId: String(gradeId),
      }),
    );
    const units = await asA(() => curriculum.listUnits({}));
    lessonId = String(
      (await asA(() => curriculum.listLessons(String(units[0]._id))))[0]._id,
    );
    const item = await asA(() =>
      library.create({
        title: 'شرح الدرس',
        link: 'https://example.com/lesson',
        subjectOfferingId: String(offeringId),
      }),
    );
    libraryId = String(item._id);
  });
  const draft = (fields: any = {}) =>
    asA(() =>
      preparation.create(
        { lecture: String(lectureId), ...fields },
        users.teacher.userId,
        req,
        [],
        users.teacher,
      ),
    );
  const completeDraft = async () => {
    const result = await draft({
      lessonId,
      objectives: ['هدف المدرسة أ'],
      digitalContentIds: [libraryId],
      warmUp: 'تمهيد',
      teachingStrategies: ['سري'],
      teachingAids: ['سري'],
      strategiesOther: 'سري',
    });
    await asA(() =>
      content.createResource(
        String(result.data._id),
        { type: 'homework', title: 'واجب' },
        users.teacher,
      ),
    );
    return String(result.data._id);
  };
  const http = (method: string, path: string, user = 'teacher') =>
    request(app.getHttpServer())[method](path).set('x-test-user', user);

  it('saves an empty-content draft even before selecting a lesson', async () => {
    const result = await http('post', '/preparation')
      .send({ lecture: String(lectureId) })
      .expect(201);
    expect(result.body.data).toMatchObject({
      reviewStatus: 'draft',
      objectives: [],
      digitalContentIds: [],
      lessonId: null,
    });
  });
  it('never permits clients to choose status or school', async () => {
    await http('post', '/preparation')
      .send({ lecture: String(lectureId), reviewStatus: 'pending' })
      .expect(400);
    await http('post', '/curriculum/units', 'owner')
      .send({
        subjectId: String(subjectId),
        gradeLevelId: String(gradeId),
        schoolId: String(schoolB),
        name: 'test',
        order: 1,
      })
      .expect(400);
  });
  it('refuses submit without a resource with the exact Arabic message', async () => {
    const result = await draft();
    const response = await http(
      'post',
      '/preparation/' + result.data._id + '/submit',
    ).expect(400);
    expect(response.body.message).toBe(REQUIRED_RESOURCE_MESSAGE);
  });
  it.each([
    ['objectives', []],
    ['objectives', ['  ']],
    ['digitalContentIds', []],
    ['lessonId', null],
  ])('requires %s on submit', async (field, value) => {
    const id = await completeDraft();
    await model('Preparation').collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { [field]: value } },
    );
    await http('post', '/preparation/' + id + '/submit').expect(400);
  });
  /*
   * One rule, three readers.
   *
   * `submit()` has always enforced these four requirements, but nothing else
   * could see them: the list returned rows without `resources` or
   * `digitalContentIds`, and `/weekly` counted `reviewStatus !== 'draft'`
   * instead. So the same week read "20 prepared" on the teacher's page and
   * "17 missing" from the API, and the two screens grew their own copies of
   * the rule and fetched every preparation individually to feed them.
   */
  it.each([
    ['objectives', []],
    ['digitalContentIds', []],
    ['lessonId', null],
  ])(
    'reports isComplete=false and counts as missing without %s',
    async (field, value) => {
      const id = await completeDraft();
      await model('Preparation').collection.updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { [field]: value } },
      );

      const list = await http('get', '/preparation?page=1&limit=50').expect(200);
      const row = list.body.data.find((item: any) => String(item._id) === id);
      expect(row.isComplete).toBe(false);

      const week = await http('get', '/preparation/weekly').expect(200);
      expect(week.body.stats.submitted).toBe(0);

      // And the gate agrees, which is the whole point.
      await http('post', '/preparation/' + id + '/submit').expect(400);
    },
  );

  it('reports isComplete=true for a preparation submit accepts', async () => {
    const id = await completeDraft();

    const list = await http('get', '/preparation?page=1&limit=50').expect(200);
    const row = list.body.data.find((item: any) => String(item._id) === id);
    expect(row.isComplete).toBe(true);

    const week = await http('get', '/preparation/weekly').expect(200);
    expect(week.body.stats.submitted).toBe(1);
    expect(week.body.stats.missing).toBe(week.body.stats.total - 1);

    await http('post', '/preparation/' + id + '/submit').expect(201);
  });

  /*
   * Sending it for review does not make it "more finished" — it was already
   * finished, which is what let it be sent. The counter must not move.
   */
  it('counts a finished preparation the same before and after submitting', async () => {
    const id = await completeDraft();
    const before = await http('get', '/preparation/weekly').expect(200);
    await http('post', '/preparation/' + id + '/submit').expect(201);
    const after = await http('get', '/preparation/weekly').expect(200);
    expect(after.body.stats.submitted).toBe(before.body.stats.submitted);
  });

  it('submits with homework, backfills objectives and preserves a manager override', async () => {
    const id = await completeDraft();
    const result = await http('post', '/preparation/' + id + '/submit').expect(
      201,
    );
    expect(result.body.data.reviewStatus).toBe('pending');
    expect(
      (await asA(() => model('CurriculumLesson').findById(lessonId)))
        .objectives,
    ).toEqual(['هدف المدرسة أ']);
    await asA(() =>
      curriculum.updateLesson(lessonId, { objectives: ['اختيار المدير'] }),
    );
    const next = await completeDraft();
    await asA(() => content.submit(next, users.teacher));
    expect(
      (await asA(() => model('CurriculumLesson').findById(lessonId)))
        .objectives,
    ).toEqual(['اختيار المدير']);
  });
  it('prefills objectives but respects an explicitly empty editable list', async () => {
    await asA(() =>
      curriculum.updateLesson(lessonId, { objectives: ['اقتراح'] }),
    );
    expect((await draft({ lessonId })).data.objectives).toEqual(['اقتراح']);
    expect((await draft({ lessonId, objectives: [] })).data.objectives).toEqual(
      [],
    );
  });
  it('returns only student fields through both read endpoints and the list', async () => {
    const id = await completeDraft();
    await asA(() => content.submit(id, users.teacher));
    for (const route of [
      '/preparation/' + id + '/student-view',
      '/preparation/' + id,
    ]) {
      const response = await http('get', route, 'student').expect(200);
      expect(response.body).toMatchObject({
        warmUp: 'تمهيد',
        objectives: ['هدف المدرسة أ'],
      });
      for (const key of [
        'teachingStrategies',
        'teachingAids',
        'strategiesOther',
        'reviewNote',
        'submittedBy',
        'resources',
      ])
        expect(response.body).not.toHaveProperty(key);
      expect(response.body.lessonId).toBe(lessonId);
    }
    const list = await http('get', '/preparation', 'student').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('teachingStrategies');
    await http('get', '/preparation/weekly', 'student').expect(403);
  });
  it('student-view works with the existing student role that has no Preparation ability', async () => {
    const id = await completeDraft();
    await asA(() => content.submit(id, users.teacher));
    users.student.permissions = [];
    try {
      await http(
        'get',
        '/preparation/' + id + '/student-view',
        'student',
      ).expect(200);
    } finally {
      users.student.permissions = ['school.preparation.read'];
    }
  });
  it('hides drafts, other classes and withdrawn enrollments from students', async () => {
    const id = await completeDraft();
    await http('get', '/preparation/' + id + '/student-view', 'student').expect(
      404,
    );
    await asA(() => content.submit(id, users.teacher));
    await insert('Enrollment', {
      studentId,
      classId,
      schoolId: schoolA,
      status: 'withdrawn',
    });
    await http('get', '/preparation/' + id + '/student-view', 'student').expect(
      404,
    );
    await model('Enrollment').collection.deleteMany({});
    await model('Preparation').collection.updateOne(
      { _id: new Types.ObjectId(id) },
      { $set: { classId: new Types.ObjectId() } },
    );
    await http('get', '/preparation/' + id + '/student-view', 'student').expect(
      404,
    );
  });
  it('rejects another grade on create and patch without changing the saved lesson', async () => {
    const otherGrade = new Types.ObjectId();
    await insert('GradeLevel', {
      _id: otherGrade,
      schoolId: schoolA,
      name: 'آخر',
    });
    const unit = await asA(() =>
      curriculum.createUnit({
        subjectId: String(subjectId),
        gradeLevelId: String(otherGrade),
        name: 'آخر',
        order: 0,
      }),
    );
    const lesson = await asA(() =>
      curriculum.createLesson(String(unit._id), { name: 'آخر', order: 0 }),
    );
    await http('post', '/preparation')
      .send({ lecture: String(lectureId), lessonId: String(lesson._id) })
      .expect(400);
    const id = await completeDraft();
    await http('patch', '/preparation/' + id)
      .send({ lessonId: String(lesson._id) })
      .expect(400);
    expect(
      String((await asA(() => model('Preparation').findById(id))).lessonId),
    ).toBe(lessonId);
  });
  it('keeps legacy lessonTitle and submitted review status intact', async () => {
    const legacy = await insert('Preparation', {
      schoolId: schoolA,
      lecture: lectureId,
      subject: offeringId,
      lessonTitle: 'قديم',
      reviewStatus: 'pending',
      files: [],
    });
    const row: any = await asA(() =>
      preparation.findOne(String(legacy.insertedId), req),
    );
    expect(row).toMatchObject({
      lessonId: null,
      lessonTitle: 'قديم',
      reviewStatus: 'pending',
    });
  });
  it('isolates two imported trees and all objective suggestions', async () => {
    const subjectB = new Types.ObjectId(),
      gradeB = new Types.ObjectId();
    await insert('Subject', {
      _id: subjectB,
      schoolId: schoolB,
      subjectName: 'رياضيات',
    });
    await insert('GradeLevel', {
      _id: gradeB,
      schoolId: schoolB,
      name: 'الأول',
    });
    await tenant(schoolB, () =>
      curriculum.import({
        catalogSubjectId: catalogId,
        subjectId: String(subjectB),
        gradeLevelId: String(gradeB),
      }),
    );
    const unitB = (await tenant(schoolB, () => curriculum.listUnits({})))[0];
    const lessonsB = await tenant(schoolB, () =>
      curriculum.listLessons(String(unitB._id)),
    );
    const id = await completeDraft();
    await asA(() => content.submit(id, users.teacher));
    await asA(() =>
      curriculum.updateLesson(lessonId, { name: 'خاص بالمدرسة أ' }),
    );
    const after = await tenant(schoolB, () =>
      curriculum.listLessons(String(unitB._id)),
    );
    expect(after.map((l) => String(l._id))).not.toContain(lessonId);
    expect(after[0].name).toBe(lessonsB[0].name);
    expect(after.every((l) => l.objectives.length === 0)).toBe(true);
    const unitA = (await asA(() => curriculum.listUnits({})))[0];
    await expect(
      tenant(schoolB, () => curriculum.listLessons(String(unitA._id))),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('makes repeated and concurrent imports idempotent without overwriting edits', async () => {
    await asA(() =>
      curriculum.updateLesson(lessonId, { name: 'تعديل', objectives: ['خاص'] }),
    );
    const dto = {
      catalogSubjectId: catalogId,
      subjectId: String(subjectId),
      gradeLevelId: String(gradeId),
    };
    const repeated = await asA(() => curriculum.import(dto));
    expect(repeated).toEqual({ createdUnits: 0, createdLessons: 0 });
    expect(
      (await asA(() => model('CurriculumLesson').findById(lessonId))).name,
    ).toBe('تعديل');
    await model('CurriculumLesson').collection.deleteMany({});
    await model('CurriculumUnit').collection.deleteMany({});
    await asA(() =>
      Promise.all([curriculum.import(dto), curriculum.import(dto)]),
    );
    expect(await asA(() => model('CurriculumUnit').countDocuments())).toBe(1);
    expect(await asA(() => model('CurriculumLesson').countDocuments())).toBe(2);
  });
  it('resumes a partial import without losing school edits', async () => {
    await asA(() =>
      curriculum.updateLesson(lessonId, { objectives: ['محفوظ'] }),
    );
    await model('CurriculumLesson').collection.deleteOne({
      _id: { $ne: new Types.ObjectId(lessonId) },
    });
    const result = await asA(() =>
      curriculum.import({
        catalogSubjectId: catalogId,
        subjectId: String(subjectId),
        gradeLevelId: String(gradeId),
      }),
    );
    expect(result).toEqual({ createdUnits: 0, createdLessons: 1 });
    expect(
      (await asA(() => model('CurriculumLesson').findById(lessonId)))
        .objectives,
    ).toEqual(['محفوظ']);
  });
  it('blocks foreign-school mappings and content references', async () => {
    const id = await completeDraft();
    await http('post', '/curriculum/import', 'ownerB')
      .send({
        catalogSubjectId: catalogId,
        subjectId: String(subjectId),
        gradeLevelId: String(gradeId),
      })
      .expect(404);
    await model('Library').collection.updateOne(
      { _id: new Types.ObjectId(libraryId) },
      { $set: { schoolId: schoolB } },
    );
    await http('post', '/preparation/' + id + '/submit').expect(400);
    await http('patch', '/curriculum/lessons/' + lessonId, 'ownerB')
      .send({ objectives: ['سرقة'] })
      .expect(404);
    await http('delete', '/preparation/' + id, 'ownerB').expect(404);
  });
  it('enforces owner/manager curriculum writes and platform-only catalog seeding', async () => {
    await http('patch', '/curriculum/lessons/' + lessonId)
      .send({ name: 'غير مسموح' })
      .expect(403);
    await http('get', '/catalog/subjects', 'student').expect(200);
    await http('get', '/catalog/subjects', 'platform').expect(200);
    await http('post', '/catalog/seed', 'owner').send({}).expect(403);
    await http('post', '/catalog/seed', 'platform')
      .send({ subjectId: '123', subjectName: 'تجربة', lessons: [] })
      .expect(201);
  });
  it('rejects foreign teachers and malformed resource payloads', async () => {
    const id = await completeDraft();
    await http('post', '/preparation/' + id + '/submit', 'other').expect(403);
    await http('post', '/preparation/' + id + '/resources', 'other')
      .send({ type: 'homework', title: 'واجب' })
      .expect(403);
    await http('get', '/preparation/' + id, 'other').expect(403);
    for (const body of [
      { type: 'invalid' },
      { type: 'homework' },
      { type: 'quiz', examId: 'invalid' },
      {
        type: 'homework',
        title: 'x',
        startAt: '2026-09-08',
        dueAt: '2026-09-01',
      },
    ]) {
      await http('post', '/preparation/' + id + '/resources')
        .send(body)
        .expect(400);
    }
  });
  it('checks exam type, class and school without embedding exam answers', async () => {
    const id = await completeDraft();
    const exam = await insert('Exam', {
      schoolId: schoolA,
      subjectOfferingId: offeringId,
      classIds: [classId],
      questions: [{ correctAnswer: 'secret' }],
    });
    await http('post', '/preparation/' + id + '/resources')
      .send({ type: 'quiz', examId: String(exam.insertedId) })
      .expect(201);
    await http('post', '/preparation/' + id + '/resources')
      .send({ type: 'homework', examId: String(exam.insertedId) })
      .expect(400);
    await model('Exam').collection.updateOne(
      { _id: exam.insertedId },
      { $set: { classIds: [new Types.ObjectId()] } },
    );
    await http('post', '/preparation/' + id + '/submit').expect(400);
  });
  it('clears reviews on edits and resource deletion, and requires resubmission', async () => {
    const id = await completeDraft();
    await asA(() => content.submit(id, users.teacher));
    await http('patch', '/preparation/' + id + '/review', 'owner')
      .send({ reviewStatus: 'approved' })
      .expect(200);
    const edited = await http('patch', '/preparation/' + id)
      .send({ objectives: [] })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      reviewStatus: 'draft',
      reviewedAt: null,
    });
    await http('patch', '/preparation/' + id + '/review', 'owner')
      .send({ reviewStatus: 'approved' })
      .expect(400);
    await http('post', '/preparation/' + id + '/submit').expect(400);
    const resource = (await asA(() => content.details(id))).resources[0];
    await http(
      'delete',
      '/preparation/' + id + '/resources/' + resource._id,
    ).expect(200);
    await http('post', '/preparation/' + id + '/submit').expect(400);
  });
  it('only one concurrent submit succeeds', async () => {
    const id = await completeDraft();
    const results = await asA(() =>
      Promise.allSettled([
        content.submit(id, users.teacher),
        content.submit(id, users.teacher),
      ]),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('deletes resources with the preparation and protects linked lessons', async () => {
    const id = await completeDraft();
    await http('delete', '/curriculum/lessons/' + lessonId, 'owner').expect(
      409,
    );
    await http('delete', '/preparation/' + id).expect(200);
    expect((await asA(() => content.details(id))).resources).toHaveLength(0);
  });
  it('allows teachers to create library links and upload reusable PowerPoint files', async () => {
    await http('post', '/library')
      .send({ title: 'مصدر جديد', link: 'https://example.com/new' })
      .expect(201);
    const file = await http('post', '/library')
      .field('title', 'عرض تقديمي')
      .field('kind', 'file')
      .attach('file', Buffer.from('test pptx'), 'lesson.pptx')
      .expect(201);
    expect(file.body.kind).toBe('file');
    expect(file.body.file.path).toMatch(/^\/uploads\/library\//);
    const path = join(process.cwd(), file.body.file.path);
    try {
      const result = await draft({
        lessonId,
        objectives: ['هدف'],
        digitalContentIds: [file.body._id],
      });
      expect(result.data.digitalContentIds.map(String)).toEqual([
        file.body._id,
      ]);
    } finally {
      await unlink(path);
    }
  });
  it('validates library link/file transitions on create and patch', async () => {
    await http('post', '/library').send({ title: 'بدون رابط' }).expect(400);
    await http('post', '/library')
      .send({ title: 'بدون ملف', kind: 'file' })
      .expect(400);
    await http('patch', '/library/' + libraryId, 'owner')
      .send({ kind: 'file' })
      .expect(400);
    await http('patch', '/library/' + libraryId, 'owner')
      .send({ link: null })
      .expect(400);
    await http('post', '/library')
      .send({ title: 'غير آمن', link: 'javascript:alert(1)' })
      .expect(400);
  });
  it('rejects malformed IDs and invalid nested arrays at the boundary', async () => {
    await http('get', '/catalog/subjects/not-an-id/units').expect(400);
    const id = await completeDraft();
    await http('patch', '/preparation/' + id)
      .send({ objectives: [42] })
      .expect(400);
    await http('post', '/preparation/' + id + '/resources')
      .send({ type: 'homework', title: 'x', files: [{}] })
      .expect(400);
  });
});
