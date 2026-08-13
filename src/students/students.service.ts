import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Student } from './schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { transformStudentResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { Counter } from 'src/Counter/Schema/counter.schema';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { EmailService } from 'src/email/email.service';
import { FinancialRecordService } from 'src/financial/financial-record.service';
import { StudentFinancialRecord } from '../financial/schemas/student-financial-record.schema';

@Injectable()
export class StudentsService {
  constructor(
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Counter.name)
    private readonly counterModel: Model<Counter>,
    @InjectModel(Enrollment.name)
    private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(StudentFinancialRecord.name)
    private readonly financialRecordModel: Model<StudentFinancialRecord>,
    private readonly emailService: EmailService,
    private readonly financialRecordService: FinancialRecordService,
  ) { }


  async create(createStudentDto: CreateStudentDto) {
    if (createStudentDto.gender) {
      createStudentDto.gender = createStudentDto.gender.toLowerCase();
    }

    const existingStudent = await this.studentModel.findOne({
      email: createStudentDto.email,
    });


    if (existingStudent) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }




    const currentYear = new Date().getFullYear();
    const year = currentYear.toString().slice(-2);

    
    const existingCounter = await this.counterModel.findOne({ name: 'students_counter' });

    if (existingCounter && Number(existingCounter.year) < Number(year)) {
      await this.counterModel.findOneAndUpdate(
        { name: 'students_counter' },
        { $set: { year: year, count: 0 } },
        { new: true }
      );
    }


    const counter = await this.counterModel.findOneAndUpdate(
      { name: 'students_counter', year: year },
      { $inc: { count: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const formattedCount = counter.count.toString().padStart(4, '0');
    const schoolEmail = `au${year}${formattedCount}@student.auraschool.com`;

    const { password: _, status, subjects, ...studentData } = createStudentDto as any;
    const studentFields: any = { ...studentData, schoolEmail };

    if (status !== undefined && studentFields.isActive === undefined) {
      studentFields.isActive = status === 'active' || status === 'true';
    }

    if (createStudentDto.password) {
      studentFields.password = await PasswordUtil.hash(createStudentDto.password);
      studentFields.hasPassword = true;
    }

    const student = new this.studentModel(studentFields);
    await student.save();

    // Auto-create matching Enrollment record if classId is provided
    if (createStudentDto.classId && mongoose.Types.ObjectId.isValid(createStudentDto.classId)) {
      const targetClass = await this.classModel.findById(createStudentDto.classId).exec();
      if (targetClass && targetClass.academicYearId) {
        await this.enrollmentModel.findOneAndUpdate(
          {
            studentId: student._id,
            academicYearId: targetClass.academicYearId,
          },
          {
            $set: {
              studentId: student._id,
              classId: targetClass._id,
              academicYearId: targetClass.academicYearId,
              status: 'active',
              enrolledAt: new Date(),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Create/update the student's financial record for this academic year
        try {
          await this.financialRecordService.createOrUpdateRecord(
            (student._id as any).toString(),
            (targetClass._id as any).toString(),
            (targetClass as any).schoolId?.toString() ?? '',
          );
        } catch (error: any) {
          await this.enrollmentModel.findOneAndDelete({
            studentId: student._id,
            academicYearId: targetClass.academicYearId,
          }).exec();
          await this.studentModel.findByIdAndDelete(student._id).exec();
          throw error;
        }
      }
    }

    // `select: false` hides the hash from QUERIES, but this document was just
    // built in memory, so it still carries it. Strip it explicitly or the create
    // response leaks what every read is careful not to.
    const { password: _hash, otp: _otp, otpExpiry: _exp, ...safeStudent } =
      transformStudentResponse(student) as any;

    return {
      message: 'تم إضافة الطالب بنجاح',
      data: safeStudent,
    };
  }

  async findAll() {
    const students = await this.studentModel
      .find()
      .populate('classId', 'roomNumber gender academicYear')
      .exec();

    return students.map(student => transformStudentResponse(student));
  }

  async findOne(id: string) {
    const student = await this.studentModel
      .findById(id)
      .populate('classId', 'roomNumber gender academicYear')
      .exec();

    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
    }

    return transformStudentResponse(student);
  }

  async getMyProfile(studentId: string) {
    return this.findOne(studentId);
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};

    const academicYearParam = filters.academicYearId || filters.academicYear;
    const cleanFilters = { ...filters };
    delete cleanFilters.academicYearId;
    delete cleanFilters.academicYear;

    if (academicYearParam && mongoose.Types.ObjectId.isValid(String(academicYearParam))) {
      const enrollments = await this.enrollmentModel
        .find({
          academicYearId: new mongoose.Types.ObjectId(String(academicYearParam)),
          status: 'active',
        })
        .select('studentId')
        .exec();

      const studentIds = enrollments.map((e) => e.studentId);
      query._id = { $in: studentIds };
    }

    const textSearchFields = ['name', 'firstName', 'familyName', 'fatherName', 'nationality', 'address', 'previousSchool', 'notes','schoolEmail'];
    const exactMatchFields = ['gender', 'phoneNumber', 'email', 'classId'];

    for (const [key, value] of Object.entries(cleanFilters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'isActive') {
        query[key] = stringValue === 'true';
      }
      else if (key === 'birthDate' || key === 'registrationDate') {
        query[key] = new Date(stringValue);
      }
      else if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      }
      else if (exactMatchFields.includes(key)) {
        if (key === 'classId' && stringValue === 'null') {
          query[key] = null;
        } else if (key === 'classId' && mongoose.Types.ObjectId.isValid(stringValue)) {
          query[key] = new mongoose.Types.ObjectId(stringValue);
        } else {
          query[key] = stringValue;
        }
      }
      else {
        query[key] = stringValue;
      }
    }

    const total = await this.studentModel.countDocuments(query).exec();

    const paginationMate = getPagination(pagination.page, pagination.limit, total);

    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let studentsQuery = this.studentModel
      .find(query).sort({ createdAt: -1 })
      .populate('classId', 'roomNumber gender academicYear');

    if (isPaginationRequested) {
      studentsQuery = studentsQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const students = await studentsQuery.exec();
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;

    if (isPaginationRequested) {
      return {
        data: students.map(student => transformStudentResponse(student)),
        totalDocs,
        totalPages
      };
    }

    return students.map(student => transformStudentResponse(student));
  }

  async update(id: string, updateStudentDto: UpdateStudentDto) {
    if (updateStudentDto.gender) {
      updateStudentDto.gender = updateStudentDto.gender.toLowerCase();
    }

    const { status, subjects, ...cleanUpdateData } = updateStudentDto as any;
    if (status !== undefined && cleanUpdateData.isActive === undefined) {
      cleanUpdateData.isActive = status === 'active' || status === 'true';
    }

    if (cleanUpdateData.email) {
      const existingStudent = await this.studentModel.findOne({
        email: cleanUpdateData.email,
        _id: { $ne: id },
      });

      if (existingStudent) {
        throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
      }
    }
    const currentStudent = await this.studentModel.findById(id).exec();
    if (!currentStudent) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
    }

    const student = await this.studentModel
      .findByIdAndUpdate(id, cleanUpdateData, { new: true })
      .exec();
    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
    }

    // Auto-update/create matching Enrollment record if classId is provided or updated
    if (cleanUpdateData.classId && mongoose.Types.ObjectId.isValid(String(cleanUpdateData.classId))) {
      const targetClass = await this.classModel.findById(cleanUpdateData.classId).exec();
      if (targetClass && targetClass.academicYearId) {
        await this.enrollmentModel.findOneAndUpdate(
          {
            studentId: student._id,
            academicYearId: targetClass.academicYearId,
          },
          {
            $set: {
              studentId: student._id,
              classId: targetClass._id,
              academicYearId: targetClass.academicYearId,
              status: 'active',
              enrolledAt: new Date(),
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );

        // Create/update the student's financial record for this academic year
        await this.financialRecordService.createOrUpdateRecord(
          (student._id as any).toString(),
          (targetClass._id as any).toString(),
          (targetClass as any).schoolId?.toString() ?? '',
        );
      }
    }

    if (cleanUpdateData.nationalityCode) {
      await this.financialRecordService.recalculateForStudent(id);
    }

    return {
      message: 'تم تحديث بيانات الطالب بنجاح',
      student: transformStudentResponse(student),
    };
  }

  async remove(id: string) {
    const student = await this.studentModel.findById(id).exec();

    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
    }

    const classesWithStudent = await this.classModel.findOne({
      studentIds: id
    }).exec();
    if (classesWithStudent) {
      throw new BadRequestException(
        `لا يمكن حذف الطالب. الطالب مسجل في فصل ${classesWithStudent.roomNumber}، يرجى إزالة الطالب من الفصل أولاً`
      );
    }

    const studentOid = new mongoose.Types.ObjectId(id);
    await this.financialRecordModel.deleteMany({ studentId: studentOid }).exec();
    await this.enrollmentModel.deleteMany({ studentId: studentOid }).exec();
    await this.studentModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف الطالب بنجاح',
    };
  }

  async list() {
    const students = await this.studentModel.find().sort({ createdAt: -1 }).exec();

    return students.map(student => ({
      id: student._id,
      name: `${student.firstName} ${student.familyName}`
    }));
  }

  async requestPasswordSetup(email: string) {
    const cleanEmail = email.toLowerCase().trim();
    const student = await this.studentModel
      .findOne({
        $or: [{ email: cleanEmail }, { schoolEmail: cleanEmail }],
      })
      .setOptions({ skipTenantScope: true });

    if (!student) {
      throw new NotFoundException('البريد الإلكتروني غير مسجل');
    }

    // Fixed '000000' for testing environment
    const otp = '000000';
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.studentModel.findByIdAndUpdate(
      student._id,
      {
        $set: { otp, otpExpiry },
      },
      { skipTenantScope: true },
    );

    await this.emailService.sendPasswordResetOtp(cleanEmail, otp);

    return { message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' };
  }

  async setPassword(email: string, otp: string, newPassword: string) {
    const cleanEmail = email.toLowerCase().trim();
    const student = await this.studentModel
      .findOne({
        $or: [{ email: cleanEmail }, { schoolEmail: cleanEmail }],
      })
      .select('+password +otp +otpExpiry')
      .setOptions({ skipTenantScope: true });

    if (!student) {
      throw new NotFoundException('البريد الإلكتروني غير مسجل');
    }

    // Allow password reset regardless of hasPassword (covers first-time setup AND forgot-password)
    if (!student.otp || !student.otpExpiry) {
      throw new BadRequestException('يرجى طلب رمز التحقق أولاً');
    }

    if (new Date() > student.otpExpiry) {
      throw new BadRequestException('انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد');
    }

    if (student.otp !== otp) {
      throw new BadRequestException('رمز التحقق غير صحيح');
    }

    student.password = await PasswordUtil.hash(newPassword);
    student.hasPassword = true;
    student.otp = undefined;
    student.otpExpiry = undefined;
    await student.save();

    return { message: 'تم تعيين كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن' };
  }

  async toggleActive(id: string) {
    const student = await this.studentModel
      .findById(id)
      .populate('classId', 'roomNumber gender academicYear');

    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
    }

    student.isActive = !student.isActive;
    await student.save();

    await student.populate('classId', 'roomNumber gender academicYear');

    return {
      message: `تم ${student.isActive ? 'تفعيل' : 'إلغاء تفعيل'} الطالب بنجاح`,
      student: transformStudentResponse(student),
    };
  }
}
