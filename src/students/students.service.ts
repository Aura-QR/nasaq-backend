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
import { transformStudentResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { Counter } from 'src/Counter/Schema/counter.schema';
import { PasswordUtil } from 'src/auth/utils/password.util';
import { EmailService } from 'src/email/email.service';
import { FinancialRecordService } from 'src/financial/financial-record.service';

@Injectable()
export class StudentsService {
  constructor(
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Counter.name)
       private readonly counterModel: Model<Counter>,
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


    if (createStudentDto.classId) {
      const classData = await this.classModel.findById(createStudentDto.classId);

      if (!classData) {
        throw new NotFoundException(`الفصل بمعرف ${createStudentDto.classId} غير موجود`);
      }

      if (classData.gender !== 'both' && classData.gender !== createStudentDto.gender) {
        throw new BadRequestException(
          `هذا الفصل مخصص للطلاب من جنس ${classData.gender} فقط. جنس الطالب هو ${createStudentDto.gender}`
        );
      }
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

    const { password: _, ...studentData } = createStudentDto;
    const studentFields: any = { ...studentData, schoolEmail };

    if (createStudentDto.password) {
      studentFields.password = await PasswordUtil.hash(createStudentDto.password);
      studentFields.hasPassword = true;
    }

    const student = new this.studentModel(studentFields);
    await student.save();

    if (createStudentDto.classId) {
      await this.classModel.findByIdAndUpdate(
        createStudentDto.classId,
        { $addToSet: { studentIds: student._id } }
      );
    }

    await student.populate('classId', 'roomNumber gender academicYear');

    return {
      message: 'تم إضافة الطالب بنجاح',
      data: transformStudentResponse(student),
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

    const textSearchFields = ['name', 'firstName', 'familyName', 'fatherName', 'nationality', 'address', 'previousSchool', 'notes','schoolEmail'];

    const exactMatchFields = ['gender', 'academicYear', 'phoneNumber', 'email', 'classId'];

    for (const [key, value] of Object.entries(filters)) {
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
        } else if (key === 'classId') {
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

    if (updateStudentDto.email) {
      const existingStudent = await this.studentModel.findOne({
        email: updateStudentDto.email,
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

    if (updateStudentDto.classId !==  undefined) {
      const oldClassId = currentStudent.classId?.toString();
      const newClassId = updateStudentDto.classId?.toString();

      if (oldClassId !== newClassId) {

        if (newClassId) {
          const newClass = await this.classModel.findById(newClassId);

          if (!newClass) {
            throw new NotFoundException(`الفصل بمعرف ${newClassId} غير موجود`);
          }
          const studentGender = updateStudentDto.gender || currentStudent.gender;
          if (newClass.gender !== 'both' && newClass.gender !== studentGender) {
            throw new BadRequestException(
              `هذا الفصل مخصص للطلاب من جنس ${newClass.gender} فقط. جنس الطالب هو ${studentGender}`
            );
          }
        }
        if (oldClassId) {
          await this.classModel.findByIdAndUpdate(
            oldClassId,
            { $pull: { studentIds: id } }
          );
        }
        if (newClassId) {
          await this.classModel.findByIdAndUpdate(
            newClassId,
            { $addToSet: { studentIds: id } }
          );
          await this.financialRecordService.createOrUpdateRecord(id, newClassId);
        }
      }
    }

    if (updateStudentDto.installmentPlanId !== undefined) {
      const oldInstallmentPlanId = currentStudent.installmentPlanId?.toString() || null;
      const newInstallmentPlanId = updateStudentDto.installmentPlanId?.toString() || null;

      if (oldInstallmentPlanId !== newInstallmentPlanId) {
        await this.financialRecordService.switchTuitionInstallmentPlan(
          id,
          updateStudentDto.installmentPlanId,
        );
      }
    }
    const student = await this.studentModel
      .findByIdAndUpdate(id, updateStudentDto, { new: true })
      .populate('classId', 'roomNumber gender academicYear')
      .exec();
    if (!student) {
      throw new NotFoundException(`الطالب بمعرف ${id} غير موجود`);
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
    const student = await this.studentModel.findOne({ email });

    if (!student) {
      throw new NotFoundException('البريد الإلكتروني غير مسجل');
    }

    if (student.hasPassword) {
      throw new BadRequestException('لديك كلمة مرور بالفعل، يرجى تسجيل الدخول');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.studentModel.findByIdAndUpdate(student._id, {
      $set: { otp, otpExpiry },
    });

    await this.emailService.sendOtp(email, otp);

    return { message: 'تم إرسال كود التحقق إلى بريدك الإلكتروني' };
  }

  async setPassword(email: string, otp: string, newPassword: string) {
    const student = await this.studentModel
      .findOne({ email })
      .select('+password +otp +otpExpiry');

    if (!student) {
      throw new NotFoundException('البريد الإلكتروني غير مسجل');
    }

    if (student.hasPassword) {
      throw new BadRequestException('لديك كلمة مرور بالفعل');
    }

    if (!student.otp || !student.otpExpiry) {
      throw new BadRequestException('يرجى طلب كود التحقق أولاً');
    }

    if (new Date() > student.otpExpiry) {
      throw new BadRequestException('انتهت صلاحية كود التحقق، يرجى طلب كود جديد');
    }

    if (student.otp !== otp) {
      throw new BadRequestException('كود التحقق غير صحيح');
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
