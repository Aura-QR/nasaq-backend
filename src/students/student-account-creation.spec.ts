import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { StudentsService } from './students.service';
import { Student, StudentSchema } from './schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Counter, CounterSchema } from '../Counter/Schema/counter.schema';
import {
  StudentFinancialRecord,
  StudentFinancialRecordSchema,
} from '../financial/schemas/student-financial-record.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PasswordUtil } from '../auth/utils/password.util';

dotenv.config();

/**
 * Every student created gets a working account, and their guardian is told
 * what it is.
 *
 * Before this, `password` was optional on the DTO and the web form left it
 * empty — so the ordinary path produced a student with `hasPassword: false`,
 * a row that looks like an account and answers every login with
 * 'لم يتم تعيين كلمة مرور لهذا الحساب بعد'. Nothing prompted anyone to fix it.
 */
describe('StudentsService — the account a new student gets', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();

  let studentModel: any;
  let counterModel: any;
  let service: StudentsService;
  let enqueue: jest.Mock;

  const newStudent = (over: Record<string, any> = {}) => ({
    firstName: 'أحمد',
    fatherName: 'علي',
    familyName: 'أحمد',
    birthDate: new Date('2014-05-01'),
    gender: 'male',
    phoneNumber: '0501234567',
    email: `parent-${new mongoose.Types.ObjectId()}@example.test`,
    address: 'الرياض',
    ...over,
  });

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');

    studentModel = mongoose.models[Student.name] || mongoose.model(Student.name, StudentSchema);
    counterModel = mongoose.models[Counter.name] || mongoose.model(Counter.name, CounterSchema);
    const classModel = mongoose.models[Class.name] || mongoose.model(Class.name, ClassSchema);
    const enrollmentModel =
      mongoose.models[Enrollment.name] || mongoose.model(Enrollment.name, EnrollmentSchema);
    const financialRecordModel =
      mongoose.models[StudentFinancialRecord.name] ||
      mongoose.model(StudentFinancialRecord.name, StudentFinancialRecordSchema);

    enqueue = jest.fn().mockResolvedValue(null);
    service = new StudentsService(
      studentModel,
      classModel,
      counterModel,
      enrollmentModel,
      financialRecordModel,
      {} as any,
      {} as any,
      {} as any,
      { enqueue } as any,
    );
  });

  afterAll(async () => {
    await studentModel.deleteMany({ schoolId });
    await mongoose.disconnect();
  });

  beforeEach(() => enqueue.mockClear());

  const create = (dto: any) =>
    contextService.runWithTenant(schoolId, false, async () => service.create(dto as any));

  describe('when the form leaves the password empty — the ordinary path', () => {
    it('still produces an account that can be logged into', async () => {
      const created: any = await create(newStudent());

      const stored = await studentModel
        .findById(created.data.id ?? created.data._id)
        .select('+password')
        .setOptions({ skipTenantScope: true });

      expect(stored.hasPassword).toBe(true);
      expect(stored.password).toBeTruthy();
    });

    it('generates a password that actually works against the stored hash', async () => {
      await create(newStudent());

      const { password } = enqueue.mock.calls[0][0];
      const stored = await studentModel
        .findOne({ _id: enqueue.mock.calls[0][0].recipientId })
        .select('+password')
        .setOptions({ skipTenantScope: true });

      // The whole point: what the parent is sent is what opens the account.
      await expect(PasswordUtil.compare(password, stored.password)).resolves.toBe(true);
    });

    it('sends the school email, which is the address the student logs in with', async () => {
      const created: any = await create(newStudent());

      const event = enqueue.mock.calls[0][0];
      expect(event.loginEmail).toBe(created.data.schoolEmail);
      expect(event.loginEmail).toMatch(/@student\.auraschool\.com$/);
    });

    it('sends the guardian phone as it was typed, for the util to normalise', async () => {
      await create(newStudent({ phoneNumber: '0555555555' }));
      expect(enqueue.mock.calls[0][0].phone).toBe('0555555555');
    });

    it('queues exactly one message per student', async () => {
      await create(newStudent());
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue.mock.calls[0][0]).toMatchObject({
        recipientRole: 'STUDENT',
        reason: 'created',
      });
    });

    it('never returns the generated password in the API response', async () => {
      const created: any = await create(newStudent());
      const { password } = enqueue.mock.calls[0][0];

      expect(JSON.stringify(created)).not.toContain(password);
      expect(created.data).not.toHaveProperty('password');
      expect(created.data).not.toHaveProperty('otp');
    });

    it('gives each student a different password', async () => {
      await create(newStudent());
      await create(newStudent());

      const [first, second] = enqueue.mock.calls.map((call: any[]) => call[0].password);
      expect(first).not.toBe(second);
    });
  });

  describe('when an admin types a password', () => {
    it('uses theirs, and sends that one', async () => {
      await create(newStudent({ password: 'Chosen@2026' }));

      const event = enqueue.mock.calls[0][0];
      expect(event.password).toBe('Chosen@2026');

      const stored = await studentModel
        .findById(event.recipientId)
        .select('+password')
        .setOptions({ skipTenantScope: true });
      await expect(PasswordUtil.compare('Chosen@2026', stored.password)).resolves.toBe(true);
    });
  });

  it('carries the school, so the message can name it', async () => {
    await create(newStudent());
    expect(String(enqueue.mock.calls[0][0].schoolId)).toBe(schoolId);
  });
});
