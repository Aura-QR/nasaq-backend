import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { EmailService } from '../email/email.service';
import { PermissionsService } from '../permissions/permissions.service';
import { Admin } from '../admin/schemas/admin.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Student } from '../students/schemas/student.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { PlatformAdmin } from '../platform/platform-admins/schemas/platform-admin.schema';
import { JwtService } from '@nestjs/jwt';
import { Role } from './enums/role.enum';

describe('AuthService OTP Feature', () => {
  let service: AuthService;
  let emailService: jest.Mocked<EmailService>;

  const mockTeacher = {
    _id: 'teacher123',
    email: 'teacher@test.com',
    password: 'hashedpassword',
    otp: '123456',
    otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
  };

  const mockModel = () => ({
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    exec: jest.fn(),
  });

  let teacherModelMock: any;
  let studentModelMock: any;
  let adminModelMock: any;
  let schoolModelMock: any;

  beforeEach(async () => {
    teacherModelMock = mockModel();
    studentModelMock = mockModel();
    adminModelMock = mockModel();
    schoolModelMock = mockModel();

    const mockEmailService = {
      sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: EmailService, useValue: mockEmailService },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: PermissionsService, useValue: { getUserPermissions: jest.fn() } },
        { provide: getModelToken(Teacher.name), useValue: teacherModelMock },
        { provide: getModelToken(Student.name), useValue: studentModelMock },
        { provide: getModelToken(Admin.name), useValue: adminModelMock },
        { provide: getModelToken(School.name), useValue: schoolModelMock },
        { provide: getModelToken(PlatformAdmin.name), useValue: mockModel() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    emailService = module.get(EmailService);
  });

  describe('forgotPassword', () => {
    it('should generate OTP, save to DB, and send email for TEACHER', async () => {
      teacherModelMock.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(mockTeacher),
      });
      teacherModelMock.findByIdAndUpdate.mockResolvedValue(mockTeacher);

      const response = await service.forgotPassword({
        email: 'teacher@test.com',
        role: Role.TEACHER,
      });

      expect(response.message).toBeDefined();
      expect(teacherModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
        'teacher123',
        expect.objectContaining({
          $set: expect.objectContaining({
            otp: expect.stringMatching(/^\d{6}$/),
            otpExpiry: expect.any(Date),
          }),
        }),
        { skipTenantScope: true },
      );
      expect(emailService.sendPasswordResetOtp).toHaveBeenCalledWith(
        'teacher@test.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should return generic message even if user does not exist (prevents email enumeration)', async () => {
      teacherModelMock.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(null),
      });

      const response = await service.forgotPassword({
        email: 'nonexistent@test.com',
        role: Role.TEACHER,
      });

      expect(response.message).toContain('إذا كان البريد الإلكتروني مسجلاً');
      expect(emailService.sendPasswordResetOtp).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reset password successfully with valid OTP', async () => {
      const teacherWithOtp = { ...mockTeacher, otp: '123456', otpExpiry: new Date(Date.now() + 10 * 60 * 1000) };
      teacherModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(teacherWithOtp),
        }),
      });
      teacherModelMock.findByIdAndUpdate.mockResolvedValue(teacherWithOtp);

      const response = await service.resetPassword({
        email: 'teacher@test.com',
        role: Role.TEACHER,
        otp: '123456',
        newPassword: 'NewPassword@123',
      });

      expect(response.message).toContain('تم تغيير كلمة المرور بنجاح');
      expect(teacherModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
        'teacher123',
        expect.objectContaining({
          $set: expect.objectContaining({ password: expect.any(String) }),
          $unset: { otp: '', otpExpiry: '' },
        }),
        { skipTenantScope: true },
      );
    });

    it('should throw BadRequestException if OTP is incorrect', async () => {
      const teacherWithOtp = { ...mockTeacher, otp: '123456', otpExpiry: new Date(Date.now() + 10 * 60 * 1000) };
      teacherModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(teacherWithOtp),
        }),
      });

      await expect(
        service.resetPassword({
          email: 'teacher@test.com',
          role: Role.TEACHER,
          otp: '000000', // Incorrect OTP
          newPassword: 'NewPassword@123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if OTP has expired', async () => {
      const expiredTeacher = { ...mockTeacher, otp: '123456', otpExpiry: new Date(Date.now() - 1000) };
      teacherModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(expiredTeacher),
        }),
      });

      await expect(
        service.resetPassword({
          email: 'teacher@test.com',
          role: Role.TEACHER,
          otp: '123456',
          newPassword: 'NewPassword@123',
        }),
      ).rejects.toThrow('انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد');
    });

    it('should throw BadRequestException if OTP was not requested first', async () => {
      const teacherWithoutOtp = { ...mockTeacher, otp: undefined, otpExpiry: undefined };
      teacherModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(teacherWithoutOtp),
        }),
      });

      await expect(
        service.resetPassword({
          email: 'teacher@test.com',
          role: Role.TEACHER,
          otp: '123456',
          newPassword: 'NewPassword@123',
        }),
      ).rejects.toThrow('يرجى طلب رمز التحقق أولاً');
    });
  });
});
