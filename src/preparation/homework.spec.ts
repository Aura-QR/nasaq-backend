import mongoose, { Model, Types } from 'mongoose';
import { nextLessonDate, dayKey } from './homework-due';
import { HomeworkService } from './homework.service';
import { LessonContentService } from './lesson-content.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import { PreparationResource, PreparationResourceSchema } from './schemas/preparation-resource.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const WEEK = new Date('2026-11-07T00:00:00.000Z'); // a Saturday

describe('nextLessonDate', () => {
  const sun = { dayOfWeek: 'sunday', slot: 2 };
  const tue = { dayOfWeek: 'tuesday', slot: 1 };
  const tueLate = { dayOfWeek: 'tuesday', slot: 5 };

  it('is the next lesson later in the same week', () => {
    expect(dayKey(nextLessonDate(WEEK, sun, [sun, tue]))).toBe('2026-11-10');
  });

  it('counts a later period on the same day', () => {
    expect(dayKey(nextLessonDate(WEEK, tue, [tue, tueLate]))).toBe('2026-11-10');
  });

  it('wraps to the first lesson of next week', () => {
    expect(dayKey(nextLessonDate(WEEK, tue, [sun, tue]))).toBe('2026-11-15');
  });

  it('is the same day next week when the subject meets once', () => {
    expect(dayKey(nextLessonDate(WEEK, sun, [sun]))).toBe('2026-11-15');
  });

  it('is null without a week or a valid day', () => {
    expect(nextLessonDate(null, sun, [sun])).toBeNull();
    expect(nextLessonDate(WEEK, { dayOfWeek: 'x', slot: 1 }, [])).toBeNull();
  });
});

const URI = 'mongodb://localhost:27017/nasaq-homework-test';

describe('HomeworkService', () => {
  const schoolId = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const offeringId = new Types.ObjectId();
  const asTenant = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, fn);
  const model = <T>(name: string, schema: any): Model<T> =>
    (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);

  let preparations: Model<Preparation>;
  let resources: Model<PreparationResource>;
  let lectures: Model<Lecture>;
  let offerings: Model<SubjectOffering>;
  let teachers: Model<Teacher>;
  let service: HomeworkService;
  let sunday: any;
  let tuesday: any;

  beforeAll(async () => {
    await mongoose.connect(URI);
    preparations = model(Preparation.name, PreparationSchema);
    resources = model(PreparationResource.name, PreparationResourceSchema);
    lectures = model(Lecture.name, LectureSchema);
    offerings = model(SubjectOffering.name, SubjectOfferingSchema);
    teachers = model(Teacher.name, TeacherSchema);
    model(Subject.name, SubjectSchema);
    service = new HomeworkService(preparations, resources, lectures, offerings, teachers);
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.collection('subjects').insertOne({ _id: subjectId as any, schoolId, subjectName: 'العلوم' });
    await mongoose.connection.collection('subjectofferings').insertOne({ _id: offeringId as any, schoolId, subjectId });
    await mongoose.connection.collection('teachers').insertOne({ _id: teacherId as any, schoolId, name: 'أ. سارة' });
    const base = { schoolId, classId, subjectOfferingId: offeringId, termId, teacherId };
    [sunday, tuesday] = await mongoose.connection.collection('lectures').insertMany([
      { ...base, dayOfWeek: 'sunday', slot: 2 },
      { ...base, dayOfWeek: 'tuesday', slot: 1 },
    ]).then((r) => [{ _id: r.insertedIds[0] }, { _id: r.insertedIds[1] }]);
  });

  const prepOn = (lecture: any, over: Record<string, any> = {}) =>
    asTenant(() => preparations.create({
      schoolId, lecture: lecture._id, subject: offeringId, classId, termId,
      submittedBy: teacherId, weekOf: WEEK, lessonTitle: 'الخلية', reviewStatus: 'pending', ...over,
    }));

  it('dates homework set on Sunday for Tuesday', async () => {
    const prep = await prepOn(sunday);
    const due = await asTenant(() => service.dueDateFor(prep));
    expect(dayKey(due)).toBe('2026-11-10');
  });

  it('puts homework on the sheet of the day it is due, including old rows without a date', async () => {
    const prep = await prepOn(sunday);
    await asTenant(() => resources.create({ schoolId, preparationId: prep._id, type: 'homework', title: 'حل تمارين ص ٤٥', description: '١ و٢' }));
    const due = await asTenant(() => service.dueOn(classId, offeringId, '2026-11-10'));
    expect(due.map((h) => h.title)).toEqual(['حل تمارين ص ٤٥']);
    expect(await asTenant(() => service.dueOn(classId, offeringId, '2026-11-08'))).toEqual([]);
  });

  it('lists a student\'s homework with subject, teacher and dates, and hides drafts', async () => {
    const visible = await prepOn(sunday);
    const draft = await prepOn(tuesday, { reviewStatus: 'draft' });
    await asTenant(() => resources.create([
      { schoolId, preparationId: visible._id, type: 'homework', title: 'واجب ظاهر', description: 'نص', dueAt: new Date('2026-11-12T00:00:00Z') },
      { schoolId, preparationId: draft._id, type: 'homework', title: 'واجب مسودة', description: 'نص' },
      { schoolId, preparationId: visible._id, type: 'enrichment', title: 'إثراء', description: 'نص' },
    ]));
    const list = await asTenant(() => service.forStudent({ classId: { $in: [classId] } }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      title: 'واجب ظاهر', subjectName: 'العلوم', teacherName: 'أ. سارة',
      lessonTitle: 'الخلية', assignedOn: '2026-11-08', dueAt: '2026-11-12',
    });
  });

  it('saves homework the teacher wrote without calling the workflow, due at the next lesson', async () => {
    const prep = await prepOn(sunday, { reviewStatus: 'draft' });
    const fetchSpy = jest.fn();
    const originalFetch = global.fetch;
    global.fetch = fetchSpy as any;
    try {
      const lesson = new LessonContentService(
        preparations, {} as any, {} as any, offerings, resources, {} as any, undefined, service,
      );
      const result: any = await asTenant(() => lesson.generate(String(prep._id), { role: 'TEACHER', userId: String(teacherId) }, {
        includeContent: false, resourceTypes: ['homework'],
        homework: { title: 'حل تمارين ص ٤٥', description: 'التمرين ١ و٢' },
      }));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.data.resourceResults).toEqual([{ type: 'homework', status: 'created' }]);
      const saved: any = await asTenant(async () => await resources.findOne({ preparationId: prep._id }).lean());
      expect(saved).toMatchObject({ type: 'homework', title: 'حل تمارين ص ٤٥', description: 'التمرين ١ و٢' });
      expect(dayKey(saved.dueAt)).toBe('2026-11-10');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
