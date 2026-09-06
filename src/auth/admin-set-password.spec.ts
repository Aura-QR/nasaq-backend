import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { Counter } from '../Counter/Schema/counter.schema';
import { Class } from '../classes/schemas/class.schema';
import { EmailService } from '../email/email.service';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { BusService } from '../financial/bus.service';
import { FinancialRecordService } from '../financial/financial-record.service';
import { StudentFinancialRecord } from '../financial/schemas/student-financial-record.schema';
import { ResponseInterceptor } from '../interceptors/response.interceptor';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import { Permission } from '../permissions/schemas/permission.schema';
import {
  PlatformAdmin,
  PlatformAdminSchema,
} from '../platform/platform-admins/schemas/platform-admin.schema';
import {
  School,
  SchoolSchema,
} from '../platform/schools/schemas/school.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { StudentsController } from '../students/students.controller';
import { StudentsService } from '../students/students.service';
import { Subject } from '../subjects/schemas/subject.schema';
import { TeacherAssignment } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { TeachersController } from '../teachers/teachers.controller';
import { TeachersService } from '../teachers/teachers.service';
import { TenantGuard } from '../tenancy/guards/tenant.guard';
import { TenantContextInterceptor } from '../tenancy/tenant-context.interceptor';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PASSWORD_MIN_LENGTH_MESSAGE } from './constants/password.constants';
import { ROLES_KEY } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { PasswordUtil } from './utils/password.util';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
const JWT_SECRET = 'admin-password-integration-test-secret';

describe('Admin-set student and teacher passwords (integration)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let studentModel: Model<Student>;
  let teacherModel: Model<Teacher>;
  let schoolModel: Model<School>;
  let permissionModel: Model<Permission>;
  let oldHash: string;
  const schoolId = new Types.ObjectId();
  const otherSchoolId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const teacherId = new Types.ObjectId();
  const emailService = {
    sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Student.name, schema: StudentSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Admin.name, schema: AdminSchema },
          { name: School.name, schema: SchoolSchema },
          { name: PlatformAdmin.name, schema: PlatformAdminSchema },
        ]),
        PermissionsModule,
        JwtModule.register({ secret: JWT_SECRET }),
      ],
      controllers: [StudentsController, TeachersController, AuthController],
      providers: [
        StudentsService,
        TeachersService,
        AuthService,
        JwtStrategy,
        Reflector,
        { provide: ConfigService, useValue: new ConfigService({ JWT_SECRET }) },
        { provide: EmailService, useValue: emailService },
        // These collaborators belong to unrelated student/teacher operations.
        { provide: FinancialRecordService, useValue: {} },
        { provide: BusService, useValue: {} },
        ...[
          Class,
          Counter,
          Enrollment,
          StudentFinancialRecord,
          Subject,
          TeacherAssignment,
          Lecture,
        ].map((model) => ({
          provide: getModelToken(model.name),
          useValue: {},
        })),
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new TenantContextInterceptor(),
      new ResponseInterceptor(),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);
    studentModel = moduleRef.get(getModelToken(Student.name));
    teacherModel = moduleRef.get(getModelToken(Teacher.name));
    schoolModel = moduleRef.get(getModelToken(School.name));
    permissionModel = moduleRef.get(getModelToken(Permission.name));
    oldHash = await PasswordUtil.hash('OldPassword123');
    await schoolModel.collection.insertMany([
      {
        _id: schoolId,
        name: 'مدرسة النور',
        slug: `password-${schoolId}`,
        isActive: true,
      },
      {
        _id: otherSchoolId,
        name: 'مدرسة الأمل',
        slug: `password-${otherSchoolId}`,
        isActive: true,
      },
    ]);
  });

  beforeEach(async () => {
    emailService.sendPasswordResetOtp.mockClear();
    for (const model of [studentModel, teacherModel]) {
      await model.collection.deleteMany({ schoolId });
    }
    const otpFields = {
      otp: '482910',
      otpExpiry: new Date(Date.now() + 15 * 60 * 1000),
    };
    await studentModel.collection.insertOne({
      _id: studentId,
      schoolId,
      firstName: 'أحمد',
      fatherName: 'محمد',
      familyName: 'علي',
      name: 'أحمد محمد علي',
      birthDate: new Date('2012-01-01'),
      gender: 'male',
      phoneNumber: '0501234567',
      address: 'الرياض',
      email: 'admin-password-student@example.com',
      schoolEmail: 'au260001@student.auraschool.com',
      password: oldHash,
      hasPassword: false,
      isActive: true,
      ...otpFields,
    });
    await teacherModel.collection.insertOne({
      _id: teacherId,
      schoolId,
      name: 'أ. سارة أحمد',
      email: 'admin-password-teacher@example.com',
      hireDate: new Date('2020-01-01'),
      isActive: true,
      password: oldHash,
      ...otpFields,
    });
  });

  afterAll(async () => {
    if (schoolModel) {
      for (const model of [studentModel, teacherModel, permissionModel]) {
        await model.collection.deleteMany({ schoolId });
      }
      await schoolModel.collection.deleteMany({
        _id: { $in: [schoolId, otherSchoolId] },
      });
    }
    await app?.close();
  });

  const token = (
    role: Role = Role.OWNER,
    school: Types.ObjectId | null = schoolId,
  ) =>
    jwt.sign({
      sub: String(new Types.ObjectId()),
      email: `password-${role.toLowerCase()}@example.com`,
      role,
      schoolId: school ? String(school) : null,
      permissions: ['*'],
    });

  describe.each([
    {
      route: 'students',
      role: Role.STUDENT,
      id: studentId,
      name: 'أحمد محمد علي',
      email: 'admin-password-student@example.com',
      label: 'الطالب',
    },
    {
      route: 'teachers',
      role: Role.TEACHER,
      id: teacherId,
      name: 'أ. سارة أحمد',
      email: 'admin-password-teacher@example.com',
      label: 'المعلم',
    },
  ])('$route', ({ route, role, id, name, email, label }) => {
    const rawRecord = () =>
      (route === 'students' ? studentModel : teacherModel).collection.findOne({
        _id: id,
      });
    const reset = (body: object, callerRole = Role.OWNER) =>
      request(app.getHttpServer())
        .patch(`/${route}/${id}/password`)
        .set('Authorization', `Bearer ${token(callerRole)}`)
        .send(body);
    const login = (password: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: email, password, schoolId: String(schoolId) });

    const assertStoredPassword = async (password: string) => {
      const raw = await rawRecord();
      expect(raw.password).toMatch(/^\$2[aby]\$/);
      expect(await PasswordUtil.compare(password, raw.password)).toBe(true);
      expect(raw).not.toHaveProperty('otp');
      expect(raw).not.toHaveProperty('otpExpiry');
      if (route === 'students') expect(raw.hasPassword).toBe(true);
      else expect(raw).not.toHaveProperty('hasPassword');
    };

    it('lets an owner set a password without echoing it, and the new password works for login', async () => {
      const password = 'NewPassword123';
      const response = await reset({ password }).expect(200);
      expect(response.body).toEqual({
        status: true,
        message: 'تم تعيين كلمة المرور',
        data: { id: String(id), name },
      });
      expect(JSON.stringify(response.body)).not.toContain(password);
      expect(JSON.stringify(response.body)).not.toContain('$2b$');
      await assertStoredPassword(password);
      const loggedIn = await login(password).expect(200);
      expect(loggedIn.body.data.accessToken).toEqual(expect.any(String));
      expect(loggedIn.body.data.requiresPasswordSetup).toBe(false);
      expect(loggedIn.body.data.user.role).toBe(role);
      await login('OldPassword123').expect(401);
    });

    it('returns a safe 8-character generated password that works for login', async () => {
      const response = await reset({}).expect(200);
      const password = response.body.data.password;
      expect(password).toHaveLength(8);
      expect(password).toMatch(/^[A-Za-z2-9]{8}$/);
      expect(password).not.toMatch(/[0O1lI]/);
      expect(response.body).toEqual({
        status: true,
        message: 'تم تعيين كلمة المرور',
        data: { id: String(id), name, password },
      });
      expect(JSON.stringify(response.body)).not.toContain('$2b$');
      await assertStoredPassword(password);
      const loggedIn = await login(password).expect(200);
      expect(loggedIn.body.data.accessToken).toEqual(expect.any(String));
      expect(loggedIn.body.data.user.role).toBe(role);
    });

    it('invalidates a live recovery OTP when the password is changed', async () => {
      const before = await rawRecord();
      expect(before.otp).toBe('482910');
      expect(before.otpExpiry.getTime()).toBeGreaterThan(Date.now());
      await reset({ password: 'AdminPassword123' }).expect(200);
      const response = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          email,
          role,
          schoolId: String(schoolId),
          otp: '482910',
          newPassword: 'OtpPassword123',
        })
        .expect(400);
      expect(response.body.message).toBe('يرجى طلب رمز التحقق أولاً');
      await assertStoredPassword('AdminPassword123');
    });

    it('allows a manager', async () => {
      await reset({ password: 'ManagerPassword123' }, Role.MANAGER).expect(200);
      await assertStoredPassword('ManagerPassword123');
    });

    it.each([Role.TEACHER, Role.STUDENT, Role.SUPERVISOR])(
      'denies %s even with wildcard permissions',
      async (callerRole) => {
        await reset({ password: 'Forbidden123' }, callerRole).expect(403);
        const raw = await rawRecord();
        expect(raw.password).toBe(oldHash);
        expect(raw.otp).toBe('482910');
      },
    );

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .patch(`/${route}/${id}/password`)
        .send({})
        .expect(401);
    });

    it('returns the existing Arabic 404 for a missing id', async () => {
      const missingId = new Types.ObjectId();
      const response = await request(app.getHttpServer())
        .patch(`/${route}/${missingId}/password`)
        .set('Authorization', `Bearer ${token()}`)
        .send({})
        .expect(404);
      expect(response.body.message).toBe(
        `${label} بمعرف ${missingId} غير موجود`,
      );
    });

    it('cannot change a password in another school', async () => {
      await request(app.getHttpServer())
        .patch(`/${route}/${id}/password`)
        .set('Authorization', `Bearer ${token(Role.OWNER, otherSchoolId)}`)
        .send({ password: 'Forbidden123' })
        .expect(404);
      expect((await rawRecord()).password).toBe(oldHash);
    });

    it.each(['', '12345'])(
      'rejects a password shorter than 6 characters (%j)',
      async (password) => {
        const response = await reset({ password }).expect(400);
        expect(response.body.message).toContain(PASSWORD_MIN_LENGTH_MESSAGE);
        expect((await rawRecord()).password).toBe(oldHash);
      },
    );

    it.each([123456, {}, ['123456']])(
      'rejects a non-string password (%j)',
      async (password) => {
        await reset({ password }).expect(400);
        expect((await rawRecord()).password).toBe(oldHash);
      },
    );

    it('accepts a password of exactly 6 characters', async () => {
      await reset({ password: 'Abc234' }).expect(200);
      await login('Abc234').expect(200);
    });

    it('preserves the global restriction on direct platform admin school actions', async () => {
      const handler =
        route === 'students'
          ? StudentsController.prototype.setAdminPassword
          : TeachersController.prototype.setAdminPassword;
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        Role.OWNER,
        Role.MANAGER,
        Role.SUPER_ADMIN,
      ]);
      await request(app.getHttpServer())
        .patch(`/${route}/${id}/password`)
        .set('Authorization', `Bearer ${token(Role.SUPER_ADMIN, null)}`)
        .send({})
        .expect(403);
    });
  });

  it.each([
    [
      'ADMIN-PASSWORD-STUDENT@EXAMPLE.COM',
      'admin-password-student@example.com',
    ],
    ['AU260001@STUDENT.AURASCHOOL.COM', 'au260001@student.auraschool.com'],
  ])(
    'sends the student recovery OTP to the matching normalized address: %s',
    async (email, recipient) => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email, role: Role.STUDENT, schoolId: String(schoolId) })
        .expect(200);
      const raw = await studentModel.collection.findOne({ _id: studentId });
      expect(raw.otp).toMatch(/^\d{6}$/);
      expect(emailService.sendPasswordResetOtp).toHaveBeenCalledTimes(1);
      expect(emailService.sendPasswordResetOtp).toHaveBeenCalledWith(
        recipient,
        raw.otp,
      );
    },
  );
});
