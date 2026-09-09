import { BadRequestException, ForbiddenException } from '@nestjs/common';
import mongoose, { Types } from 'mongoose';
import { ExamsService } from './exams.service';
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamType } from './enums/exam-type.enum';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

describe('Generated dashboard exams', () => {
  const schoolId = new Types.ObjectId(); const teacherId = new Types.ObjectId();
  const classId = new Types.ObjectId(); const subjectOfferingId = new Types.ObjectId();
  const user = { role: 'TEACHER', userId: String(teacherId) };
  let exams: any; let criteria: any; let classes: any; let service: ExamsService;
  let assigned = true;
  const tenant = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId), isAdminContext: false }, fn);
  const dto = () => ({ subjectOfferingId: String(subjectOfferingId), classIds: [String(classId)], examType: ExamType.QUIZ,
    startDate: new Date('2026-10-01T00:00:00Z'), endDate: new Date('2026-10-02T23:59:59Z'), duration: 30,
    questions: [{ question: 'ما حاصل ١+١؟', options: ['١', '٢', '٣', '٤'], correctAnswer: '٢' }] });
  beforeAll(async () => {
    await mongoose.connect('mongodb://localhost:27017/nasaq-generated-exam-test');
    exams = mongoose.model(Exam.name, ExamSchema);
    criteria = mongoose.model(GradesCriteria.name, GradesCriteriaSchema);
    classes = mongoose.model(Class.name, ClassSchema);
    mongoose.model(SubjectOffering.name, SubjectOfferingSchema);
    mongoose.model(Subject.name, SubjectSchema);
    await exams.init(); await criteria.init();
    await classes.collection.insertOne({ _id: classId, schoolId, name: 'فصل اختبار' });
    const lectures = { find: () => ({ select: () => ({ exec: async () => assigned ? [{ classId }] : [] }) }) };
    service = new ExamsService(exams, criteria, classes, lectures as any, null, null, null, null, null);
  });
  beforeEach(async () => {
    assigned = true;
    await tenant(async () => {
      await exams.deleteMany({}); await criteria.deleteMany({});
      await criteria.create({ subjectOfferingId, final: 40, assignments: 10, assignmentsCount: 2,
        quizzes: 20, quizzesCount: 2, activities: 10, projects: 20, projectsCount: 2 });
    });
  });
  afterAll(async () => {
    await tenant(async () => { await exams.deleteMany({}); await criteria.deleteMany({}); await classes.deleteMany({}); });
    await mongoose.disconnect();
  });
  it('uses the same real exam schema, calculated grade, ownership and questions as the dashboard', async () => {
    const key = String(new Types.ObjectId());
    const result = await tenant(() => service.create(dto(), user, key));
    expect(String(result.createdBy)).toBe(String(teacherId)); expect(result.grade).toBe(10);
    const saved = await tenant<Exam>(() => exams.findById(result._id).lean().exec());
    expect(saved.questions[0].correctAnswer).toBe('٢');
    expect(String(saved.generatedFromPreparation)).toBe(key);
    expect(saved.examType).toBe('quiz'); expect(String(saved.classIds[0])).toBe(String(classId));
  });
  it('resumes a saved exam without creating another when preparation linking is retried', async () => {
    const key = String(new Types.ObjectId());
    const first = await tenant(() => service.create(dto(), user, key));
    const second = await tenant(() => service.create({ ...dto(), duration: 60 }, user, key));
    expect(String(second._id)).toBe(String(first._id)); expect(second.duration).toBe(30);
    expect(await tenant(() => exams.countDocuments({}).exec())).toBe(1);
  });
  it('concurrent generation requests produce one exam per preparation', async () => {
    const key = String(new Types.ObjectId());
    const [first, second] = await tenant(() => Promise.all([service.create(dto(), user, key), service.create(dto(), user, key)]));
    expect(String(first._id)).toBe(String(second._id));
    expect(await tenant(() => exams.countDocuments({}).exec())).toBe(1);
  });
  it('ordinary dashboard requests remain independent and do not receive a generation key', async () => {
    await tenant(() => service.create(dto(), user)); await tenant(() => service.create(dto(), user));
    expect(await tenant(() => exams.countDocuments({}).exec())).toBe(2);
    expect(await tenant(() => exams.countDocuments({ generatedFromPreparation: { $exists: true } }).exec())).toBe(0);
  });
  it('keeps the teacher role, assignment and grade criteria restrictions', async () => {
    const key = String(new Types.ObjectId());
    await expect(tenant(() => service.create(dto(), { ...user, role: 'OWNER' }, key))).rejects.toBeInstanceOf(ForbiddenException);
    assigned = false;
    await expect(tenant(() => service.create(dto(), user, key))).rejects.toBeInstanceOf(ForbiddenException);
    assigned = true;
    await tenant(() => criteria.deleteMany({}).exec());
    await expect(tenant(() => service.create(dto(), user, key))).rejects.toBeInstanceOf(BadRequestException);
    expect(await tenant(() => exams.countDocuments({}).exec())).toBe(0);
  });
  it('does not let another teacher claim an existing generated exam', async () => {
    const key = String(new Types.ObjectId());
    await tenant(() => service.create(dto(), user, key));
    await expect(tenant(() => service.create(dto(), { ...user, userId: String(new Types.ObjectId()) }, key)))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
