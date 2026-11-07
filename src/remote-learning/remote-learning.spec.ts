import mongoose, { Model, Types } from 'mongoose';
import { RemoteLearningService } from './remote-learning.service';
import { RemoteDay, RemoteDaySchema } from './schemas/remote-day.schema';
import { RemoteLessonLink, RemoteLessonLinkSchema } from './schemas/remote-lesson-link.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Stage, StageSchema } from '../stages/schemas/stage.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = 'mongodb://localhost:27017/nasaq-remote-learning-test';

describe('RemoteLearningService', () => {
  const schoolId = new Types.ObjectId();
  const primary = new Types.ObjectId();
  const middle = new Types.ObjectId();
  const grade5 = new Types.ObjectId();
  const grade7 = new Types.ObjectId();
  const class5 = new Types.ObjectId();
  const class7 = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const offering = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const SUNDAY = '2026-11-08';
  const asTenant = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, async () => await fn());
  const model = <T>(name: string, schema: any): Model<T> =>
    (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);

  let service: RemoteLearningService;
  let notified: any[];
  let lecture5: any;

  beforeAll(async () => {
    await mongoose.connect(URI);
    model(SubjectOffering.name, SubjectOfferingSchema);
    model(Subject.name, SubjectSchema);
    notified = [];
    service = new RemoteLearningService(
      model(RemoteDay.name, RemoteDaySchema), model(RemoteLessonLink.name, RemoteLessonLinkSchema),
      model(Lecture.name, LectureSchema), model(Class.name, ClassSchema), model(GradeLevel.name, GradeLevelSchema),
      model(Stage.name, StageSchema), model(Teacher.name, TeacherSchema), model(Student.name, StudentSchema),
      { notify: async (n: any) => { notified.push(n); } } as any,
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    notified.length = 0;
    const db = mongoose.connection;
    await db.collection('stages').insertMany([{ _id: primary, schoolId, name: 'ابتدائي', order: 1 }, { _id: middle, schoolId, name: 'متوسط', order: 2 }] as any);
    await db.collection('gradelevels').insertMany([{ _id: grade5, schoolId, stageId: primary }, { _id: grade7, schoolId, stageId: middle }] as any);
    await db.collection('classes').insertMany([{ _id: class5, schoolId, name: 'خامس/بنات', gradeLevelId: grade5 }, { _id: class7, schoolId, name: 'أولى متوسط', gradeLevelId: grade7 }] as any);
    await db.collection('subjects').insertOne({ _id: subjectId, schoolId, subjectName: 'اللغة الإنجليزية' } as any);
    await db.collection('subjectofferings').insertOne({ _id: offering, schoolId, subjectId } as any);
    await db.collection('teachers').insertOne({ _id: teacherId, schoolId, name: 'أ. سارة', meetingUrl: 'https://teams.microsoft.com/l/meetup-join/sara' } as any);
    await db.collection('students').insertOne({ _id: studentId, schoolId, name: 'نورة', classId: class5, isActive: true } as any);
    const base = { schoolId, subjectOfferingId: offering, termId, teacherId };
    const r = await db.collection('lectures').insertMany([
      { ...base, classId: class5, dayOfWeek: 'sunday', slot: 2 },
      { ...base, classId: class7, dayOfWeek: 'sunday', slot: 3 },
    ] as any);
    lecture5 = r.insertedIds[0];
  });

  const teacher = { role: 'TEACHER', userId: String(teacherId) };
  const student = { role: 'STUDENT', userId: String(studentId) };

  it('an ordinary day has no remote lessons and no home check-in', async () => {
    const r: any = await asTenant(() => service.lessonsOn(student, SUNDAY));
    expect(r.data).toMatchObject({ remote: false, lessons: [] });
    expect(await asTenant(() => service.isRemoteDayForTeacher(String(teacherId), new Date(`${SUNDAY}T00:00:00Z`)))).toBe(false);
  });

  it('a stage remote day gives that stage\'s lessons the teacher\'s link, and only those', async () => {
    await asTenant(() => service.createDay({ startDate: SUNDAY, stageIds: [String(primary)] }, teacher));
    const s: any = await asTenant(() => service.lessonsOn(student, SUNDAY));
    expect(s.data.remote).toBe(true);
    expect(s.data.lessons).toEqual([expect.objectContaining({
      slot: 2, className: 'خامس/بنات', subjectName: 'اللغة الإنجليزية', teacherName: 'أ. سارة',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/sara', linkSource: 'teacher',
    })]);
    const t: any = await asTenant(() => service.lessonsOn(teacher, SUNDAY));
    expect(t.data.lessons.map((l: any) => l.className)).toEqual(['خامس/بنات']);
    expect(await asTenant(() => service.isRemoteDayForTeacher(String(teacherId), new Date(`${SUNDAY}T00:00:00Z`)))).toBe(true);
  });

  it('a lesson link overrides the standing link for that day, and removing it restores it', async () => {
    await asTenant(() => service.createDay({ startDate: SUNDAY }, teacher));
    await asTenant(() => service.setLessonLink(teacher, String(lecture5), SUNDAY, 'https://zoom.us/j/123456789'));
    let s: any = await asTenant(() => service.lessonsOn(student, SUNDAY));
    expect(s.data.lessons[0]).toMatchObject({ joinUrl: 'https://zoom.us/j/123456789', linkSource: 'lesson' });
    await asTenant(() => service.setLessonLink(teacher, String(lecture5), SUNDAY, ''));
    s = await asTenant(() => service.lessonsOn(student, SUNDAY));
    expect(s.data.lessons[0].linkSource).toBe('teacher');
  });

  it('only the lesson\'s own teacher may set its link', async () => {
    await expect(asTenant(() => service.setLessonLink({ role: 'TEACHER', userId: String(new Types.ObjectId()) }, String(lecture5), SUNDAY, 'https://x.example/abcdefgh')))
      .rejects.toThrow('هذه ليست حصتك');
  });

  it('announces a whole-school day to students and teachers', async () => {
    await asTenant(() => service.createDay({ startDate: SUNDAY, endDate: '2026-11-09' }, teacher));
    await new Promise((r) => setTimeout(r, 200));
    const recipients = notified.map((n) => String(n.recipientId));
    expect(recipients).toEqual(expect.arrayContaining([String(studentId), String(teacherId)]));
    expect(notified[0]).toMatchObject({ type: 'remote_day_announced', title: 'تعليم عن بُعد' });
  });

  it('refuses an end before the start', async () => {
    await expect(asTenant(() => service.createDay({ startDate: SUNDAY, endDate: '2026-11-01' }, teacher))).rejects.toThrow('قبل تاريخ البداية');
  });
});
