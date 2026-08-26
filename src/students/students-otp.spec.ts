import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StudentsService } from './students.service';
import { EmailService } from '../email/email.service';
import { Student } from './schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Counter } from '../Counter/Schema/counter.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { StudentFinancialRecord } from '../financial/schemas/student-financial-record.schema';
import { FinancialRecordService } from '../financial/financial-record.service';
import { BusService } from '../financial/bus.service';

describe('StudentsService OTP Feature', () => {
  let service: StudentsService;
  let emailService: jest.Mocked<EmailService>;

  const mockStudent = {
    _id: 'student123',
    email: 'student@test.com',
    schoolEmail: 'student@school.com',
    password: 'hashedpassword',
    hasPassword: false,
    otp: '123456',
    otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
    save: jest.fn().mockResolvedValue(true),
  };

  const mockModel = () => ({
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findById: jest.fn(),
  });

  let studentModelMock: any;

  beforeEach(async () => {
    studentModelMock = mockModel();

    const mockEmailService = {
      sendPasswordResetOtp: jest.fn().mockResolvedValue(undefined),
      sendOtp: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: EmailService, useValue: mockEmailService },
        { provide: FinancialRecordService, useValue: {} },
        // StudentsService gained this dependency when POST /students started
        // enrolling a student in a bus plan at creation time.
        { provide: BusService, useValue: { enroll: jest.fn() } },
        { provide: getModelToken(Student.name), useValue: studentModelMock },
        { provide: getModelToken(Class.name), useValue: mockModel() },
        { provide: getModelToken(Counter.name), useValue: mockModel() },
        { provide: getModelToken(Enrollment.name), useValue: mockModel() },
        { provide: getModelToken(StudentFinancialRecord.name), useValue: mockModel() },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
    emailService = module.get(EmailService);
  });

  describe('requestPasswordSetup', () => {
    it('should generate OTP and send email for valid student', async () => {
      studentModelMock.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(mockStudent),
      });
      studentModelMock.findByIdAndUpdate.mockResolvedValue(mockStudent);

      const response = await service.requestPasswordSetup('student@test.com');

      expect(response.message).toContain('تم إرسال رمز التحقق');
      expect(studentModelMock.findByIdAndUpdate).toHaveBeenCalledWith(
        'student123',
        expect.objectContaining({
          $set: expect.objectContaining({
            otp: expect.stringMatching(/^\d{6}$/),
            otpExpiry: expect.any(Date),
          }),
        }),
        { skipTenantScope: true },
      );
      expect(emailService.sendPasswordResetOtp).toHaveBeenCalledWith(
        'student@test.com',
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should throw NotFoundException if student email does not exist', async () => {
      studentModelMock.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(null),
      });

      await expect(service.requestPasswordSetup('unknown@test.com')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setPassword', () => {
    it('should set student password and clear OTP when OTP is valid', async () => {
      const studentObj = {
        ...mockStudent,
        otp: '123456',
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
        save: jest.fn().mockResolvedValue(true),
      };

      studentModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(studentObj),
        }),
      });

      const response = await service.setPassword('student@test.com', '123456', 'NewPassword123');

      expect(response.message).toContain('تم تعيين كلمة المرور بنجاح');
      expect(studentObj.hasPassword).toBe(true);
      expect(studentObj.otp).toBeUndefined();
      expect(studentObj.otpExpiry).toBeUndefined();
      expect(studentObj.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if OTP is incorrect', async () => {
      const studentObj = {
        ...mockStudent,
        otp: '123456',
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
      };

      studentModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(studentObj),
        }),
      });

      await expect(
        service.setPassword('student@test.com', '999999', 'NewPassword123'),
      ).rejects.toThrow('رمز التحقق غير صحيح');
    });

    it('should throw BadRequestException if OTP has expired', async () => {
      const expiredStudent = {
        ...mockStudent,
        otp: '123456',
        otpExpiry: new Date(Date.now() - 5000),
      };

      studentModelMock.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          setOptions: jest.fn().mockResolvedValue(expiredStudent),
        }),
      });

      await expect(
        service.setPassword('student@test.com', '123456', 'NewPassword123'),
      ).rejects.toThrow('انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد');
    });
  });
});
