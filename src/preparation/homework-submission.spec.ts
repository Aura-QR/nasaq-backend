import mongoose, { Model, Types } from 'mongoose';
import * as fs from 'fs';
import { HomeworkService } from './homework.service';
import { HomeworkSubmissionService } from './homework-submission.service';
import { HomeworkSubmission, HomeworkSubmissionSchema } from './schemas/homework-submission.schema';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import { PreparationResource, PreparationResourceSchema } from './schemas/preparation-resource.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = 'mongodb://localhost:27017/nasaq-homework-submission-test';

describe('HomeworkSubmissionService', () => {
  const schoolId = new Types.ObjectId();
  const classId = new Types.ObjectId();
  const otherClass = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const noura = new Types.ObjectId();
  const reem = new Types.ObjectId();
  const outsider = new Types.ObjectId();
  const offeringId = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const asTenant = <T>(fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, async () => await fn());
  const model = <T>(name: string, schema: any): Model<T> =>
    (mongoose.models[name] as Model<T>) || mongoose.model<T>(name, schema);
  const photo = (text: string, name = 'page.jpg'): any => {
    const buffer = Buffer.from(text);
    return { originalname: name, mimetype: 'image/jpeg', buffer, size: buffer.length };
  };
  const student = (sid: any) => ({ role: 'STUDENT', userId: String(sid) });
  const teacher = { role: 'TEACHER', userId: String(teacherId) };

  let service: HomeworkSubmissionService;
  let notified: any[];
  let homeworkId: string;
  let secondHomeworkId: string;

  beforeAll(async () => {
    await mongoose.connect(URI);
    model(Subject.name, SubjectSchema);
    const preparations = model<Preparation>(Preparation.name, PreparationSchema);
    const resources = model<PreparationResource>(PreparationResource.name, PreparationResourceSchema);
    const lectures = model<Lecture>(Lecture.name, LectureSchema);
    const homework = new HomeworkService(
      preparations, resources, lectures,
      model(SubjectOffering.name, SubjectOfferingSchema), model(Teacher.name, TeacherSchema),
    );
    notified = [];
    service = new HomeworkSubmissionService(
      model(HomeworkSubmission.name, HomeworkSubmissionSchema), resources, preparations,
      model(Student.name, StudentSchema), model(Enrollment.name, EnrollmentSchema), lectures,
      model(Class.name, ClassSchema), homework,
      { notify: async (n: any) => { notified.push(n); } } as any,
    );
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync('./uploads/homework', { recursive: true, force: true });
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    notified.length = 0;
    const db = mongoose.connection;
    await db.collection('classes').insertOne({ _id: classId, schoolId, name: 'خامس/بنات' } as any);
    await db.collection('subjects').insertOne({ _id: subjectId, schoolId, subjectName: 'اللغة الإنجليزية' } as any);
    await db.collection('subjectofferings').insertOne({ _id: offeringId, schoolId, subjectId } as any);
    await db.collection('students').insertMany([
      { _id: noura, schoolId, name: 'نورة', email: 'noura@t.test', classId, isActive: true },
      { _id: reem, schoolId, name: 'ريم', email: 'reem@t.test', classId, isActive: true },
      { _id: outsider, schoolId, name: 'سلمى', email: 'salma@t.test', classId: otherClass, isActive: true },
    ] as any);
    const week = new Date();
    week.setUTCHours(0, 0, 0, 0);
    const preps = await db.collection('preparations').insertMany([
      { schoolId, classId, subject: offeringId, submittedBy: teacherId, reviewStatus: 'approved', lessonTitle: 'My Family', weekOf: week },
      { schoolId, classId, subject: offeringId, submittedBy: teacherId, reviewStatus: 'approved', lessonTitle: 'My House', weekOf: week },
    ] as any);
    const far = new Date(Date.now() + 7 * 86400000);
    const res = await db.collection('preparation_resources').insertMany([
      { schoolId, preparationId: preps.insertedIds[0], type: 'homework', title: 'واجب منزلي: عائلتي', dueAt: far },
      { schoolId, preparationId: preps.insertedIds[1], type: 'homework', title: 'واجب منزلي: بيتي', dueAt: far },
    ] as any);
    homeworkId = String(res.insertedIds[0]);
    secondHomeworkId = String(res.insertedIds[1]);
  });

  it('a student hands in photos and sees them on her homework', async () => {
    const r: any = await asTenant(() => service.submit(student(noura), homeworkId, [photo('noura-1'), photo('noura-2')], 'حللت السؤالين'));
    expect(r.data).toMatchObject({ status: 'submitted', note: 'حللت السؤالين', late: false });
    expect(r.data.files).toHaveLength(2);
    expect(r.data.files[0].url).toMatch(/^\/uploads\/homework\/.+\.jpg$/);
    expect(r.data.files[0]).not.toHaveProperty('path');
    const mine = await asTenant(() => service.mineFor(String(noura), [homeworkId, secondHomeworkId]));
    expect(mine.get(homeworkId)?.status).toBe('submitted');
    expect(mine.get(secondHomeworkId)).toBeUndefined();
  });

  it('refuses a student from another class, and a file that is not a photo or PDF', async () => {
    await expect(asTenant(() => service.submit(student(outsider), homeworkId, [photo('x')]))).rejects.toThrow('ليس لفصلك');
    const exe: any = { ...photo('x'), mimetype: 'application/x-msdownload' };
    await expect(asTenant(() => service.submit(student(noura), homeworkId, [exe]))).rejects.toThrow('الصور وملفات PDF');
    await expect(asTenant(() => service.submit(student(noura), homeworkId, []))).rejects.toThrow('أرفق');
  });

  it('the teacher sees the whole class, counts, and flags a photo passed between students', async () => {
    await asTenant(() => service.submit(student(noura), homeworkId, [photo('same-picture')]));
    await asTenant(() => service.submit(student(reem), homeworkId, [photo('same-picture')]));
    const r: any = await asTenant(() => service.submissionsFor(teacher, homeworkId));
    expect(r.data.homework).toMatchObject({ className: 'خامس/بنات', subjectName: 'اللغة الإنجليزية' });
    expect(r.data.students.map((s: any) => s.name)).toEqual(['ريم', 'نورة']);
    const nouraRow = r.data.students.find((s: any) => s.name === 'نورة');
    expect(nouraRow.duplicates).toEqual(['مطابقة لتسليم ريم']);

    const list: any = await asTenant(() => service.teacherHomework(teacher));
    expect(list.data.find((h: any) => h._id === homeworkId)).toMatchObject({ students: 2, submitted: 2, toReview: 2 });
  });

  it('flags an old page handed in again for a different homework', async () => {
    await asTenant(() => service.submit(student(noura), homeworkId, [photo('old-page')]));
    await asTenant(() => service.submit(student(noura), secondHomeworkId, [photo('old-page')]));
    const r: any = await asTenant(() => service.submissionsFor(teacher, secondHomeworkId));
    expect(r.data.students.find((s: any) => s.name === 'نورة').duplicates).toEqual(['صورة سبق أن سلّمتها الطالبة لواجب آخر']);
  });

  it('returning needs a reason and tells the student; she resubmits; accepted locks it', async () => {
    await asTenant(() => service.submit(student(noura), homeworkId, [photo('first')]));
    await expect(asTenant(() => service.review(teacher, homeworkId, String(noura), 'returned', ''))).rejects.toThrow('سبب الإعادة');
    await asTenant(() => service.review(teacher, homeworkId, String(noura), 'returned', 'السؤال الثالث ناقص'));
    expect(notified[0]).toMatchObject({ type: 'homework_reviewed', title: 'أُعيد إليك الواجب' });
    expect(notified[0].body).toContain('السؤال الثالث ناقص');

    const again: any = await asTenant(() => service.submit(student(noura), homeworkId, [photo('second')]));
    expect(again.data.status).toBe('submitted');
    await asTenant(() => service.review(teacher, homeworkId, String(noura), 'accepted', ''));
    await expect(asTenant(() => service.submit(student(noura), homeworkId, [photo('third')]))).rejects.toThrow('قُبل');
    await expect(asTenant(() => service.withdraw(student(noura), homeworkId))).rejects.toThrow('لا يمكن سحبه');
  });

  it('only the lesson\'s teacher or the administration reviews', async () => {
    const stranger = { role: 'TEACHER', userId: String(new Types.ObjectId()) };
    await expect(asTenant(() => service.submissionsFor(stranger, homeworkId))).rejects.toThrow('ليس من دروسك');
    await expect(asTenant(() => service.submissionsFor({ role: 'STUDENT', userId: String(noura) }, homeworkId))).rejects.toThrow();
    const r: any = await asTenant(() => service.submissionsFor({ role: 'OWNER', userId: 'x' }, homeworkId));
    expect(r.data.students).toHaveLength(2);
  });

  it('a student withdraws an unreviewed hand-in and its files are removed', async () => {
    const r: any = await asTenant(() => service.submit(student(noura), homeworkId, [photo('to-withdraw')]));
    const file = `.${r.data.files[0].url}`;
    expect(fs.existsSync(file)).toBe(true);
    await asTenant(() => service.withdraw(student(noura), homeworkId));
    expect(fs.existsSync(file)).toBe(false);
    expect((await asTenant(() => service.mineFor(String(noura), [homeworkId]))).size).toBe(0);
  });
});
