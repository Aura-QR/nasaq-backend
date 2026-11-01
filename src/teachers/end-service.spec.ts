import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { TeachersService } from './teachers.service';
import { Teacher, TeacherSchema } from './schemas/teacher.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  TeacherAssignment,
  TeacherAssignmentSchema,
} from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';

dotenv.config();

/**
 * «إنهاء خدمة المعلم»: a teacher who leaves could not be deleted while 23
 * lectures pointed at her, and nothing moved them in one go.
 */
describe('TeachersService — ending a teacher\'s service', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();
  const termId = new mongoose.Types.ObjectId();
  const offeringId = new mongoose.Types.ObjectId();

  let teacherModel: any;
  let lectureModel: any;
  let assignmentModel: any;
  let service: TeachersService;

  const inSchool = <T>(fn: () => Promise<T>) =>
    contextService.runWithTenant(schoolId, false, fn);

  const raw = (model: any) => model.find().setOptions({ skipTenantScope: true }).where({ schoolId });

  let leaving: any;
  let replacement: any;
  let classA: any;
  let classB: any;

  const makeTeacher = (name: string) =>
    inSchool(() =>
      teacherModel.create({
        name,
        email: `t-${new mongoose.Types.ObjectId()}@example.test`,
        hireDate: new Date('2026-08-01'),
        isActive: true,
        password: 'x',
      }),
    );

  const makeLecture = (classId: any, teacherId: any, dayOfWeek: string, slot: number) =>
    inSchool(() =>
      lectureModel.create({ classId, subjectOfferingId: offeringId, termId, teacherId, dayOfWeek, slot }),
    );

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');

    const model = (name: string, schema: any) => mongoose.models[name] || mongoose.model(name, schema);
    teacherModel = model(Teacher.name, TeacherSchema);
    lectureModel = model(Lecture.name, LectureSchema);
    assignmentModel = model(TeacherAssignment.name, TeacherAssignmentSchema);
    const classModel = model(Class.name, ClassSchema);
    model(SubjectOffering.name, SubjectOfferingSchema);
    await lectureModel.syncIndexes();

    service = new TeachersService(
      teacherModel,
      model(Subject.name, SubjectSchema),
      assignmentModel,
      lectureModel,
      { enqueue: jest.fn() } as any,
    );

    classA = await classModel.collection.insertOne({ schoolId: new mongoose.Types.ObjectId(schoolId), name: 'أولى/بنين' });
    classB = await classModel.collection.insertOne({ schoolId: new mongoose.Types.ObjectId(schoolId), name: 'أولى/بنات' });
  });

  beforeEach(async () => {
    for (const m of [teacherModel, lectureModel, assignmentModel]) {
      await m.deleteMany({ schoolId }).setOptions({ skipTenantScope: true });
    }
    leaving = await makeTeacher('سمر');
    replacement = await makeTeacher('زينب');
  });

  afterAll(async () => {
    for (const m of [teacherModel, lectureModel, assignmentModel]) {
      await m.deleteMany({ schoolId }).setOptions({ skipTenantScope: true });
    }
    await mongoose.connection.collection('classes').deleteMany({ schoolId: new mongoose.Types.ObjectId(schoolId) });
    await mongoose.disconnect();
  });

  it('moves every lecture to the replacement and deactivates the teacher', async () => {
    await makeLecture(classA.insertedId, leaving._id, 'sunday', 1);
    await makeLecture(classA.insertedId, leaving._id, 'monday', 2);

    const result: any = await inSchool(() =>
      service.endService(String(leaving._id), String(replacement._id)),
    );

    expect(result.data).toMatchObject({ movedLectures: 2, unassignedLectures: 0 });
    const lectures = await raw(lectureModel).lean();
    expect(lectures.every((l: any) => String(l.teacherId) === String(replacement._id))).toBe(true);

    const after = await raw(teacherModel).where({ _id: leaving._id }).findOne().lean();
    expect(after).toMatchObject({ isActive: false });
    expect(after.serviceEndedAt).toBeInstanceOf(Date);
    expect(String(after.replacedByTeacherId)).toBe(String(replacement._id));
  });

  it('leaves a lecture without a teacher when the replacement is busy in that period, and says so first', async () => {
    await makeLecture(classA.insertedId, leaving._id, 'sunday', 1);
    await makeLecture(classA.insertedId, leaving._id, 'sunday', 2);
    await makeLecture(classB.insertedId, replacement._id, 'sunday', 1);

    const preview: any = await inSchool(() =>
      service.previewEndService(String(leaving._id), String(replacement._id)),
    );
    expect(preview.data).toMatchObject({ lectureCount: 2, toMove: 1, toUnassign: 1 });
    expect(preview.data.conflicts[0]).toMatchObject({
      dayOfWeek: 'sunday',
      slot: 1,
      className: 'أولى/بنين',
      busyWith: { className: 'أولى/بنات' },
    });

    // The preview wrote nothing.
    expect(await raw(lectureModel).where({ teacherId: leaving._id }).countDocuments()).toBe(2);

    await inSchool(() => service.endService(String(leaving._id), String(replacement._id)));

    const sunday1 = await raw(lectureModel).where({ classId: classA.insertedId, slot: 1 }).findOne().lean();
    const sunday2 = await raw(lectureModel).where({ classId: classA.insertedId, slot: 2 }).findOne().lean();
    expect(sunday1.teacherId).toBeNull();
    expect(String(sunday2.teacherId)).toBe(String(replacement._id));
  });

  it('without a replacement, keeps the lectures in the timetable with no teacher', async () => {
    await makeLecture(classA.insertedId, leaving._id, 'sunday', 1);

    const result: any = await inSchool(() => service.endService(String(leaving._id)));

    expect(result.data).toMatchObject({ movedLectures: 0, unassignedLectures: 1 });
    expect(await raw(lectureModel).countDocuments()).toBe(1);
    expect((await raw(lectureModel).findOne().lean()).teacherId).toBeNull();
  });

  it('hands her subject assignments to the replacement without duplicating his own', async () => {
    const other = new mongoose.Types.ObjectId();
    await inSchool(() =>
      assignmentModel.create([
        { teacherId: leaving._id, subjectOfferingId: offeringId, classId: null },
        { teacherId: leaving._id, subjectOfferingId: other, classId: null },
        { teacherId: replacement._id, subjectOfferingId: offeringId, classId: null },
      ]),
    );

    await inSchool(() => service.endService(String(leaving._id), String(replacement._id)));

    expect(await raw(assignmentModel).where({ teacherId: leaving._id }).countDocuments()).toBe(0);
    const his = await raw(assignmentModel).where({ teacherId: replacement._id }).lean();
    expect(his.map((a: any) => String(a.subjectOfferingId)).sort()).toEqual(
      [String(offeringId), String(other)].sort(),
    );
  });

  it('refuses the teacher as her own replacement, an inactive replacement, and a second run', async () => {
    await expect(
      inSchool(() => service.endService(String(leaving._id), String(leaving._id))),
    ).rejects.toThrow('لا يمكن اختيار المعلم نفسه بديلاً');

    await teacherModel.updateOne({ _id: replacement._id }, { isActive: false }).setOptions({ skipTenantScope: true });
    await expect(
      inSchool(() => service.endService(String(leaving._id), String(replacement._id))),
    ).rejects.toThrow('المعلم البديل غير مفعّل');

    await inSchool(() => service.endService(String(leaving._id)));
    await expect(inSchool(() => service.endService(String(leaving._id)))).rejects.toThrow(
      'تم إنهاء خدمة هذا المعلم بالفعل',
    );
  });

  it('after ending her service, the teacher can be deleted', async () => {
    await makeLecture(classA.insertedId, leaving._id, 'sunday', 1);
    await inSchool(() => service.endService(String(leaving._id), String(replacement._id)));

    await expect(inSchool(() => service.remove(String(leaving._id)))).resolves.toMatchObject({
      message: 'تم حذف المعلم بنجاح',
    });
  });
});
