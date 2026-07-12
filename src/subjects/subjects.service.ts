import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { Subject } from './schemas/subject.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Class } from '../classes/schemas/class.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { GradesCriteria } from '../grades-criteria/schemas/grades-criteria.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { Project } from '../projects/schemas/project.schema';
import { Student } from '../students/schemas/student.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<Subject>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(Class.name)
    private readonly classModel: Model<Class>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(GradesCriteria.name)
    private readonly gradesCriteriaModel: Model<GradesCriteria>,
    @InjectModel(Exam.name)
    private readonly examModel: Model<Exam>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    @InjectModel(Student.name)
    private readonly studentModel: Model<Student>,
  ) { }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async getMySubjects(studentId: string) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    if (!student.classId) {
      return { message: 'الطالب غير مسجل في أي فصل', data: [] };
    }

    const subjects = await this.subjectModel
      .find({ classIds: student.classId })
      .select('subjectName subjectCode')
      .exec();

    return {
      message: 'تم استرجاع مواد الطالب بنجاح',
      data: subjects,
    };
  }

  async getTeacherSubjects(teacherId: string) {
    const lectures = await this.lectureModel
      .find({ teacherId })
      .select('subjectId')
      .exec();

    const subjectIds = [...new Set(lectures.map((l: any) => l.subjectId.toString()))];

    const subjects = await this.subjectModel
      .find({ _id: { $in: subjectIds } })
      .select('subjectName subjectCode')
      .exec();

    return { message: 'تم استرجاع مواد المعلم بنجاح', data: subjects };
  }

  async create(createSubjectDto: CreateSubjectDto) {
    if (createSubjectDto.subjectCode) {
      const normalizedSubjectCode = createSubjectDto.subjectCode.trim();

      if (normalizedSubjectCode) {
        const existingSubjectWithCode = await this.subjectModel.findOne({
          subjectCode: {
            $regex: `^${this.escapeRegex(normalizedSubjectCode)}$`,
            $options: 'i',
          },
        });

        if (existingSubjectWithCode) {
          throw new ConflictException('كود المادة مستخدم بالفعل، يرجى إدخال كود مختلف');
        }
      }

      createSubjectDto.subjectCode = normalizedSubjectCode;
    }

    const subject = new this.subjectModel(createSubjectDto);
    await subject.save();

    if (createSubjectDto.classIds && createSubjectDto.classIds.length > 0) {
      await this.classModel.updateMany(
        { _id: { $in: createSubjectDto.classIds } },
        { $addToSet: { subjectIds: subject._id } },
      );
    }

    return {
      message: 'تم إنشاء المادة بنجاح',
      subject,
    };
  }

  async findAll() {
    const subjects = await this.subjectModel
      .find()
      .populate('classIds', 'academicYear roomNumber')
      .exec();

    return subjects;
  }

  async findOne(id: string) {
    const subject = await this.subjectModel
      .findById(id)
      .populate('classIds', 'academicYear roomNumber')
      .exec();

    if (!subject) {
      throw new NotFoundException(`المادة ذات المعرف ${id} غير موجودة`);
    }

    return subject;
  }

  async update(id: string, updateSubjectDto: UpdateSubjectDto) {
    if (updateSubjectDto.subjectCode !== undefined) {
      const normalizedSubjectCode = updateSubjectDto.subjectCode?.trim();

      if (normalizedSubjectCode) {
        const existingSubjectWithCode = await this.subjectModel.findOne({
          _id: { $ne: id },
          subjectCode: {
            $regex: `^${this.escapeRegex(normalizedSubjectCode)}$`,
            $options: 'i',
          },
        });

        if (existingSubjectWithCode) {
          throw new ConflictException('كود المادة مستخدم بالفعل، يرجى إدخال كود مختلف');
        }
      }

      updateSubjectDto.subjectCode = normalizedSubjectCode;
    }

    if (updateSubjectDto.classIds !== undefined) {
      const existingSubject = await this.subjectModel.findById(id);

      if (existingSubject && existingSubject.classIds && existingSubject.classIds.length > 0) {
        await this.classModel.updateMany(
          { _id: { $in: existingSubject.classIds } },
          { $pull: { subjectIds: id } },
        );
      }

      if (updateSubjectDto.classIds.length > 0) {
        await this.classModel.updateMany(
          { _id: { $in: updateSubjectDto.classIds } },
          { $addToSet: { subjectIds: id } },
        );
      }
    }

    const subject = await this.subjectModel
      .findByIdAndUpdate(id, updateSubjectDto, { new: true })
      .exec();

    if (!subject) {
      throw new NotFoundException(`المادة ذات المعرف ${id} غير موجودة`);
    }

    return {
      message: 'تم تحديث المادة بنجاح',
      subject,
    };
  }

  async remove(id: string) {
    const subjectToDelete = await this.subjectModel.findById(id);

    if (!subjectToDelete) {
      throw new NotFoundException(`المادة ذات المعرف ${id} غير موجودة`);
    }

    // Check if subject is assigned to any lectures (active or inactive)
    const assignedLectures = await this.lectureModel
      .find({ subjectId: id })
      .exec();

    if (assignedLectures.length > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المادة. المادة مستخدمة في ${assignedLectures.length} محاضرة. ` +
        `يرجى إزالة جميع المحاضرات المسندة أولاً.`
      );
    }

    const teachersCount = await this.teacherModel.countDocuments({ subjectIds: id });

    if (teachersCount > 0) {
      throw new BadRequestException(
        `لا يمكن حذف المادة. ${teachersCount} مدرس مسند لهذه المادة.`,
      );
    }

    if (subjectToDelete.classIds && subjectToDelete.classIds.length > 0) {
      await this.classModel.updateMany(
        { _id: { $in: subjectToDelete.classIds } },
        { $pull: { subjectIds: id } },
      );
    }

    // Cascade delete: Remove all exams and projects for this subject
    await this.examModel.deleteMany({ subjectId: id });
    await this.projectModel.deleteMany({ subjectId: id });

    // Cascade delete: Remove all grading criteria for this subject
    await this.gradesCriteriaModel.deleteMany({ subjectId: id });

    await this.subjectModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المادة بنجاح (بما في ذلك معايير التقييم والامتحانات والمشاريع المرتبطة)',
    };
  }

  async addClass(subjectId: string, classId: string) {
    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`Subject with ID ${subjectId} not found`);
    }

    const classData = await this.classModel.findById(classId);
    if (!classData) {
      throw new NotFoundException(`الفصل ذو المعرف ${classId} غير موجود`);
    }

    await this.classModel.findByIdAndUpdate(
      classId,
      { $addToSet: { subjectIds: subjectId } },
    );

    const updatedSubject = await this.subjectModel
      .findByIdAndUpdate(
        subjectId,
        { $addToSet: { classIds: classId } },
        { new: true },
      )
      .populate('classIds', 'academicYear roomNumber')
      .exec();

    return {
      message: 'تم إضافة الفصل للمادة بنجاح',
      subject: updatedSubject,
    };
  }

  async removeClass(subjectId: string, classId: string) {
    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`Subject with ID ${subjectId} not found`);
    }

    await this.classModel.findByIdAndUpdate(
      classId,
      { $pull: { subjectIds: subjectId } },
    );

    const updatedSubject = await this.subjectModel
      .findByIdAndUpdate(
        subjectId,
        { $pull: { classIds: classId } },
        { new: true },
      )
      .populate('classIds', 'academicYear roomNumber')
      .exec();

    return {
      message: 'تم إزالة الفصل من المادة بنجاح',
      subject: updatedSubject,
    };
  }

  async list() {
    const subjects = await this.subjectModel.find().sort({ createdAt: -1 }).exec();

    return subjects.map((subject) => ({
      id: subject._id,
      name: subject.subjectName
    }));
  }

  async getAvailableTeachers() {
    const teachers = await this.teacherModel
      .find()
      .select('name email')
      .exec();

    return teachers.map((teacher) => ({
      id: teacher._id,
      fullName: teacher.name,
      email: teacher.email,
    }));
  }

  async filtering(filters: any, pagination: PaginationDto = {}, user?: any) {
    const query: any = {};

    const textSearchFields = ['subjectName','subjectCode'];
    const arrayMatchFields = ['classIds'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (arrayMatchFields.includes(key)) {
        query[key] = { $in: [stringValue] };
      } else {
        query[key] = stringValue;
      }
    }

    if (user?.role === 'TEACHER') {
      const teacher = await this.teacherModel.findById(user.userId);

      if (teacher && teacher.subjectIds && teacher.subjectIds.length > 0) {
        query._id = { $in: teacher.subjectIds };
      } else {
        query._id = null;
      }
    }

    const total = await this.subjectModel.countDocuments(query).exec();

    const paginationMate = getPagination(pagination.page, pagination.limit, total);

    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let subjectsQuery = this.subjectModel.find(query).sort({ createdAt: -1 });

    if (isPaginationRequested) {
      subjectsQuery = subjectsQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const subjects = await subjectsQuery.exec();
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;

    if (isPaginationRequested) {
      return {
        data: subjects,
        totalDocs,
        totalPages
      };
    }

    return subjects;
  }
}