import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateGradesCriteriaDto } from './dto/create-grades-criteria.dto';
import { UpdateGradesCriteriaDto } from './dto/update-grades-criteria.dto';
import { GradesCriteria } from './schemas/grades-criteria.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { transformGradesCriteriaResponse } from './transforms/response.transform';
import { Lecture } from 'src/lectures/schemas/lecture.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { ExamResult } from '../exams/schemas/exam-result.schema';
import { Project } from '../projects/schemas/project.schema';
import { ProjectSubmission } from '../projects/schemas/project-submission.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';

@Injectable()
export class GradesCriteriaService {
  constructor(
    @InjectModel(GradesCriteria.name) private gradesCriteriaModel: Model<GradesCriteria>,
    @InjectModel(Subject.name) private subjectModel: Model<Subject>,
    @InjectModel(Teacher.name) private teacherModel: Model<Teacher>,
    @InjectModel(Lecture.name) private tLectureModel: Model<Lecture>,
    @InjectModel(Exam.name) private examModel: Model<Exam>,
    @InjectModel(Project.name) private projectModel: Model<Project>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(ExamResult.name) private examResultModel: Model<ExamResult>,
    @InjectModel(ProjectSubmission.name) private submissionModel: Model<ProjectSubmission>,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(SubjectOffering.name) private subjectOfferingModel: Model<SubjectOffering>,
  ) {}

  private validateObjectId(id: string, entityName: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة معرف ${entityName} غير صحيحة`);
    }
  }

  private validateGradesSum(grades: { final: number; assignments: number; activities: number; projects: number; quizzes: number }): void {
    const sum = grades.final + grades.assignments + grades.activities + grades.projects + grades.quizzes;
    if (sum !== 100) {
      throw new BadRequestException(`مجموع جميع النسب المئوية للدرجات يجب أن يكون 100 بالضبط. المجموع الحالي: ${sum}`);
    }
  }

  async getMyGradesCriteria(studentId: string, subjectId?: string, academicYearId?: string) {
    const query: any = {};
    if (subjectId) {
      this.validateObjectId(subjectId, 'subject');
      query.subjectId = new mongoose.Types.ObjectId(subjectId);
    }
    if (academicYearId) {
      query.academicYearId = new mongoose.Types.ObjectId(academicYearId);
    }

    const gradesCriteria = await this.gradesCriteriaModel
      .find(query)
      .populate('subjectId', 'subjectName subjectCode')
      .sort({ createdAt: -1 })
      .exec();

    return {
      message: 'تم استرجاع معايير التقييم بنجاح',
      data: gradesCriteria.map(g => transformGradesCriteriaResponse(g)),
    };
  }

  async getMySubjects(studentId: string) {
    const [enrollments, student] = await Promise.all([
      this.enrollmentModel.find({ studentId }).select('classId').exec(),
      this.studentModel.findById(studentId).select('classId').exec(),
    ]);

    const classIdsSet = new Set<string>();
    if (student?.classId) {
      classIdsSet.add(student.classId.toString());
    }
    enrollments.forEach((e) => {
      if (e.classId) {
        classIdsSet.add(e.classId.toString());
      }
    });

    if (classIdsSet.size === 0) {
      return {
        message: 'تم استرجاع المواد بنجاح',
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
        message: 'تم استرجاع المواد بنجاح',
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
        message: 'تم استرجاع المواد بنجاح',
        data: [],
      };
    }

    const subjects = await this.subjectModel.find({ _id: { $in: subjectIds } }).exec();
    return {
      message: 'تم استرجاع المواد بنجاح',
      data: subjects,
    };
  }

  async getMyGrades(studentId: string, subjectId: string) {
    this.validateObjectId(subjectId, 'subject');

    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException('الطالب غير موجود');
    }

    const criteria = await this.gradesCriteriaModel
      .findOne({ subjectId: new mongoose.Types.ObjectId(subjectId) })
      .populate('subjectId', 'subjectName subjectCode')
      .exec();

    if (!criteria) {
      throw new NotFoundException('لا توجد معايير تقييم لهذه المادة');
    }

    const assignmentsCount = criteria.assignmentsCount || 1;
    const quizzesCount = criteria.quizzesCount || 1;
    const projectsCount = criteria.projectsCount || 1;

    const gradePerAssignment = criteria.assignments / assignmentsCount;
    const gradePerQuiz = criteria.quizzes / quizzesCount;
    const gradePerProject = criteria.projects / projectsCount;

    const exams = await this.examModel
      .find({ subjectId })
      .sort({ createdAt: 1 })
      .select('_id examType')
      .exec();

    const examIds = exams.map(e => e._id);
    const results = await this.examResultModel
      .find({ studentId, examId: { $in: examIds } })
      .select('examId achievedGrade')
      .exec();

    const resultMap = new Map(results.map(r => [r.examId.toString(), r.achievedGrade]));
    const byType: Record<string, string[]> = { quiz: [], assignment: [], activity: [], final: [] };
    exams.forEach(e => { if (byType[e.examType]) byType[e.examType].push(e._id.toString()); });

    const gradeFor = (examId: string) => resultMap.get(examId) ?? 0;

    return {
      message: 'تم استرجاع درجات الطالب بنجاح',
      data: {
        subject: criteria.subjectId,
        academicYearId: criteria.academicYearId,
        grades: {
          final: {
            grade: byType.final[0] ? gradeFor(byType.final[0]) : 0,
            total: criteria.final,
          },
          assignments: Array.from({ length: assignmentsCount }, (_, i) => ({
            number: i + 1,
            grade: gradeFor(byType.assignment[i] ?? ''),
            total: gradePerAssignment,
          })),
          quizzes: Array.from({ length: quizzesCount }, (_, i) => ({
            number: i + 1,
            grade: gradeFor(byType.quiz[i] ?? ''),
            total: gradePerQuiz,
          })),
          projects: Array.from({ length: projectsCount }, (_, i) => ({
            number: i + 1,
            grade: gradeFor(byType.project?.[i] ?? ''),
            total: gradePerProject,
          })),
          activities: {
            grade: byType.activity[0] ? gradeFor(byType.activity[0]) : 0,
            total: criteria.activities,
          },
        },
      },
    };
  }

  async create(createGradesCriteriaDto: CreateGradesCriteriaDto) {
    const { subjectId, academicYearId } = createGradesCriteriaDto as any;

    this.validateObjectId(subjectId, 'subject');
    this.validateGradesSum(createGradesCriteriaDto);

    const subject = await this.subjectModel.findById(subjectId);
    if (!subject) {
      throw new NotFoundException(`المادة ذات المعرف ${subjectId} غير موجودة`);
    }

    const existingCriteria = await this.gradesCriteriaModel.findOne({
      subjectId: new mongoose.Types.ObjectId(subjectId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
    });

    if (existingCriteria) {
      throw new BadRequestException(
        `معايير التقييم موجودة بالفعل للمادة ${subject.subjectName} (${subject.subjectCode}) في هذا العام الدراسي`,
      );
    }

    const newGradesCriteria = new this.gradesCriteriaModel({
      ...createGradesCriteriaDto,
      subjectId: new mongoose.Types.ObjectId(subjectId),
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
    });

    await newGradesCriteria.save();
    await newGradesCriteria.populate('subjectId', 'subjectName subjectCode');

    return transformGradesCriteriaResponse(newGradesCriteria);
  }

  async filtering(filters: any, pagination: PaginationDto = {}, user?: any) {
    const query: any = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'subjectId') {
        this.validateObjectId(stringValue, 'subject');
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else if (key === 'academicYearId') {
        this.validateObjectId(stringValue, 'academicYear');
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else if (['final', 'assignments', 'activities', 'projects', 'quizzes'].includes(key)) {
        query[key] = Number(stringValue);
      } else {
        query[key] = stringValue;
      }
    }

    const total = await this.gradesCriteriaModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let gradesCriteriaQuery = this.gradesCriteriaModel
      .find(query).sort({ createdAt: -1 })
      .populate('subjectId', 'subjectName subjectCode');

    if (isPaginationRequested) {
      gradesCriteriaQuery = gradesCriteriaQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const gradesCriteria = await gradesCriteriaQuery.exec();

    if (isPaginationRequested) {
      return {
        data: gradesCriteria.map(grade => transformGradesCriteriaResponse(grade)),
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return gradesCriteria.map(grade => transformGradesCriteriaResponse(grade));
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'gradesCriteria');
    const data = await this.gradesCriteriaModel
      .findById(id)
      .populate('subjectId', 'subjectName subjectCode');
    if (!data) {
      throw new NotFoundException(`معايير التقييم ذات المعرف ${id} غير موجودة`);
    }
    return transformGradesCriteriaResponse(data);
  }

  async update(id: string, updateGradesCriteriaDto: UpdateGradesCriteriaDto) {
    this.validateObjectId(id, 'gradesCriteria');

    const existingGradesCriteria = await this.gradesCriteriaModel.findById(id);
    if (!existingGradesCriteria) {
      throw new NotFoundException(`معايير التقييم ذات المعرف ${id} غير موجودة`);
    }

    if (updateGradesCriteriaDto.subjectId) {
      this.validateObjectId(updateGradesCriteriaDto.subjectId, 'subject');
      const subject = await this.subjectModel.findById(updateGradesCriteriaDto.subjectId);
      if (!subject) {
        throw new NotFoundException(`المادة ذات المعرف ${updateGradesCriteriaDto.subjectId} غير موجودة`);
      }
    }

    const mergedData = {
      final: updateGradesCriteriaDto.final ?? existingGradesCriteria.final,
      assignments: updateGradesCriteriaDto.assignments ?? existingGradesCriteria.assignments,
      activities: updateGradesCriteriaDto.activities ?? existingGradesCriteria.activities,
      projects: updateGradesCriteriaDto.projects ?? existingGradesCriteria.projects,
      quizzes: updateGradesCriteriaDto.quizzes ?? existingGradesCriteria.quizzes,
    };

    this.validateGradesSum(mergedData);

    const updatedGradesCriteria = await this.gradesCriteriaModel.findByIdAndUpdate(
      id,
      updateGradesCriteriaDto,
      { new: true, runValidators: true },
    ).populate('subjectId', 'subjectName subjectCode');

    return transformGradesCriteriaResponse(updatedGradesCriteria);
  }

  async remove(id: string) {
    this.validateObjectId(id, 'gradesCriteria');

    const result = await this.gradesCriteriaModel.findById(id);
    if (!result) {
      throw new NotFoundException(`معايير التقييم ذات المعرف ${id} غير موجودة`);
    }

    const exams = await this.examModel.find({ gradesCriteriaId: id }).select('_id').exec();
    const projects = await this.projectModel.find({ gradesCriteriaId: id }).select('_id').exec();

    const examIds = exams.map(e => e._id);
    const projectIds = projects.map(p => p._id);

    if (examIds.length > 0) {
      await this.examResultModel.deleteMany({ examId: { $in: examIds } });
    }
    if (projectIds.length > 0) {
      await this.submissionModel.deleteMany({ projectId: { $in: projectIds } });
    }

    await this.examModel.deleteMany({ gradesCriteriaId: id });
    await this.projectModel.deleteMany({ gradesCriteriaId: id });

    await this.gradesCriteriaModel.findByIdAndDelete(id);

    return {
      message: `تم حذف معايير التقييم ذات المعرف ${id} بنجاح`,
      data: result,
    };
  }
}
