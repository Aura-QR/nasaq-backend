import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import mongoose, { Model, Types } from 'mongoose';
import { LessonContentService } from './lesson-content.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import {
  CurriculumLesson,
  CurriculumLessonSchema,
} from '../curriculum/schemas/curriculum-lesson.schema';
import {
  CurriculumUnit,
  CurriculumUnitSchema,
} from '../curriculum/schemas/curriculum-unit.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import {
  PreparationResource,
  PreparationResourceSchema,
} from './schemas/preparation-resource.schema';
import { Library, LibrarySchema } from '../library/schemas/library.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  GradeLevel,
  GradeLevelSchema,
} from '../grade-levels/schemas/grade-level.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

/*
 * Its own database, and its own copy of the env it changes.
 *
 * This suite clears preparations, curriculum and offerings in beforeEach, and
 * sets AI_* variables. Both are shared with the rest of the run — collections
 * with other suites that use nasaq-test, and `process.env` with every suite in
 * the process, because Jest gives each file its own module registry but not
 * its own process.
 */
const URI = 'mongodb://localhost:27017/nasaq-lesson-content-test';

/**
 * Filling a preparation from the school's workflow.
 *
 * The rule these exist to protect: generated content may fill a blank and may
 * never replace a sentence a teacher wrote. Content that can quietly overwrite
 * her work is worse than none, and it is the reason this is safe to run twice.
 */
describe('LessonContentService', () => {
  const schoolId = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const offeringId = new Types.ObjectId();

  let preparations: Model<Preparation>;
  let lessons: Model<CurriculumLesson>;
  let units: Model<CurriculumUnit>;
  let offerings: Model<SubjectOffering>;
  let resources: Model<PreparationResource>;
  let library: Model<Library>;
  let service: LessonContentService;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;
  let lessonId: Types.ObjectId;

  const TEACHER = { role: 'TEACHER', userId: String(teacherId) };
  const OWNER = { role: 'OWNER', userId: String(new Types.ObjectId()) };

  const generated = {
    warmUp: 'تمهيد مولّد',
    closure: 'إغلاق مولّد',
    vocabulary: 'مفردات مولّدة',
    thinkingSkills: 'التحليل والاستنتاج',
    teacherInstructions: 'ملاحظة للمعلم',
    objectives: ['هدف ١', 'هدف ٢'],
    teachingStrategies: ['التعلم التعاوني'],
    teachingAids: ['السبورة الذكية'],
    homework: { title: 'احسب متوسط درجاتك', description: 'اجمع خمس درجات واقسمها.' },
  };

  const ok = (body: any = generated) =>
    ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as any;

  /*
   * Every query must be EXECUTED inside the callback, not merely built there.
   * A mongoose query is lazy: `asTenant(() => Model.countDocuments(f))` hands
   * back an unexecuted Query, the await happens outside the AsyncLocalStorage
   * scope, and the tenant hook then scopes it to `schoolId: null` — a silent
   * zero. Always finish with `.exec()` (or await) inside.
   */
  const asTenant = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, fn);

  const model = <T>(name: string, schema: any): Model<T> =>
    (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);

  const makePreparation = (over: Record<string, any> = {}) =>
    asTenant(async () =>
      preparations.create({
        schoolId,
        lecture: new Types.ObjectId(),
        subject: offeringId,
        submittedBy: teacherId,
        name: 'سمر',
        lessonId,
        weekOf: new Date('2026-09-05'),
        ...over,
      }),
    );

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['AI_WEBHOOK_URL', 'AI_WEBHOOK_SECRET', 'AI_ENABLED']) {
      savedEnv[key] = process.env[key];
    }
    await mongoose.connect(URI);
    preparations = model<Preparation>(Preparation.name, PreparationSchema);
    lessons = model<CurriculumLesson>(CurriculumLesson.name, CurriculumLessonSchema);
    units = model<CurriculumUnit>(CurriculumUnit.name, CurriculumUnitSchema);
    offerings = model<SubjectOffering>(SubjectOffering.name, SubjectOfferingSchema);
    resources = model<PreparationResource>(PreparationResource.name, PreparationResourceSchema);
    library = model<Library>(Library.name, LibrarySchema);
    model(Subject.name, SubjectSchema);
    model(GradeLevel.name, GradeLevelSchema);
  });

  afterAll(async () => {
    await preparations.deleteMany({ schoolId });
    await mongoose.disconnect();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    process.env.AI_WEBHOOK_URL = 'https://n8n.example.test/webhook/nasaq-prep';
    process.env.AI_WEBHOOK_SECRET = 'test-secret';
    process.env.AI_ENABLED = 'true';

    await preparations.deleteMany({ schoolId });
    await units.deleteMany({ schoolId });
    await lessons.deleteMany({});
    await offerings.deleteMany({ schoolId });
    await mongoose.connection.collection('subjects').deleteMany({ schoolId });
    await mongoose.connection.collection('gradelevels').deleteMany({ schoolId });

    await mongoose.connection.collection('subjects').insertOne({
      _id: subjectId as any, schoolId, subjectName: 'الرياضيات',
    });
    await mongoose.connection.collection('gradelevels').insertOne({
      _id: gradeId as any, schoolId, name: 'الصف السادس', order: 6,
    });
    await mongoose.connection.collection('subjectofferings').deleteMany({ _id: offeringId });
    await mongoose.connection.collection('subjectofferings').insertOne({
      _id: offeringId as any, schoolId, subjectId, gradeLevelId: gradeId,
    });

    const unit = await asTenant(() =>
      units.create({ schoolId, subjectId, gradeLevelId: gradeId, name: 'الإحصاء', order: 0 }),
    );
    const lesson = await asTenant(() =>
      lessons.create({
        schoolId,
        unitId: unit._id,
        name: 'المتوسط الحسابي',
        order: 0,
        objectives: ['هدف المدرسة'],
      }),
    );
    lessonId = lesson._id as Types.ObjectId;

    // Inside the tenant: both models are tenant-scoped, so a delete with no
    // context is scoped to schoolId: null and leaves last test's rows behind.
    await asTenant(async () => {
      await resources.deleteMany({});
      await library.deleteMany({});
    });

    fetchMock = jest.fn().mockResolvedValue(ok());
    global.fetch = fetchMock as any;
    service = new LessonContentService(
      preparations, lessons, units, offerings, resources, library,
    );
  });

  // Inside the tenant: Preparation is tenant-scoped, so a read with no
  // context is scoped to schoolId: null and comes back empty.
  const reload = (id: any): Promise<any> =>
    asTenant(async () => preparations.findById(id).lean().exec());

  describe('filling blanks', () => {
    it('writes every empty field', async () => {
      const prep = await makePreparation();
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));

      expect(result.data.filled).toEqual(
        expect.arrayContaining(['warmUp', 'closure', 'vocabulary', 'thinkingSkills']),
      );
      const saved = await reload(prep._id);
      expect(saved.warmUp).toBe('تمهيد مولّد');
      expect(saved.teachingStrategies).toEqual(['التعلم التعاوني']);
    });

    it('sends the lesson, unit, subject and grade the workflow writes from', async () => {
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        event: 'preparation.generate',
        lessonTitle: 'المتوسط الحسابي',
        unit: 'الإحصاء',
        subject: 'الرياضيات',
        grade: 'الصف السادس',
      });
      // The school's own objectives: content written around them beats
      // content written around a title.
      expect(body.objectives).toEqual(['هدف المدرسة']);
    });

    it('signs the body', async () => {
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));

      const { headers, body } = fetchMock.mock.calls[0][1];
      expect(headers['X-Nasaq-Signature']).toBe(service.sign(body));
    });

    it('accepts the one-element array n8n sometimes returns', async () => {
      fetchMock.mockResolvedValue(ok([generated]));
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect((await reload(prep._id)).warmUp).toBe('تمهيد مولّد');
    });
  });

  describe('the other three things a submit needs', () => {
    /*
     * Filling the prose alone leaves a draft that still cannot be sent —
     * 'لا يمكن الإرسال' with three bullets — which is the wall this exists
     * to remove.
     */
    const addLibraryItem = (over: Record<string, any> = {}) =>
      asTenant(() =>
        library.create({
          schoolId,
          title: 'شرح المتوسط الحسابي',
          link: 'https://example.test/lesson',
          kind: 'link',
          subjectOfferingId: offeringId,
          ...over,
        }),
      );

    it('attaches a library item that belongs to this subject and grade', async () => {
      await addLibraryItem();
      const prep = await makePreparation();
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));

      expect(result.data.attachedContent).toBe(1);
      expect((await reload(prep._id)).digitalContentIds).toHaveLength(1);
    });

    it('accepts a school-wide item, which belongs to every lecture', async () => {
      await addLibraryItem({ subjectOfferingId: null });
      const prep = await makePreparation();
      expect(
        (await asTenant(() => service.generate(String(prep._id), TEACHER))) as any,
      ).toMatchObject({ data: { attachedContent: 1 } });
    });

    it('attaches nothing when the library has nothing that fits', async () => {
      // A video from another subject would be refused on submit anyway, and a
      // wrong one attached silently is worse than a bullet asking her to pick.
      await addLibraryItem({ subjectOfferingId: new Types.ObjectId() });
      const prep = await makePreparation();
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));

      expect(result.data.attachedContent).toBe(0);
      expect((await reload(prep._id)).digitalContentIds ?? []).toHaveLength(0);
    });

    it('leaves the content the teacher chose alone', async () => {
      const item = await addLibraryItem();
      const other = await addLibraryItem({ title: 'آخر' });
      const prep = await makePreparation({ digitalContentIds: [other._id] });

      await asTenant(() => service.generate(String(prep._id), TEACHER));
      const saved = await reload(prep._id);
      expect(saved.digitalContentIds.map(String)).toEqual([String(other._id)]);
      expect(saved.digitalContentIds.map(String)).not.toContain(String(item._id));
    });

    it('files the homework the workflow wrote, by its own title', async () => {
      const prep = await makePreparation();
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));

      expect(result.data.homeworkAdded).toBe(true);
      const rows = await asTenant(async () =>
        resources.find({ preparationId: prep._id }).lean().exec(),
      );
      expect(rows).toHaveLength(1);
      // Not the literal word "واجب": a teacher reviewing twenty-two of those
      // learns to ignore them.
      expect(rows[0]).toMatchObject({ type: 'homework', title: 'احسب متوسط درجاتك' });
    });

    it('adds no homework when the teacher already filed an assignment', async () => {
      const prep = await makePreparation();
      await asTenant(() =>
        resources.create({
          preparationId: prep._id, type: 'activity', title: 'نشاطي أنا',
        } as any),
      );

      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect(result.data.homeworkAdded).toBe(false);
      expect(
        await asTenant(async () =>
          resources.countDocuments({ preparationId: prep._id }).exec(),
        ),
      ).toBe(1);
    });

    it('adds no homework when the workflow returned none', async () => {
      fetchMock.mockResolvedValue(ok({ ...generated, homework: null }));
      const prep = await makePreparation();
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect(result.data.homeworkAdded).toBe(false);
    });

    it('a second run adds neither again', async () => {
      await addLibraryItem();
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));

      const second: any = await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect(second.data).toMatchObject({ filled: [], attachedContent: 0, homeworkAdded: false });
      expect(
        await asTenant(async () =>
          resources.countDocuments({ preparationId: prep._id }).exec(),
        ),
      ).toBe(1);
    });
  });

  describe('what it must never do', () => {
    it("leaves a field the teacher wrote exactly as it was", async () => {
      const prep = await makePreparation({ warmUp: 'تمهيدي أنا' });
      const result: any = await asTenant(() => service.generate(String(prep._id), TEACHER));

      const saved = await reload(prep._id);
      expect(saved.warmUp).toBe('تمهيدي أنا');
      expect(result.data.filled).not.toContain('warmUp');
      // The blanks around it are still filled.
      expect(saved.closure).toBe('إغلاق مولّد');
    });

    it('leaves a list the teacher filled, even a single entry', async () => {
      const prep = await makePreparation({ objectives: ['هدفي أنا'] });
      await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect((await reload(prep._id)).objectives).toEqual(['هدفي أنا']);
    });

    it('changes nothing on a second run', async () => {
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));
      const after = await reload(prep._id);

      const second: any = await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect(second.data.filled).toEqual([]);
      expect(await reload(prep._id)).toMatchObject({ warmUp: after.warmUp });
    });

    it('caps a runaway list rather than storing fifty objectives', async () => {
      fetchMock.mockResolvedValue(
        ok({ ...generated, objectives: Array.from({ length: 50 }, (_, i) => `هدف ${i}`) }),
      );
      const prep = await makePreparation();
      await asTenant(() => service.generate(String(prep._id), TEACHER));
      expect((await reload(prep._id)).objectives).toHaveLength(12);
    });

    it("refuses another teacher's preparation", async () => {
      const prep = await makePreparation();
      await expect(
        asTenant(() =>
          service.generate(String(prep._id), { role: 'TEACHER', userId: String(new Types.ObjectId()) }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a student', async () => {
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), { role: 'STUDENT', userId: 'x' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an owner fill a teacher\'s preparation', async () => {
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), OWNER)),
      ).resolves.toBeDefined();
    });
  });

  describe('when it cannot', () => {
    it('refuses without a lesson, because a title alone produces filler', async () => {
      const prep = await makePreparation({ lessonId: null, lessonTitle: '' });
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('says so when the service is not configured, instead of failing obscurely', async () => {
      delete process.env.AI_WEBHOOK_URL;
      service = new LessonContentService(
        preparations, lessons, units, offerings, resources, library,
      );
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toThrow('غير مفعّل');
    });

    it('honours AI_ENABLED=false', async () => {
      process.env.AI_ENABLED = 'false';
      service = new LessonContentService(
        preparations, lessons, units, offerings, resources, library,
      );
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reports a webhook failure without touching the preparation', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as any);
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect((await reload(prep._id)).warmUp).toBeFalsy();
    });

    it('reports a timeout as a timeout', async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new Error('t'), { name: 'TimeoutError' }),
      );
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toThrow('وقتًا أطول');
    });

    it('rejects a body that is not an object', async () => {
      fetchMock.mockResolvedValue(ok('not json'));
      const prep = await makePreparation();
      await expect(
        asTenant(() => service.generate(String(prep._id), TEACHER)),
      ).rejects.toThrow('غير مفهوم');
    });

    it('404s an id that is not there', async () => {
      await expect(
        asTenant(() => service.generate(String(new Types.ObjectId()), TEACHER)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
