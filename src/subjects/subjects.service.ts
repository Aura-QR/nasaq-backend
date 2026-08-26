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
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { Project } from '../projects/schemas/project.schema';
import { GradesCriteria } from '../grades-criteria/schemas/grades-criteria.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { TeacherAssignment } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { StudentClassResolverService } from '../enrollments/student-class-resolver.service';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectModel(Subject.name) private readonly subjectModel: Model<Subject>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Exam.name) private readonly examModel: Model<Exam>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(GradesCriteria.name) private readonly gradesCriteriaModel: Model<GradesCriteria>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(SubjectOffering.name) private readonly subjectOfferingModel: Model<SubjectOffering>,
    @InjectModel(TeacherAssignment.name) private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    private readonly studentClassResolver: StudentClassResolverService,
  ) {}

  private escapeRegex(text: string): string {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  }

  async getMySubjects(studentId: string) {
    // The student's CURRENT class only — see StudentClassResolverService.
    const classIdsSet = new Set<string>(
      await this.studentClassResolver.resolveClassIds(studentId),
    );

    if (classIdsSet.size === 0) {
      return {
        message: 'تم استرجاع مواد الطالب بنجاح',
        data: [],
      };
    }

    const classes = await this.classModel
      .find({ _id: { $in: Array.from(classIdsSet) } })
      .select('gradeLevelId')
      .exec();

    const gradeLevelIds = Array.from(
      new Set(classes.map((c) => c.gradeLevelId?.toString()).filter(Boolean)),
    );

    if (gradeLevelIds.length === 0) {
      return {
        message: 'تم استرجاع مواد الطالب بنجاح',
        data: [],
      };
    }

    const offerings = await this.subjectOfferingModel
      .find({ gradeLevelId: { $in: gradeLevelIds } })
      .select('subjectId')
      .exec();

    const subjectIds = Array.from(
      new Set(offerings.map((o) => o.subjectId?.toString()).filter(Boolean)),
    );

    if (subjectIds.length === 0) {
      return {
        message: 'تم استرجاع مواد الطالب بنجاح',
        data: [],
      };
    }

    const subjects = await this.subjectModel
      .find({ _id: { $in: subjectIds } })
      .select('subjectName subjectCode')
      .exec();

    return {
      message: 'تم استرجاع مواد الطالب بنجاح',
      data: subjects,
    };
  }

  async getTeacherSubjects(teacherId: string) {
    const [lectures, assignments] = await Promise.all([
      this.lectureModel.find({ teacherId }).select('subjectOfferingId').exec(),
      this.teacherAssignmentModel.find({ teacherId }).select('subjectOfferingId').exec(),
    ]);

    const offeringIdsSet = new Set<string>();
    lectures.forEach((l) => {
      if (l.subjectOfferingId) offeringIdsSet.add(l.subjectOfferingId.toString());
    });
    assignments.forEach((a) => {
      if (a.subjectOfferingId) offeringIdsSet.add(a.subjectOfferingId.toString());
    });

    if (offeringIdsSet.size === 0) {
      return { message: 'تم استرجاع مواد المعلم بنجاح', data: [] };
    }

    const offerings = await this.subjectOfferingModel
      .find({ _id: { $in: Array.from(offeringIdsSet) } })
      .select('subjectId')
      .exec();

    const subjectIds = Array.from(
      new Set(offerings.map((o) => o.subjectId?.toString()).filter(Boolean)),
    );

    if (subjectIds.length === 0) {
      return { message: 'تم استرجاع مواد المعلم بنجاح', data: [] };
    }

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

    return {
      message: 'تم إنشاء المادة بنجاح',
      subject,
    };
  }

  async findAll() {
    return this.subjectModel.find().exec();
  }

  async findOne(id: string) {
    const subject = await this.subjectModel.findById(id).exec();
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

    const updatedSubject = await this.subjectModel
      .findByIdAndUpdate(id, updateSubjectDto, { new: true })
      .exec();

    return updatedSubject;
  }

  async remove(id: string) {
    const subjectToDelete = await this.subjectModel.findById(id);
    if (!subjectToDelete) {
      throw new NotFoundException(`المادة ذات المعرف ${id} غير موجودة`);
    }

    const offerings = await this.subjectOfferingModel.find({ subjectId: id }).select('_id').exec();
    const offeringIds = offerings.map((o) => o._id);

    await this.examModel.deleteMany({ subjectId: id });
    await this.projectModel.deleteMany({ subjectId: id });
    await this.gradesCriteriaModel.deleteMany({ subjectOfferingId: { $in: offeringIds } });
    await this.subjectOfferingModel.deleteMany({ subjectId: id });
    await this.subjectModel.findByIdAndDelete(id).exec();

    return {
      message: 'تم حذف المادة بنجاح (بما في ذلك معايير التقييم والامتحانات والمشاريع المرتبطة)',
    };
  }

  async list() {
    const subjects = await this.subjectModel.find().sort({ createdAt: -1 }).exec();
    return subjects.map((subject) => ({
      id: subject._id,
      name: subject.subjectName,
    }));
  }

  async getAvailableTeachers() {
    const teachers = await this.teacherModel.find().select('name email').exec();
    return teachers.map((teacher) => ({
      id: teacher._id,
      fullName: teacher.name,
      email: teacher.email,
    }));
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};
    const textSearchFields = ['subjectName', 'subjectCode'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else {
        query[key] = stringValue;
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

    if (isPaginationRequested) {
      return {
        data: subjects,
        totalDocs: paginationMate.total,
        totalPages: paginationMate.totalPages,
      };
    }

    return subjects;
  }
}