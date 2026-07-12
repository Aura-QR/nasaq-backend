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
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<Subject>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
  ) { }

  async create(createTeacherDto: CreateTeacherDto) {
    // CRITICAL: Verify all subjects exist (REQUIRED)
    const subjects = await this.subjectModel.find({
      _id: { $in: createTeacherDto.subjectIds }
    });

    if (subjects.length !== createTeacherDto.subjectIds.length) {
      const foundIds = subjects.map(s => s._id.toString());
      const notFoundIds = createTeacherDto.subjectIds.filter(id => !foundIds.includes(id));
      throw new NotFoundException(
        `المواد بمعرفات ${notFoundIds.join(', ')} غير موجودة. يجب تعيين المعلم لمواد موجودة`,
      );
    }

    const existingEmailTeacher = await this.teacherModel.findOne({
      email: createTeacherDto.email,
    });

    if (existingEmailTeacher) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await PasswordUtil.hash(createTeacherDto.password);
    const teacher = new this.teacherModel({
      ...createTeacherDto,
      password: hashedPassword,
    });
    await teacher.save();

    // Populate subject details in response
    await teacher.populate('subjectIds', 'subjectName');

    const teacherObject = teacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      message: 'تم إضافة المعلم بنجاح',
      teacher: {
        ...rest,
        subjects: subjectIds,
      },
    };
  }

  async findAll() {
    const teachers = await this.teacherModel
      .find()
      .populate('subjectIds', 'subjectName academicLevel')
      .exec();

    return teachers.map((teacher) => {
      const teacherObject = teacher.toObject();
      const { subjectIds, ...rest } = teacherObject;
      return {
        ...rest,
        subjects: subjectIds,
      };
    });
  }

  async findOne(id: string) {
    const teacher = await this.teacherModel
      .findById(id)
      .populate('subjectIds', 'subjectName weeklyHours academicLevel')
      .exec();

    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    const teacherObject = teacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      ...rest,
      subjects: subjectIds,
    };
  }

  async update(id: string, updateTeacherDto: UpdateTeacherDto) {

    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    if (updateTeacherDto.subjectIds && updateTeacherDto.subjectIds.length > 0) {
      const uniqueSubjectIds = [...new Set(updateTeacherDto.subjectIds)];
      if (uniqueSubjectIds.length !== updateTeacherDto.subjectIds.length) {
        throw new BadRequestException('معرفات المواد المكررة غير مسموح بها');
      }

     
      const subjects = await this.subjectModel.find({
        _id: { $in: updateTeacherDto.subjectIds }
      });

      if (subjects.length !== updateTeacherDto.subjectIds.length) {
        const foundIds = subjects.map(s => s._id.toString());
        const notFoundIds = updateTeacherDto.subjectIds.filter(id => !foundIds.includes(id));
        throw new NotFoundException(
          `المواد بمعرفات ${notFoundIds.join(', ')} غير موجودة`,
        );
      }
    }

    if (updateTeacherDto.email) {
      const existingTeacher = await this.teacherModel.findOne({
        email: updateTeacherDto.email,
        _id: { $ne: id },
      });

      if (existingTeacher) {
        throw new ConflictException('Email already exists');
      }
    }

    const updatedTeacher = await this.teacherModel
      .findByIdAndUpdate(id, updateTeacherDto, { new: true })
      .populate('subjectIds', 'subjectName')
      .exec();

    const teacherObject = updatedTeacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      message: 'تم تحديث بيانات المعلم بنجاح',
      teacher: {
        ...rest,
        subjects: subjectIds,
      },
    };
  }

  async remove(id: string) {
    const teacher = await this.teacherModel.findById(id);

    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

   
    const assignedLectures = await this.lectureModel
      .find({ teacherId: id })
      .exec();

    if (assignedLectures.length > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المعلم. المعلم مسند له ${assignedLectures.length} محاضرة. يرجى إزالة جميع المحاضرات المسندة أولاً`
      );
    }
    await this.teacherModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المعلم بنجاح',
      details: {
        subjectsUnassigned: teacher.subjectIds.length,
      },
    };
  }


  async list() {
    const teachers = await this.teacherModel.find().sort({ createdAt: -1 }).exec();

    return teachers.map((teacher) => ({
      id: teacher._id,
      fullName: teacher.name,
    }));
  }

  async findBySubject(subjectId: string) {
    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`المادة بمعرف ${subjectId} غير موجودة`);
    }

    const teachers = await this.teacherModel
      .find({ subjectIds: subjectId, isActive: true })
      .populate('subjectIds', 'subjectName')
      .exec();

    return {
      subject: {
        id: subject._id,
        name: subject.subjectName,
      },
      teachers: teachers.map((teacher) => {
        const teacherObject = teacher.toObject();
        const { subjectIds, ...rest } = teacherObject;
        return {
          ...rest,
          subjects: subjectIds,
        };
      }),
    };
  }

  async findActive() {
    const teachers = await this.teacherModel
      .find({ isActive: true })
      .populate('subjectIds', 'subjectName academicLevel')
      .exec();

    return teachers.map((teacher) => {
      const teacherObject = teacher.toObject();
      const { subjectIds, ...rest } = teacherObject;
      return {
        ...rest,
        subjects: subjectIds,
      };
    });
  }

  async findInactive() {
    const teachers = await this.teacherModel
      .find({ isActive: false })
      .populate('subjectIds', 'subjectName academicLevel')
      .exec();

    return teachers.map((teacher) => {
      const teacherObject = teacher.toObject();
      const { subjectIds, ...rest } = teacherObject;
      return {
        ...rest,
        subjects: subjectIds,
      };
    });
  }

  async toggleActive(id: string) {
    const teacher = await this.teacherModel.findById(id);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${id} غير موجود`);
    }

    teacher.isActive = !teacher.isActive;
    await teacher.save();

    await teacher.populate('subjectIds', 'subjectName');

    const teacherObject = teacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      message: `تم ${teacher.isActive ? 'تفعيل' : 'إلغاء تفعيل'} المعلم بنجاح`,
      teacher: {
        ...rest,
        subject: subjectIds,
      },
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

    let teachersQuery = this.teacherModel
      .find(query).sort({ createdAt: -1 })
      .populate('subjectIds', 'subjectName');

    if (isPaginationRequested) {
      teachersQuery = teachersQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const teachers = await teachersQuery.exec();
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;

    const transformedTeachers = teachers.map((teacher) => {
      const teacherObject = teacher.toObject();
      const { subjectIds, ...rest } = teacherObject;
      return {
        ...rest,
        subject: subjectIds,
      };
    });

    if (isPaginationRequested) {
      return {
        data: transformedTeachers,
        totalDocs,
        totalPages
      };
    }

    return transformedTeachers;
  }

  async addSubject(teacherId: string, subjectId: string) {
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`المادة بمعرف ${subjectId} غير موجودة`);
    }

    if (teacher.subjectIds.includes(subjectId as any)) {
      throw new ConflictException('المادة مسندة بالفعل لهذا المعلم');
    }

    teacher.subjectIds.push(subjectId as any);
    await teacher.save();

    await teacher.populate('subjectIds', 'subjectName academicLevel');

    const teacherObject = teacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      message: 'تم إضافة المادة للمعلم بنجاح',
      teacher: {
        ...rest,
        subjects: subjectIds,
      },
    };
  }

  async removeSubject(teacherId: string, subjectId: string) {
    const teacher = await this.teacherModel.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`المادة بمعرف ${subjectId} غير موجودة`);
    }

    const subjectIndex = teacher.subjectIds.findIndex(
      (id) => id.toString() === subjectId
    );

    if (subjectIndex === -1) {
      throw new BadRequestException('المادة غير مسندة لهذا المعلم');
    }

    teacher.subjectIds.splice(subjectIndex, 1);
    await teacher.save();

    await teacher.populate('subjectIds', 'subjectName academicLevel');

    const teacherObject = teacher.toObject();
    const { subjectIds, ...rest } = teacherObject;

    return {
      message: 'تم إزالة المادة من المعلم بنجاح',
      teacher: {
        ...rest,
        subjects: subjectIds,
      },
    };
  }

  async getMyProfile(teacherId: string) {
    const teacher = await this.teacherModel
      .findById(teacherId)
      .populate('subjectIds', 'subjectName subjectCode')
      .exec();

    if (!teacher) {
      throw new NotFoundException(`المعلم بمعرف ${teacherId} غير موجود`);
    }

    const teacherObject = teacher.toObject();
    const { password, subjectIds, ...rest } = teacherObject;

    return {
      message: 'تم استرجاع ملف المعلم بنجاح',
      data: {
        ...rest,
        subjects: subjectIds,
      },
    };
  }
}