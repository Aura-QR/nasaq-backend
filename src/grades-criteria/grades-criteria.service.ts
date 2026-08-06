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
import { Term } from '../terms/schemas/term.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';

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
    @InjectModel(Term.name) private termModel: Model<Term>,
    @InjectModel(School.name) private schoolModel: Model<School>,
    private tenantContext: TenantContextService,
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

  private getPopulateOptions() {
    return {
      path: 'subjectOfferingId',
      populate: [
        { path: 'subjectId', select: 'subjectName subjectCode' },
        { path: 'gradeLevelId', select: 'name order' },
        { path: 'termId', select: 'name status order' },
      ],
    };
  }

  async getMyGradesCriteria(studentId: string, subjectOfferingId?: string, subjectId?: string) {
    const query: any = {};
    if (subjectOfferingId) {
      this.validateObjectId(subjectOfferingId, 'subjectOffering');
      query.subjectOfferingId = new mongoose.Types.ObjectId(subjectOfferingId);
    } else if (subjectId) {
      this.validateObjectId(subjectId, 'subject');
      const offerings = await this.subjectOfferingModel.find({ subjectId }).select('_id');
      const offeringIds = offerings.map((o) => o._id);
      query.subjectOfferingId = { $in: offeringIds };
    }

    const gradesCriteria = await this.gradesCriteriaModel
      .find(query)
      .populate(this.getPopulateOptions())
      .sort({ createdAt: -1 })
      .exec();

    return {
      message: 'تم استرجاع معايير التقييم بنجاح',
      data: gradesCriteria.map((g) => transformGradesCriteriaResponse(g)),
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
      .populate('subjectId')
      .exec();

    return {
      message: 'تم استرجاع المواد بنجاح',
      data: offerings,
    };
  }

  async getMyGrades(studentId: string, subjectOfferingId?: string, subjectId?: string) {
    let targetOfferingId = subjectOfferingId;

    if (!targetOfferingId && subjectId) {
      this.validateObjectId(subjectId, 'subject');
      const offering = await this.subjectOfferingModel.findOne({ subjectId });
      if (offering) {
        targetOfferingId = offering._id.toString();
      }
    }

    if (!targetOfferingId) {
      throw new BadRequestException('يرجى تحديد عرض المادة subjectOfferingId');
    }

    this.validateObjectId(targetOfferingId, 'subjectOffering');

    const criteria = await this.gradesCriteriaModel
      .findOne({ subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) })
      .populate(this.getPopulateOptions())
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

    const offeringObj = criteria.subjectOfferingId as any;
    const sId = offeringObj?.subjectId?._id ?? offeringObj?.subjectId;

    const exams = await this.examModel
      .find({
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) },
          { gradesCriteriaId: criteria._id },
          ...(sId ? [{ subjectId: sId }] : []),
        ],
      })
      .sort({ createdAt: 1 })
      .select('_id examType')
      .exec();

    const examIds = exams.map((e) => e._id);
    const results = await this.examResultModel
      .find({ studentId: new mongoose.Types.ObjectId(studentId), examId: { $in: examIds } })
      .select('examId achievedGrade')
      .exec();

    const resultMap = new Map(results.map((r) => [r.examId.toString(), r.achievedGrade]));
    const byType: Record<string, string[]> = { quiz: [], assignment: [], activity: [], final: [] };
    exams.forEach((e) => {
      if (byType[e.examType]) byType[e.examType].push(e._id.toString());
    });

    const gradeFor = (examId: string) => resultMap.get(examId) ?? 0;

    const projects = await this.projectModel
      .find({
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) },
          { gradesCriteriaId: criteria._id },
        ],
      })
      .sort({ createdAt: 1 })
      .select('_id')
      .exec();

    const projectIds = projects.map((p) => p._id);
    const projectSubmissions = await this.submissionModel
      .find({ studentId: new mongoose.Types.ObjectId(studentId), projectId: { $in: projectIds } })
      .select('projectId achievedGrade')
      .exec();

    const projectResultMap = new Map(
      projectSubmissions.map((s) => [s.projectId.toString(), s.achievedGrade]),
    );
    const projectGradeFor = (projectId: string) => projectResultMap.get(projectId) ?? 0;

    return {
      message: 'تم استرجاع درجات الطالب بنجاح',
      data: {
        subjectOffering: criteria.subjectOfferingId,
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
            grade: projects[i] ? projectGradeFor(projects[i]._id.toString()) : 0,
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

  async calculateStudentTermGrade(studentId: string, targetOfferingId: string) {
    const criteria = await this.gradesCriteriaModel
      .findOne({ subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) })
      .exec();

    if (!criteria) {
      return { finalGrade: 0, passingGrade: undefined };
    }

    const assignmentsCount = criteria.assignmentsCount || 1;
    const quizzesCount = criteria.quizzesCount || 1;
    const projectsCount = criteria.projectsCount || 1;

    const offeringObj = criteria.subjectOfferingId as any;
    const sId = offeringObj?.subjectId?._id ?? offeringObj?.subjectId;

    const exams = await this.examModel
      .find({
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) },
          { gradesCriteriaId: criteria._id },
          ...(sId ? [{ subjectId: sId }] : []),
        ],
      })
      .sort({ createdAt: 1 })
      .select('_id examType')
      .exec();

    const examIds = exams.map((e) => e._id);
    const results = await this.examResultModel
      .find({ studentId: new mongoose.Types.ObjectId(studentId), examId: { $in: examIds } })
      .select('examId achievedGrade')
      .exec();

    const resultMap = new Map(results.map((r) => [r.examId.toString(), r.achievedGrade]));
    const byType: Record<string, string[]> = { quiz: [], assignment: [], activity: [], final: [] };
    exams.forEach((e) => {
      if (byType[e.examType]) byType[e.examType].push(e._id.toString());
    });

    const gradeFor = (examId: string) => resultMap.get(examId) ?? 0;

    const projects = await this.projectModel
      .find({
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(targetOfferingId) },
          { gradesCriteriaId: criteria._id },
        ],
      })
      .sort({ createdAt: 1 })
      .select('_id')
      .exec();

    const projectIds = projects.map((p) => p._id);
    const projectSubmissions = await this.submissionModel
      .find({ studentId: new mongoose.Types.ObjectId(studentId), projectId: { $in: projectIds } })
      .select('projectId achievedGrade')
      .exec();

    const projectResultMap = new Map(
      projectSubmissions.map((s) => [s.projectId.toString(), s.achievedGrade]),
    );
    const projectGradeFor = (projectId: string) => projectResultMap.get(projectId) ?? 0;

    const finalScore = byType.final[0] ? gradeFor(byType.final[0]) : 0;
    const activityScore = byType.activity[0] ? gradeFor(byType.activity[0]) : 0;

    let assignmentsScore = 0;
    for (let i = 0; i < assignmentsCount; i++) {
      assignmentsScore += gradeFor(byType.assignment[i] ?? '');
    }

    let quizzesScore = 0;
    for (let i = 0; i < quizzesCount; i++) {
      quizzesScore += gradeFor(byType.quiz[i] ?? '');
    }

    let projectsScore = 0;
    for (let i = 0; i < projectsCount; i++) {
      if (projects[i]) {
        projectsScore += projectGradeFor(projects[i]._id.toString());
      }
    }

    const termFinalGrade = finalScore + activityScore + assignmentsScore + quizzesScore + projectsScore;

    return {
      finalGrade: termFinalGrade,
      passingGrade: criteria.passingGrade,
    };
  }

  async calculateStudentYearlySubjectResults(
    studentId: string,
    gradeLevelId: string,
    academicYearId: string,
  ) {
    const terms = await this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(academicYearId) })
      .sort({ order: 1 })
      .exec();

    const termIds = terms.map((t) => t._id);
    const termOrderMap = new Map(terms.map((t) => [t._id.toString(), t.order]));

    const schoolId = this.tenantContext.getSchoolId();
    let defaultPassingGrade = 50;
    if (schoolId) {
      const school = await this.schoolModel.findById(schoolId).select('settings').exec();
      if (school?.settings?.defaultPassingGrade !== undefined) {
        defaultPassingGrade = school.settings.defaultPassingGrade;
      }
    }

    const offerings = await this.subjectOfferingModel
      .find({
        gradeLevelId: new mongoose.Types.ObjectId(gradeLevelId),
        termId: { $in: termIds },
      })
      .populate('subjectId')
      .exec();

    const offeringsBySubject = new Map<string, { offering: SubjectOffering; termOrder: number }[]>();
    for (const offering of offerings) {
      if (!offering.subjectId) continue;
      const sId = (offering.subjectId as any)._id?.toString() ?? offering.subjectId.toString();
      const termOrder = termOrderMap.get(offering.termId.toString()) ?? 0;
      if (!offeringsBySubject.has(sId)) {
        offeringsBySubject.set(sId, []);
      }
      offeringsBySubject.get(sId)!.push({ offering, termOrder });
    }

    const subjectResults = [];

    for (const [subjectIdStr, subjectOfferingItems] of offeringsBySubject.entries()) {
      const firstOfferingDoc = subjectOfferingItems[0].offering;
      const subjectDoc = firstOfferingDoc.subjectId as any;
      const subjectName = subjectDoc?.subjectName ?? 'Unknown Subject';
      const isRequiredForPromotion = subjectDoc?.isRequiredForPromotion !== false;

      // Sort by term order descending to resolve passingGrade from the last term in which subject is offered
      subjectOfferingItems.sort((a, b) => b.termOrder - a.termOrder);

      let totalGradeSum = 0;
      let resolvedPassingGrade: number | undefined = undefined;

      for (const item of subjectOfferingItems) {
        const { finalGrade, passingGrade } = await this.calculateStudentTermGrade(
          studentId,
          item.offering._id.toString(),
        );
        totalGradeSum += finalGrade;
        if (resolvedPassingGrade === undefined && passingGrade !== undefined && passingGrade !== null) {
          resolvedPassingGrade = passingGrade;
        }
      }

      const N = subjectOfferingItems.length;
      const yearlyFinalGrade = N > 0 ? totalGradeSum / N : 0;
      const finalPassingGrade = resolvedPassingGrade ?? defaultPassingGrade;
      const passed = yearlyFinalGrade >= finalPassingGrade;

      subjectResults.push({
        subjectId: subjectIdStr,
        subjectName,
        finalGrade: Math.round(yearlyFinalGrade * 100) / 100,
        passingGrade: finalPassingGrade,
        passed,
        isRequiredForPromotion,
      });
    }

    return subjectResults;
  }

  async create(createGradesCriteriaDto: CreateGradesCriteriaDto) {
    let { subjectOfferingId } = createGradesCriteriaDto;
    const { subjectId } = createGradesCriteriaDto as any;

    if (!subjectOfferingId && subjectId) {
      this.validateObjectId(subjectId, 'subject');
      const offering = await this.subjectOfferingModel.findOne({
        subjectId: new mongoose.Types.ObjectId(subjectId),
      });
      if (!offering) {
        throw new NotFoundException(`لم يتم العثور على عرض لهذه المادة (SubjectOffering) للمادة ${subjectId}`);
      }
      subjectOfferingId = offering._id.toString();
    }

    if (!subjectOfferingId) {
      throw new BadRequestException('يرجى تحديد subjectOfferingId أو subjectId لإنشاء معايير التقييم');
    }

    this.validateObjectId(subjectOfferingId, 'subjectOffering');
    this.validateGradesSum(createGradesCriteriaDto);

    const offering = await this.subjectOfferingModel.findById(subjectOfferingId);
    if (!offering) {
      throw new NotFoundException(`عرض المادة (SubjectOffering) ذات المعرف ${subjectOfferingId} غير موجود`);
    }

    const existingCriteria = await this.gradesCriteriaModel.findOne({
      subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
    });

    if (existingCriteria) {
      throw new BadRequestException(`معايير التقييم موجودة بالفعل لعرض المادة هذا`);
    }

    const newGradesCriteria = new this.gradesCriteriaModel({
      ...createGradesCriteriaDto,
      subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
    });

    await newGradesCriteria.save();
    await newGradesCriteria.populate(this.getPopulateOptions());

    return transformGradesCriteriaResponse(newGradesCriteria);
  }

  async filtering(filters: any, pagination: PaginationDto = {}, user?: any) {
    const query: any = {};

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (key === 'subjectOfferingId') {
        this.validateObjectId(stringValue, 'subjectOffering');
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
      .find(query)
      .sort({ createdAt: -1 })
      .populate(this.getPopulateOptions());

    if (isPaginationRequested) {
      gradesCriteriaQuery = gradesCriteriaQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const gradesCriteria = await gradesCriteriaQuery.exec();

    if (isPaginationRequested) {
      return {
        data: gradesCriteria.map((grade) => transformGradesCriteriaResponse(grade)),
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return gradesCriteria.map((grade) => transformGradesCriteriaResponse(grade));
  }

  async findOne(id: string) {
    this.validateObjectId(id, 'gradesCriteria');
    const data = await this.gradesCriteriaModel
      .findById(id)
      .populate(this.getPopulateOptions());
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

    if (updateGradesCriteriaDto.subjectOfferingId) {
      this.validateObjectId(updateGradesCriteriaDto.subjectOfferingId, 'subjectOffering');
      const offering = await this.subjectOfferingModel.findById(updateGradesCriteriaDto.subjectOfferingId);
      if (!offering) {
        throw new NotFoundException(`عرض المادة (SubjectOffering) ذات المعرف ${updateGradesCriteriaDto.subjectOfferingId} غير موجود`);
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

    const updatedGradesCriteria = await this.gradesCriteriaModel
      .findByIdAndUpdate(id, updateGradesCriteriaDto, { new: true, runValidators: true })
      .populate(this.getPopulateOptions());

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

    const examIds = exams.map((e) => e._id);
    const projectIds = projects.map((p) => p._id);

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
