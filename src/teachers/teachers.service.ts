import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { Teacher } from './schemas/teacher.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { PasswordUtil } from 'src/auth/utils/password.util';

@Injectable()
export class TeachersService {
  constructor(
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Subject.name) private readonly subjectModel: Model<Subject>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
  ) {}

  async create(createTeacherDto: CreateTeacherDto) {
    const existingEmailTeacher = await this.teacherModel.findOne({
      email: createTeacherDto.email,
    });

    if (existingEmailTeacher) {
      throw new ConflictException('Email already exists');
    }

    if (createTeacherDto.status !== undefined && createTeacherDto.isActive === undefined) {
      createTeacherDto.isActive = createTeacherDto.status === 'active' || createTeacherDto.status === 'true';
    }
    if (createTeacherDto.isActive === undefined) {
      createTeacherDto.isActive = true;
    }
    if (!createTeacherDto.hireDate) {
      createTeacherDto.hireDate = new Date().toISOString().split('T')[0];
    }

    const { status, subjects, password, ...teacherFields } = createTeacherDto as any;
    const hashedPassword = await PasswordUtil.hash(password || 'Teacher@123');

    const teacher = new this.teacherModel({
      ...teacherFields,
      password: hashedPassword,
    });
    await teacher.save();

    return {
      message: 'تم إضافة المعلم بنجاح',
      teacher: teacher.toObject(),
    };
  }

  async findAll() {
    return this.teacherModel.find().exec();
  }

  async findOne(id: string) {
    const teacher = await this.teacherModel.findById(id).exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }
    return teacher;
  }

  async update(id: string, updateTeacherDto: UpdateTeacherDto) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    if (updateTeacherDto.status !== undefined && updateTeacherDto.isActive === undefined) {
      updateTeacherDto.isActive = updateTeacherDto.status === 'active' || updateTeacherDto.status === 'true';
    }

    const { status, subjects, ...cleanUpdateData } = updateTeacherDto as any;

    if (cleanUpdateData.email) {
      const existingTeacher = await this.teacherModel.findOne({
        email: cleanUpdateData.email,
        _id: { $ne: id },
      });

      if (existingTeacher) {
        throw new ConflictException('Email already exists');
      }
    }

    if (cleanUpdateData.password) {
      cleanUpdateData.password = await PasswordUtil.hash(cleanUpdateData.password);
    }

    const updatedTeacher = await this.teacherModel
      .findByIdAndUpdate(id, cleanUpdateData, { new: true })
      .exec();

    return {
      message: 'تم تحديث بيانات المعلم بنجاح',
      teacher: updatedTeacher,
    };
  }

  async remove(id: string) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    const assignedLectures = await this.lectureModel.find({ teacherId: id }).exec();
    if (assignedLectures.length > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المعلم. المعلم مسند له ${assignedLectures.length} محاضرة. يرجى إزالة جميع المحاضرات المسندة أولاً`,
      );
    }
    await this.teacherModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المعلم بنجاح',
    };
  }

  async list() {
    const teachers = await this.teacherModel.find().sort({ createdAt: -1 }).exec();
    return teachers.map((teacher) => ({
      id: teacher._id,
      fullName: teacher.name,
    }));
  }

  async findActive() {
    return this.teacherModel.find({ isActive: true }).exec();
  }

  async findInactive() {
    return this.teacherModel.find({ isActive: false }).exec();
  }

  async toggleActive(id: string) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    teacher.isActive = !teacher.isActive;
    await teacher.save();

    return {
      message: `تم ${teacher.isActive ? 'تفعيل' : 'إلغاء تفعيل'} المعلم بنجاح`,
      teacher,
    };
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};
    const textSearchFields = ['name', 'qualification', 'experience', 'specialization', 'address'];
    const exactMatchFields = ['email', 'phoneNumber'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'isActive' || key === 'isInCharge') {
        query[key] = stringValue === 'true';
      } else if (key === 'hireDate') {
        query[key] = new Date(stringValue);
      } else if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (exactMatchFields.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }

    const total = await this.teacherModel.countDocuments(query).exec();
    const paginationMate = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let teachersQuery = this.teacherModel.find(query).sort({ createdAt: -1 });

    if (isPaginationRequested) {
      teachersQuery = teachersQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const teachers = await teachersQuery.exec();

    if (isPaginationRequested) {
      return {
        data: teachers,
        totalDocs: paginationMate.total,
        totalPages: paginationMate.totalPages,
      };
    }

    return teachers;
  }

  async getMyProfile(teacherId: string) {
    const teacher = await this.teacherModel.findById(teacherId).exec();
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    const teacherObject = teacher.toObject();
    const { password, ...rest } = teacherObject;

    return {
      message: 'تم استرجاع ملف المعلم بنجاح',
      data: rest,
    };
  }
}