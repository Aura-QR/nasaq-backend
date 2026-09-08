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
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PasswordUtil } from '../auth/utils/password.util';

dotenv.config();

/**
 * A teacher created without a password used to get the literal 'Teacher@123'.
 *
 * That is one password for every teacher in every school on the platform, so
 * anybody who ever saw one teacher's credentials could sign in as any other
 * teacher who had not changed theirs — across tenants. The tests below are
 * what keep it from coming back.
 */
describe('TeachersService — the account a new teacher gets', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();

  let teacherModel: any;
  let service: TeachersService;
  let enqueue: jest.Mock;

  const newTeacher = (over: Record<string, any> = {}) => ({
    name: 'سمر سعود المالكي',
    email: `t-${new mongoose.Types.ObjectId()}@example.test`,
    phoneNumber: '0501234567',
    hireDate: new Date('2026-08-01'),
    ...over,
  });

  const create = (dto: any) =>
    contextService.runWithTenant(schoolId, false, async () => service.create(dto as any));

  const storedHash = async (id: any) => {
    const row = await teacherModel
      .findById(id)
      .select('+password')
      .setOptions({ skipTenantScope: true });
    return row.password;
  };

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');

    teacherModel = mongoose.models[Teacher.name] || mongoose.model(Teacher.name, TeacherSchema);
    const subjectModel = mongoose.models[Subject.name] || mongoose.model(Subject.name, SubjectSchema);
    const assignmentModel =
      mongoose.models[TeacherAssignment.name] ||
      mongoose.model(TeacherAssignment.name, TeacherAssignmentSchema);
    const lectureModel = mongoose.models[Lecture.name] || mongoose.model(Lecture.name, LectureSchema);

    enqueue = jest.fn().mockResolvedValue(null);
    service = new TeachersService(
      teacherModel,
      subjectModel,
      assignmentModel,
      lectureModel,
      { enqueue } as any,
    );
  });

  afterAll(async () => {
    await teacherModel.deleteMany({ schoolId });
    await mongoose.disconnect();
  });

  beforeEach(() => enqueue.mockClear());

  it('does not hand out the shared Teacher@123 any more', async () => {
    await create(newTeacher());

    const { password, recipientId } = enqueue.mock.calls[0][0];
    expect(password).not.toBe('Teacher@123');
    await expect(
      PasswordUtil.compare('Teacher@123', await storedHash(recipientId)),
    ).resolves.toBe(false);
  });

  it('gives two teachers two different passwords', async () => {
    await create(newTeacher());
    await create(newTeacher());

    const [first, second] = enqueue.mock.calls.map((call: any[]) => call[0].password);
    expect(first).not.toBe(second);
  });

  it('sends a password that actually opens the account', async () => {
    await create(newTeacher());

    const { password, recipientId } = enqueue.mock.calls[0][0];
    await expect(PasswordUtil.compare(password, await storedHash(recipientId))).resolves.toBe(true);
  });

  it('sends the email the teacher logs in with, and the phone as typed', async () => {
    const dto = newTeacher({ phoneNumber: '+966 55 555 5555' });
    await create(dto);

    expect(enqueue.mock.calls[0][0]).toMatchObject({
      recipientRole: 'TEACHER',
      reason: 'created',
      recipientName: 'سمر سعود المالكي',
      loginEmail: dto.email,
      phone: '+966 55 555 5555',
    });
  });

  it('queues exactly one message, and never returns the password', async () => {
    const result: any = await create(newTeacher());
    const { password } = enqueue.mock.calls[0][0];

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(password);
    expect(result.teacher).not.toHaveProperty('password');
  });

  it('still honours a password the admin typed', async () => {
    await create(newTeacher({ password: 'Chosen@2026' }));

    const { password, recipientId } = enqueue.mock.calls[0][0];
    expect(password).toBe('Chosen@2026');
    await expect(
      PasswordUtil.compare('Chosen@2026', await storedHash(recipientId)),
    ).resolves.toBe(true);
  });
});
