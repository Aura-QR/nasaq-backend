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


  async getMyGradesCriteria(studentId: string, subjectId?: string, academicYear?: string) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    if (!student.classId) {
      return { message: 'الطالب غير مسجل في أي فصل', data: [] };
    }

    const classData = await this.classModel.findById(student.classId);
    if (!classData || !classData.subjectIds?.length) {
      return { message: 'لا توجد مواد مرتبطة بفصل الطالب', data: [] };
    }

    const query: any = { subjectId: { $in: classData.subjectIds } };

    if (subjectId) {
      this.validateObjectId(subjectId, 'subject');
      query.subjectId = new mongoose.Types.ObjectId(subjectId);
    }

    if (academicYear) {
      query.academicYear = academicYear;
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
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException('الطالب غير موجود');
    }

    if (!student.classId) {
      return { message: 'الطالب غير مسجل في أي فصل', data: [] };
    }

    const classData = await this.classModel
      .findById(student.classId)
      .populate('subjectIds', 'subjectName subjectCode')
      .exec();

    if (!classData || !classData.subjectIds?.length) {
      return { message: 'لا توجد مواد في فصل الطالب', data: [] };
    }

    return {
      message: 'تم استرجاع مواد الطالب بنجاح',
      data: classData.subjectIds,
    };
  }

  async getMyGrades(studentId: string, subjectId: string) {
    this.validateObjectId(subjectId, 'subject');

    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException('الطالب غير موجود');
    }

    if (!student.classId) {
      throw new BadRequestException('الطالب غير مسجل في أي فصل');
    }

    const classData = await this.classModel.findById(student.classId).exec();
    if (!classData) {
      throw new NotFoundException('فصل الطالب غير موجود');
    }

    const subjectInClass = classData.subjectIds.some(
      (id) => id.toString() === subjectId,
    );
    if (!subjectInClass) {
      throw new BadRequestException('هذه المادة غير مرتبطة بفصل الطالب');
    }

    const criteria = await this.gradesCriteriaModel
      .findOne({ subjectId, academicYear: classData.academicYear })
      .populate('subjectId', 'subjectName subjectCode')
      .exec();

    if (!criteria) {
      throw new NotFoundException('لا توجد معايير تقييم لهذه المادة في العام الدراسي الحالي');
    }

    const assignmentsCount = criteria.assignmentsCount || 1;
    const quizzesCount = criteria.quizzesCount || 1;
    const projectsCount = criteria.projectsCount || 1;

    const gradePerAssignment = criteria.assignments / assignmentsCount;
    const gradePerQuiz = criteria.quizzes / quizzesCount;
    const gradePerProject = criteria.projects / projectsCount;

    // Fetch all exams for this subject + class, sorted by creation date
    const exams = await this.examModel
      .find({ subjectId, classIds: { $in: [student.classId] } })
      .sort({ createdAt: 1 })
      .select('_id examType')
      .exec();

    const examIds = exams.map(e => e._id);

    // Fetch all results this student has for those exams
    const results = await this.examResultModel
      .find({ studentId, examId: { $in: examIds } })
      .select('examId achievedGrade')
      .exec();

    // Map examId -> achievedGrade for quick lookup
    const resultMap = new Map(results.map(r => [r.examId.toString(), r.achievedGrade]));

    // Group exams by type in order → determines numbering (quiz 1, quiz 2 ...)
    const byType: Record<string, string[]> = { quiz: [], assignment: [], activity: [], final: [] };
    exams.forEach(e => { if (byType[e.examType]) byType[e.examType].push(e._id.toString()); });

    const gradeFor = (examId: string) => resultMap.get(examId) ?? 0;

    return {
      message: 'تم استرجاع درجات الطالب بنجاح',
      data: {
        subject: criteria.subjectId,
        academicYear: criteria.academicYear,
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
    const {subjectId, academicYear} = createGradesCriteriaDto;

    this.validateObjectId(subjectId, 'subject');
    this.validateGradesSum(createGradesCriteriaDto);

    const subject = await this.subjectModel.findById(subjectId);

    if (!subject) {
      throw new NotFoundException(`المادة ذات المعرف ${subjectId} غير موجودة`);
    }


    const existingCriteria = await this.gradesCriteriaModel.findOne({
      subjectId: subjectId,
      academicYear: academicYear
    });

    if (existingCriteria) {
      throw new BadRequestException(
        `معايير التقييم موجودة بالفعل للمادة ${subject.subjectName} (${subject.subjectCode}) في العام الدراسي ${academicYear}`
      );
    }

    const newGradesCriteria = new this.gradesCriteriaModel({
      ...createGradesCriteriaDto,
      subjectId: subjectId,
    });

    await newGradesCriteria.save();
    await newGradesCriteria.populate('subjectId', 'subjectName subjectCode');

    return transformGradesCriteriaResponse(newGradesCriteria);
  }

  async filtering(filters: any, pagination: PaginationDto = {}, user?: any) {
    const query: any = {};

    const exactMatchFields = ['academicYear'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'subjectId') {
        this.validateObjectId(stringValue, 'subject');
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else if (key === 'final' || key === 'assignments' || key === 'activities' || key === 'projects' || key === 'quizzes') {
        query[key] = Number(stringValue);
      } else if (exactMatchFields.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }

    if (user?.role === 'TEACHER') {
      const teacher = await this.teacherModel.findById(user.userId).select('subjectIds').lean();
      let teacherSubjectIds = (teacher?.subjectIds ?? []).map((id: any) => id.toString());

      // Fallback for older data where teacher-subject links may exist only in lectures.
      if (teacherSubjectIds.length === 0) {
        const lectureSubjectIds = await this.tLectureModel
          .distinct('subjectId', { teacherId: new mongoose.Types.ObjectId(user.userId) });
        teacherSubjectIds = lectureSubjectIds.map((id: any) => id.toString());
      }

      if (teacherSubjectIds.length > 0) {
        if (query.subjectId instanceof mongoose.Types.ObjectId) {
          const requestedSubjectId = query.subjectId.toString();
          query.subjectId = teacherSubjectIds.includes(requestedSubjectId)
            ? query.subjectId
            : null;
        } else {
          query.subjectId = {
            $in: teacherSubjectIds.map((id) => new mongoose.Types.ObjectId(id)),
          };
        }
      } else {
        query.subjectId = null;
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
        totalPages: paginationMeta.totalPages
      };
    }

    return gradesCriteria.map(grade => transformGradesCriteriaResponse(grade));
  }

  async findOne(id: string){
    this.validateObjectId(id, 'gradesCriteria');
    const data = await this.gradesCriteriaModel
      .findById(id)
      .populate('subjectId', 'subjectName subjectCode');
      if(!data){
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
      { new: true, runValidators: true }
    )
    .populate('subjectId', 'subjectName subjectCode');

    return transformGradesCriteriaResponse(updatedGradesCriteria);
  }

  async remove(id: string) {
    this.validateObjectId(id, 'gradesCriteria');

    const result = await this.gradesCriteriaModel.findById(id);
    if (!result) {
      throw new NotFoundException(`معايير التقييم ذات المعرف ${id} غير موجودة`);
    }

    // Collect exam and project IDs before deleting so we can clean up their results
    const exams = await this.examModel.find({ gradesCriteriaId: id }).select('_id').exec();
    const projects = await this.projectModel.find({ gradesCriteriaId: id }).select('_id').exec();

    const examIds = exams.map(e => e._id);
    const projectIds = projects.map(p => p._id);

    // Delete grade results tied to those exams and projects
    if (examIds.length > 0) {
      await this.examResultModel.deleteMany({ examId: { $in: examIds } });
    }
    if (projectIds.length > 0) {
      await this.submissionModel.deleteMany({ projectId: { $in: projectIds } });
    }

    // Cascade delete exams and projects
    await this.examModel.deleteMany({ gradesCriteriaId: id });
    await this.projectModel.deleteMany({ gradesCriteriaId: id });

    await this.gradesCriteriaModel.findByIdAndDelete(id);

    return {
      message: `تم حذف معايير التقييم ذات المعرف ${id} بنجاح (بما في ذلك الامتحانات والمشاريع ونتائجها المرتبطة)`,
      data: result
    };
  }
}
