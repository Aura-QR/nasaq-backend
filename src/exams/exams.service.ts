import { Injectable, Logger, Optional, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { QuestionDto } from './dto/create-exam.dto';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { Exam } from './schemas/exam.schema';
import { ExamResult } from './schemas/exam-result.schema';
import { GradesCriteria } from '../grades-criteria/schemas/grades-criteria.schema';
import { Class } from '../classes/schemas/class.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Student } from '../students/schemas/student.schema';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { transformExamResponse } from './transforms/response.transform';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { getPagination } from '../pagination/common/paginationUtils';
import { StudentClassResolverService } from '../enrollments/student-class-resolver.service';
import { AcademicYear } from '../academic-years/schemas/academic-year.schema';
import { loadCurrentOffering } from '../subject-offerings/current-offering.util';
import { scopedOfferingIds } from '../terms/current-scope.util';
import { gradingSystemOf } from '../grade-register/grading-system.util';
import { DEFAULT_EXAM_GRADE, EXAM_PART, resolveAssessmentType } from '../grade-register/ministry-template';
import { NotificationsService } from '../notifications/notifications.service';
import { ReviewExamDto } from './dto/review-exam.dto';
import { CreateMakeupExamDto } from './dto/makeup-exam.dto';
import { Attendance } from '../attendance/schemas/attendance.schema';
import {
  allMarksSet,
  assertMarksConsistent,
  effectiveMarks,
  isQuarter,
  markPaper as markAnswers,
  normalizeQuestion,
  presentAnswers,
  round2,
  scorePaper,
  studentQuestion,
} from './question-rules.util';

/** Who may mark essays besides the subject's teacher. */
const REVIEW_ADMIN_ROLES = ['OWNER', 'SUPERVISOR', 'MANAGER', 'SUPER_ADMIN'];

/** An essay answer still waiting for the teacher. Old rows have no type, so never. */
const isPendingEssay = (a: any) => a?.type === 'essay' && (a.earned === null || a.earned === undefined);

/**
 * Minutes a submission may arrive after the student's time or the exam's
 * window ran out. The app submits on its own when the timer reaches zero, and
 * that request lands a second or two late; refusing it handed the student a
 * zero for a paper she finished on time.
 */
const SUBMIT_GRACE_MINUTES = 2;

@Injectable()
export class ExamsService {
   private static readonly CLASS_FIELDS_GENDER = 'roomNumber academicYear gender';
   private static readonly GRADES_CRITERIA_POPULATE = {
     path: 'gradesCriteriaId',
     populate: {
       path: 'subjectOfferingId',
       populate: { path: 'subjectId', select: 'subjectCode subjectName' },
     },
   };
   private static readonly SUBJECT_OFFERING_POPULATE = {
     path: 'subjectOfferingId',
     populate: [
       { path: 'subjectId', select: 'subjectCode subjectName' },
       { path: 'termId', select: 'name startDate endDate' },
       { path: 'gradeLevelId', select: 'name' },
     ],
   };
   private static readonly TEACHER_FIELDS = 'name email';
  constructor(
    @InjectModel(Exam.name) private examModel: Model<Exam>,
    @InjectModel(GradesCriteria.name) private gradesCriteriaModel: Model<GradesCriteria>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(Lecture.name) private lectureModel: Model<Lecture>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(ExamResult.name) private examResultModel: Model<ExamResult>,
    @InjectModel(Enrollment.name) private enrollmentModel: Model<Enrollment>,
    @InjectModel(SubjectOffering.name) private subjectOfferingModel: Model<SubjectOffering>,
    private readonly studentClassResolver: StudentClassResolverService,
    @Optional()
    @InjectModel(AcademicYear.name)
    private readonly academicYearModel?: Model<AcademicYear>,
    // exam_graded, when the teacher finishes marking a paper. Optional so a
    // hand-built service in a unit test still works.
    @Optional()
    private readonly notifications?: NotificationsService,
    // Student absence rows: labels makeup candidates «غياب بعذر» or not.
    @Optional()
    @InjectModel(Attendance.name)
    private readonly attendanceModel?: Model<Attendance>,
  ) {}

  /**
   * The stored questions, each checked against its type, and the marks
   * either on every question or on none. 400s name the question by number.
   */
  private normalizeQuestions(questions: any[]): any[] {
    const normalized = (questions ?? []).map((q, i) => normalizeQuestion(q, `السؤال ${i + 1}`));
    assertMarksConsistent(normalized);
    return normalized;
  }

  private validateObjectId(id: string, entityName: string): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`صيغة معرف ${entityName} غير صحيحة`);
    }
  }

  /**
   * Verify that a teacher teaches the specified classes with the given subject offering
   */
  private async verifyTeacherClassAccess(
    teacherId: string,
    classIds: string[],
    subjectOfferingId: string,
  ): Promise<void> {
    const lectures = await this.lectureModel
      .find({
        teacherId: new mongoose.Types.ObjectId(teacherId),
        subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
      })
      .select('classId')
      .exec();

    const teacherClassIds = lectures
      .map((lecture: any) => lecture.classId?.toString())
      .filter(Boolean);

    const unauthorizedClasses = classIds.filter(
      (classId) => !teacherClassIds.includes(classId),
    );

    if (unauthorizedClasses.length > 0) {
      // Names, not ids: the teacher reads this message.
      const named = await this.classModel
        .find({ _id: { $in: unauthorizedClasses.filter((id) => mongoose.Types.ObjectId.isValid(id)) } })
        .select('name')
        .lean()
        .exec();
      const names = unauthorizedClasses.map(
        (id) => (named as any[]).find((c) => String(c._id) === id)?.name ?? 'فصل غير معروف',
      );
      throw new ForbiddenException(
        `ليس لديك صلاحية لإنشاء اختبار للفصول: ${names.join('، ')}. يمكنك الإنشاء فقط للفصول التي تدرّس فيها هذه المادة.`,
      );
    }
  }

  /**
   * The classes a final is set for: every class of the grade, that year.
   *
   * One final per subject, per grade, per term — the same paper for every
   * section, or the marks that decide promotion are not comparable. Any
   * teacher who teaches the subject in that grade may set it; it is not
   * hers alone, and it reaches the classes of the other teachers too.
   */
  private async finalExamClassIds(teacherId: string, subjectOfferingId: string): Promise<string[]> {
    const offering = await this.subjectOfferingModel
      .findById(subjectOfferingId)
      .populate('termId', 'academicYearId')
      .exec();
    if (!offering) {
      throw new NotFoundException('المادة غير موجودة في هذا الصف والفصل الدراسي');
    }
    if (!(await this.teachesOffering(teacherId, offering._id))) {
      throw new ForbiddenException('يمكن إعداد الامتحان النهائي لمادة تدرّسها في هذا الصف فقط');
    }
    const yearId = (offering.termId as any)?.academicYearId;
    const classes = await this.classModel
      .find({
        gradeLevelId: offering.gradeLevelId,
        ...(yearId ? { academicYearId: yearId } : {}),
        isActive: { $ne: false },
      })
      .select('_id')
      .exec();
    if (!classes.length) {
      throw new BadRequestException('لا توجد فصول في هذا الصف');
    }
    return classes.map((c) => String(c._id));
  }

  private async teachesOffering(teacherId: string, subjectOfferingId: any): Promise<boolean> {
    return !!(await this.lectureModel.exists({
      teacherId: new mongoose.Types.ObjectId(String(teacherId)),
      subjectOfferingId: new mongoose.Types.ObjectId(String(subjectOfferingId)),
    }));
  }

  /**
   * A teacher changes an exam she set — or the grade's final, which belongs
   * to every teacher of the subject in that grade. Other roles keep what
   * their permissions grant.
   */
  private async assertTeacherMayManage(exam: Exam, user: any): Promise<void> {
    if (user?.role !== 'TEACHER') return;
    if (String(exam.createdBy) === String(user.userId)) return;
    if (exam.examType === 'final' && (await this.teachesOffering(user.userId, exam.subjectOfferingId))) {
      return;
    }
    throw new ForbiddenException('يمكنك تعديل الامتحانات التي أعددتها فقط');
  }

  async create(createExamDto: CreateExamDto, user: any, generatedFromPreparation?: string) {

    const { subjectOfferingId, examType, startDate, endDate, duration } = createExamDto;
    let { classIds } = createExamDto;

    if (new Date(endDate) <= new Date(startDate)) {
      throw new BadRequestException('تاريخ انتهاء الامتحان يجب أن يكون بعد تاريخ البداية');
    }

    if (!createExamDto.questions || createExamDto.questions.length === 0) {
      throw new BadRequestException('يجب أن يحتوي الامتحان على سؤال واحد على الأقل');
    }

    // Each question against its type; true/false gets its two fixed options.
    const questions = this.normalizeQuestions(createExamDto.questions);

    this.validateObjectId(subjectOfferingId, 'subjectOffering');

    // Exams are set by the teacher who gives them. This is enforced here rather
    // than through permissions because OWNER and SUPERVISOR log in with ['*'],
    // which CASL expands to can('manage','all') — it bypasses every
    // @CheckAbilities, so the stored `exams.add: false` on those roles never
    // takes effect.
    //
    // It is also what keeps createdBy honest: the field is declared
    // ref: 'Teacher', so an admin-authored exam stored an id that resolves to
    // nothing — every populate returned null and the exam never appeared in
    // GET /exams/teacher/me for the teacher who actually gives it.
    if (user?.role !== 'TEACHER') {
      throw new ForbiddenException(
        'إنشاء الامتحانات متاح للمعلمين فقط — الامتحان يُنسب للمعلم الذي يقوم بتدريس الحصة',
      );
    }

    await loadCurrentOffering(this.subjectOfferingModel, this.academicYearModel, subjectOfferingId);

    if (examType === 'final') {
      // Whatever classes were picked, the final is the whole grade's.
      classIds = await this.finalExamClassIds(user.userId, subjectOfferingId);
    } else {
      // Verify the teacher actually teaches these classes with this subject offering
      await this.verifyTeacherClassAccess(
        user.userId,
        classIds,
        subjectOfferingId,
      );
    }

    if (generatedFromPreparation) {
      this.validateObjectId(generatedFromPreparation, 'preparation');
      const existing = await this.examModel.findOne({ generatedFromPreparation }).exec();
      if (existing) {
        if (String(existing.createdBy) !== String(user.userId) ||
            String(existing.subjectOfferingId) !== subjectOfferingId ||
            !classIds.every((id) => existing.classIds.some((c) => String(c) === id))) {
          throw new ForbiddenException('الامتحان المولّد لا يطابق المعلم أو مادة وفصل التحضير');
        }
        return transformExamResponse(existing);
      }
    }

    for (const classId of classIds) {
      this.validateObjectId(classId, 'class');
      const classExists = await this.classModel.findById(classId);
      if (!classExists) {
        throw new NotFoundException(`الفصل ذو المعرف ${classId} غير موجود`);
      }
    }

    const offering: any = await this.subjectOfferingModel
      .findById(subjectOfferingId)
      .populate('subjectId', 'assessmentType')
      .lean()
      .exec();
    const ministry = (await gradingSystemOf(this.examModel.db)) === 'ministry';

    let gradesCriteria: GradesCriteria | null = null;
    let calculatedGrade: number;
    if (ministry) {
      // The ministry template has no «معايير الدرجات»: an exam is out of what
      // the teacher sets (or a default), and the annual register turns it
      // into its part. No count limit — every quiz counts.
      const assessment = resolveAssessmentType(offering);
      if (examType === 'final' && assessment !== 'final_exam') {
        throw new BadRequestException(
          assessment === 'continuous'
            ? 'هذه المادة تقويم مستمر ولا يوجد لها اختبار نهاية فترة'
            : 'لم يُحدَّد نوع التقويم لهذه المادة؛ يحدده مالك المدرسة (مستمر أو ختامي)',
        );
      }
      if (!EXAM_PART[examType]) {
        throw new BadRequestException(`نوع الامتحان '${examType}' غير مستخدم في نظام درجات الوزارة`);
      }
      calculatedGrade =
        createExamDto.grade ?? (examType === 'final' ? DEFAULT_EXAM_GRADE.final : DEFAULT_EXAM_GRADE.other);
    } else {
      gradesCriteria = await this.gradesCriteriaModel.findOne({
        subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
      }).exec();

      // This used to invent a criteria (40/20/10/15/15) and persist it whenever a
      // teacher created the first exam for a subject that had none. That silently
      // handed the weight distribution — school policy — to whichever teacher
      // happened to act first, and it stayed the subject's official distribution
      // for the rest of the year with the admin never asked and never told.
      //
      // It also reopened the hole that @CheckAbilities on POST /gradesCriteria
      // closes: locking the front door means nothing while this writes the same
      // document through a side one. Refuse, and name what is missing.
      if (!gradesCriteria) {
        throw new BadRequestException(
          'لا يوجد توزيع درجات لهذه المادة. يجب على إدارة المدرسة تحديد توزيع الدرجات قبل إنشاء الامتحانات.',
        );
      }

      const validExamTypes = {
        final: gradesCriteria.final,
        assignment: gradesCriteria.assignments,
        project: gradesCriteria.projects,
        activity: gradesCriteria.activities,
        quiz: gradesCriteria.quizzes,
      };

      if (!validExamTypes[examType] || validExamTypes[examType] === 0) {
        throw new BadRequestException(
          `نوع الامتحان '${examType}' غير مكون في معايير التقييم (الوزن 0 أو غير محدد)`
        );
      }

      // Auto-calculate grade based on count
      switch (examType) {
        case 'quiz':
          calculatedGrade = gradesCriteria.quizzes / ((gradesCriteria as any).quizzesCount || 1);
          break;
        case 'assignment':
          calculatedGrade = gradesCriteria.assignments / ((gradesCriteria as any).assignmentsCount || 1);
          break;
        case 'activity':
          calculatedGrade = gradesCriteria.activities;
          break;
        case 'final':
          calculatedGrade = gradesCriteria.final;
          break;
        default:
          calculatedGrade = 0;
      }
    }

    if (examType === 'final') {
      const existingExam = await this.examModel.findOne({
        examType: 'final',
        makeupOf: null,
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId) },
          ...(gradesCriteria ? [{ gradesCriteriaId: gradesCriteria._id }] : []),
        ],
      });

      if (existingExam) {
        throw new BadRequestException(
          'يوجد امتحان نهائي لهذه المادة في هذا الصف لهذا الفصل الدراسي، ويمكن لمعلمات المادة تعديله',
        );
      }
    }

    if (gradesCriteria) {
      await this.assertWithinCount(gradesCriteria, subjectOfferingId, examType, classIds);
    }

    const fields = {
       gradesCriteriaId: gradesCriteria?._id ?? null,
       subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
       classIds,
       examType,
       grade: calculatedGrade,
       startDate,
       endDate,
       duration,
       questions,
       createdBy: user.userId,
    };
    // Same creation rules as the dashboard, with an internal idempotency key.
    let exam;
    if (generatedFromPreparation) {
      try {
        exam = await this.examModel.findOneAndUpdate({ generatedFromPreparation },
          { $setOnInsert: { ...fields, generatedFromPreparation } },
          { upsert: true, new: true, runValidators: true }).exec();
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        exam = await this.examModel.findOne({ generatedFromPreparation }).exec();
        if (!exam) throw error;
      }
    } else exam = await this.examModel.create(fields);

    await exam.populate([
      ExamsService.GRADES_CRITERIA_POPULATE,
      { path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER }
    ]);
    return transformExamResponse(exam);
  }


  async getMyExams(studentId: string, filters: any = {}, pagination: PaginationDto = {}) {
    const student = await this.studentModel.findById(studentId).select('classId').exec();

    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    // The student's CURRENT class only. This used to union every enrollment
    // the student had ever had with student.classId, so anyone who had been
    // promoted saw their previous grade's content alongside this year's.
    const classIdsSet = new Set<string>(
      await this.studentClassResolver.resolveClassIds(studentId),
    );

    if (classIdsSet.size === 0) {
      return {
        data: [],
        totalDocs: 0,
        totalPages: 0,
      };
    }

    const studentClassObjectIds = Array.from(classIdsSet).map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const me = new mongoose.Types.ObjectId(String(studentId));
    // Her classes' exams, and only the makeups set for her — a makeup is
    // invisible to the rest of the class.
    const query: any = {
      $or: [
        { classIds: { $in: studentClassObjectIds }, makeupOf: null },
        { makeupOf: { $ne: null }, studentIds: me },
      ],
    };

    const allowedFilters: Record<string, 'string' | 'objectId'> = {
      examType: 'string',
      subjectOfferingId: 'objectId',
      gradesCriteriaId: 'objectId',
    };

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'status') continue;
      if (!(key in allowedFilters)) continue;

      const stringValue = String(value);

      if (allowedFilters[key] === 'objectId') {
        query[key] = new mongoose.Types.ObjectId(stringValue);
      } else {
        query[key] = stringValue;
      }
    }

    const now = new Date();
    if (filters.status === 'upcoming') {
      query.startDate = { $gt: now };
    } else if (filters.status === 'available') {
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    } else if (filters.status === 'expired') {
      query.endDate = { $lt: now };
    }

    const total = await this.examModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let examsQuery = this.examModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate(ExamsService.SUBJECT_OFFERING_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER });

    if (isPaginationRequested) {
      examsQuery = examsQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const exams = await examsQuery.exec();

    const examIds = exams.map(e => e._id);
    const takenResults = await this.examResultModel
      .find({ studentId, examId: { $in: examIds }, submitted: true })
      .select('examId')
      .exec();
    const takenExamIds = new Set(takenResults.map(r => r.examId.toString()));

    // «لديك اختبار بديل» on an original she has a makeup of.
    const originalIds = exams.filter((e: any) => !e.makeupOf).map((e) => e._id);
    const myMakeups: any[] = originalIds.length
      ? await this.examModel
          .find({ makeupOf: { $in: originalIds }, studentIds: me })
          .select('_id makeupOf createdAt')
          .sort({ createdAt: 1 })
          .lean()
          .exec()
      : [];
    const makeupFor = new Map(myMakeups.map((x) => [String(x.makeupOf), String(x._id)]));

    const data = exams.map(e => {
      const base: any = transformExamResponse(e);
      // Who else the makeup is for is not hers to read.
      delete base.studentIds;
      const isMakeup = !!(e as any).makeupOf;
      const start: Date = (e as any).startDate;
      const end: Date = (e as any).endDate;

      let status: 'upcoming' | 'available' | 'expired';
      if (now < start) status = 'upcoming';
      else if (now > end) status = 'expired';
      else status = 'available';

      return {
        ...base,
        // No answer key and no model answer, ever, before the paper is graded.
        questions: this.forStudent(base),
        status,
        hasTaken: takenExamIds.has(e._id.toString()),
        isMakeup,
        makeupOf: isMakeup ? String((e as any).makeupOf) : null,
        makeupExamId: isMakeup ? null : makeupFor.get(String(e._id)) ?? null,
      };
    });

    if (isPaginationRequested) {
      return {
        message: 'تم استرجاع امتحانات الطالب بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return {
      message: 'تم استرجاع امتحانات الطالب بنجاح',
      data,
    };
  }

  async filtering(filters: any, pagination: PaginationDto = {},user : any) {
    const query: any = {};
    // Never a field on the exam: it picks which year's offerings to list.
    const academicYearId = filters.academicYearId;
    delete filters.academicYearId;

    const exactMatchFields = ['examType', 'gradesCriteriaId', 'classIds', 'subjectOfferingId'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (exactMatchFields.includes(key)) {
        if (key === 'classIds') {
          query[key] = { $in: [new mongoose.Types.ObjectId(stringValue)] };
        } else if (key === 'gradesCriteriaId' || key === 'subjectOfferingId') {
          query[key] = new mongoose.Types.ObjectId(stringValue);
        } else {
          query[key] = stringValue;
        }
      } else {
        query[key] = stringValue;
      }
    }
    if (user.role === 'TEACHER') {
      // Her own exams, and the final of every subject she teaches — it is
      // shared with the other teachers of that subject in the grade.
      const offerings = await this.lectureModel
        .distinct('subjectOfferingId', { teacherId: new mongoose.Types.ObjectId(String(user.userId)) })
        .exec();
      query.$or = [
        { createdBy: new mongoose.Types.ObjectId(String(user.userId)) },
        { examType: 'final', subjectOfferingId: { $in: offerings } },
      ];
    }
    // A teacher's list is this year's unless a subject or year is named;
    // last year's exams sat in it otherwise. Applied before counting, so the
    // totals and pages match what is shown.
    if (!query.subjectOfferingId && (user?.role === 'TEACHER' || academicYearId)) {
      const inYear = await scopedOfferingIds(this.examModel.db, academicYearId);
      if (inYear) query.subjectOfferingId = { $in: inYear };
    }


    // Makeups are listed under their original, never as rows of their own.
    query.makeupOf = null;

    const total = await this.examModel.countDocuments(query).exec();

    const paginationMate = getPagination(pagination.page, pagination.limit, total);

    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let examsQuery = this.examModel
      .find(query).sort({ createdAt: -1 })
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate(ExamsService.SUBJECT_OFFERING_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER })
      .populate({ path: 'createdBy', select: ExamsService.TEACHER_FIELDS });

    if (isPaginationRequested) {
      examsQuery = examsQuery.skip(paginationMate.skip).limit(paginationMate.limit);
    }

    const exams = await examsQuery.exec();
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;

    // «3 بانتظار التصحيح» on each exam, in one query for the page.
    const pending = await this.pendingReviewCounts(exams.map((e) => e._id));
    const makeups = await this.makeupsByOriginal(exams.map((e) => e._id));
    const present = (exam: any) => {
      const base: any = transformExamResponse(exam);
      if (user?.role === 'STUDENT') {
        base.questions = this.forStudent(base);
        delete base.studentIds;
      }
      base.pendingReviewCount = pending.get(String(exam._id)) ?? 0;
      base.makeups = makeups.get(String(exam._id)) ?? [];
      return base;
    };

    if (isPaginationRequested) {
      return {
        data: exams.map(present),
        totalDocs,
        totalPages
      };
    }

    return exams.map(present);
  }

  /** The questions of an exam as a student may see them before grading. */
  private forStudent(exam: any): any[] {
    const questions = exam?.questions ?? [];
    const marks = effectiveMarks({ grade: exam?.grade, questions });
    return questions.map((q: any, i: number) => studentQuestion(q, marks[i]));
  }

  /** originalId → its makeups, as a list nests them: dates, how many set and taken. */
  private async makeupsByOriginal(originalIds: any[]): Promise<Map<string, any[]>> {
    const out = new Map<string, any[]>();
    if (!originalIds.length) return out;
    const makeups: any[] = await this.examModel
      .find({ makeupOf: { $in: originalIds.map((id) => new mongoose.Types.ObjectId(String(id))) } })
      .select('_id makeupOf startDate endDate duration studentIds createdAt')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (!makeups.length) return out;
    const ids = makeups.map((x) => x._id);
    const [taken, pending] = await Promise.all([
      this.examResultModel
        .aggregate([
          { $match: { examId: { $in: ids }, submitted: true } },
          { $group: { _id: '$examId', count: { $sum: 1 } } },
        ])
        .exec(),
      this.pendingReviewCounts(ids),
    ]);
    const takenOf = new Map(taken.map((r: any) => [String(r._id), r.count]));
    for (const x of makeups) {
      const key = String(x.makeupOf);
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push({
        _id: x._id,
        startDate: x.startDate,
        endDate: x.endDate,
        duration: x.duration,
        studentCount: (x.studentIds ?? []).length,
        takenCount: takenOf.get(String(x._id)) ?? 0,
        pendingReviewCount: pending.get(String(x._id)) ?? 0,
      });
    }
    return out;
  }

  /** examId → papers waiting for the teacher to mark an essay. */
  private async pendingReviewCounts(examIds: any[]): Promise<Map<string, number>> {
    if (!examIds.length) return new Map();
    const rows = await this.examResultModel
      .aggregate([
        { $match: { examId: { $in: examIds.map((id) => new mongoose.Types.ObjectId(String(id))) }, status: 'pending_review', submitted: true } },
        { $group: { _id: '$examId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r: any) => [String(r._id), r.count]));
  }

  async findOne(id: string, user?: any) {
    this.validateObjectId(id, 'exam');

    // The exam carries its answer key. A teacher reads her own, and the exams
    // of subjects she teaches (the shared final, a colleague's quiz she may
    // cover) — not every exam in the school by id.
    if (user?.role === 'TEACHER') {
      const meta = await this.examModel.findById(id).select('createdBy subjectOfferingId').exec();
      if (
        meta &&
        String(meta.createdBy) !== String(user.userId) &&
        !(await this.teachesOffering(user.userId, meta.subjectOfferingId))
      ) {
        throw new ForbiddenException('ليس لديك صلاحية لعرض هذا الامتحان');
      }
    }

    const exam = await this.examModel
      .findById(id)
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate(ExamsService.SUBJECT_OFFERING_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER })
      .populate({ path: 'createdBy', select: ExamsService.TEACHER_FIELDS })
      .exec();

    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${id} غير موجود`);
    }

    const base: any = transformExamResponse(exam);
    // The exam carries its answer key and model answers; a student reading
    // it by id gets the questions only.
    if (user?.role === 'STUDENT') base.questions = this.forStudent(base);
    return base;
  }

  async update(id: string, updateExamDto: UpdateExamDto, user?: any) {
    this.validateObjectId(id, 'exam');

    const existingExam = await this.examModel.findById(id);
    if (!existingExam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${id} غير موجود`);
    }

    await this.assertTeacherMayManage(existingExam, user);
    if (updateExamDto.studentIds !== undefined && !existingExam.makeupOf) {
      throw new BadRequestException('الطالبات يُحدَّدن في الاختبار البديل فقط؛ الاختبار العادي لفصوله كاملة');
    }
    if (updateExamDto.questions) {
      await this.assertQuestionsOpen(existingExam._id);
      if (updateExamDto.questions.length === 0) {
        throw new BadRequestException('يجب أن يحتوي الامتحان على سؤال واحد على الأقل');
      }
      // The same rules as creating: this route must not be a way around them.
      updateExamDto.questions = this.normalizeQuestions(updateExamDto.questions);
    }

    if (existingExam.makeupOf) {
      return this.updateMakeup(existingExam, updateExamDto, user);
    }

    // A final stays the whole grade's, for the subject it was set for. Its
    // type cannot be changed into or out of «final» either: that would
    // silently re-scope it to one teacher's classes, or to everybody's.
    if (existingExam.examType === 'final' || updateExamDto.examType === 'final') {
      if (updateExamDto.examType && updateExamDto.examType !== existingExam.examType) {
        throw new BadRequestException('لا يمكن تغيير نوع الامتحان من نهائي أو إليه؛ احذفه وأنشئ امتحانًا جديدًا');
      }
      delete updateExamDto.classIds;
      delete updateExamDto.subjectOfferingId;
    }

    if (updateExamDto.classIds) {
      for (const classId of updateExamDto.classIds) {
        this.validateObjectId(classId, 'class');
        const classExists = await this.classModel.findById(classId);
        if (!classExists) {
          throw new NotFoundException(`الفصل ذو المعرف ${classId} غير موجود`);
        }
      }
    }

    if (updateExamDto.subjectOfferingId) {
      this.validateObjectId(updateExamDto.subjectOfferingId, 'subjectOffering');
      const gradesCriteria = await this.gradesCriteriaModel.findOne({
        subjectOfferingId: new mongoose.Types.ObjectId(updateExamDto.subjectOfferingId),
      }).exec();

      if (gradesCriteria) {
        updateExamDto['gradesCriteriaId'] = gradesCriteria._id;
      }
    }

    const updatedExam = await this.examModel.findByIdAndUpdate(
      id,
      updateExamDto,
      { new: true, runValidators: true }
    )
    await updatedExam.populate([
      ExamsService.GRADES_CRITERIA_POPULATE,
      { path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER }
    ]);

    return transformExamResponse(updatedExam);
  }

  async remove(id: string, user?: any) {
    this.validateObjectId(id, 'exam');

    const exam = await this.examModel.findById(id);
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${id} غير موجود`);
    }

    await this.assertTeacherMayManage(exam, user);

    // Its results are the students' marks. Deleting the exam took them out
    // of the term grade without a word, and nothing could bring them back.
    if (await this.examResultModel.exists({ examId: exam._id })) {
      throw new BadRequestException('لا يمكن حذف امتحان بدأه الطلاب؛ درجاتهم محفوظة عليه');
    }
    // Its makeups' marks count as its own; without it they would hang on nothing.
    if (await this.examModel.exists({ makeupOf: exam._id })) {
      throw new BadRequestException('لهذا الاختبار اختبار بديل؛ احذف الاختبار البديل أولًا');
    }

    await this.examModel.findByIdAndDelete(id);

    return {
      message: `تم حذف الامتحان ذو المعرف ${id} بنجاح`,
      data: transformExamResponse(exam)
    };
  }

  /**
   * Only a student of a class the exam is set for sits it. Without this, any
   * signed-in account — another class's student, or a teacher — could open
   * any exam by id, read its questions and leave a result behind.
   */
  private async assertStudentMaySit(exam: Exam, user: any): Promise<void> {
    if (user?.role !== 'STUDENT') {
      throw new ForbiddenException('أداء الامتحانات متاح للطلاب فقط');
    }
    // A makeup is for the students picked for it, and nobody else in the class.
    if ((exam as any).makeupOf) {
      if (!((exam as any).studentIds ?? []).some((id: any) => String(id) === String(user.userId))) {
        throw new ForbiddenException('هذا الاختبار البديل غير مخصص لك');
      }
      return;
    }
    const classIds = await this.studentClassResolver.resolveClassIds(user.userId);
    if (!(exam.classIds ?? []).some((c) => classIds.includes(String(c)))) {
      throw new ForbiddenException('هذا الامتحان غير مخصص لفصلك');
    }
    // She sits the original or its makeup, never both.
    if (
      await this.examModel.exists({
        makeupOf: exam._id,
        studentIds: new mongoose.Types.ObjectId(String(user.userId)),
      })
    ) {
      throw new ForbiddenException('لديك اختبار بديل لهذا الاختبار');
    }
  }

  /**
   * Questions are fixed once a student has opened the paper. A changed
   * question or answer key is not re-marked against the papers already
   * handed in, so those students would keep a mark for a different exam.
   */
  private async assertQuestionsOpen(examId: any): Promise<void> {
    if (await this.examResultModel.exists({ examId: new mongoose.Types.ObjectId(String(examId)) })) {
      throw new BadRequestException('لا يمكن تعديل الأسئلة بعد أن بدأ الطلاب الامتحان');
    }
  }

  /**
   * Only as many exams of a type count toward the term as the subject's grade
   * distribution allows — the fourth quiz of three is sat and then silently
   * ignored. Counted per class: two teachers of a subject each give their
   * own sections the full number.
   */
  private async assertWithinCount(
    gradesCriteria: GradesCriteria,
    subjectOfferingId: string,
    examType: string,
    classIds: string[],
  ): Promise<void> {
    const limits: Record<string, { count: number; label: string }> = {
      quiz: { count: gradesCriteria.quizzesCount ?? 0, label: 'الاختبارات القصيرة' },
      assignment: { count: gradesCriteria.assignmentsCount ?? 0, label: 'الواجبات' },
      // The term grade reads one activity exam.
      activity: { count: 1, label: 'اختبارات الأنشطة' },
    };
    const limit = limits[examType];
    if (!limit) return;
    for (const classId of classIds) {
      const existing = await this.examModel.countDocuments({
        examType,
        // A makeup stands in for an exam; it is not another one of its type.
        makeupOf: null,
        classIds: new mongoose.Types.ObjectId(classId),
        $or: [
          { subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId) },
          { gradesCriteriaId: gradesCriteria._id },
        ],
      });
      if (existing >= limit.count) {
        throw new BadRequestException(
          `اكتمل عدد ${limit.label} المحدد لهذه المادة (${limit.count}) في أحد الفصول المختارة`,
        );
      }
    }
  }

  /** The question routes answer to the same owner rule as the exam itself. */
  private async assertMayEditQuestions(examId: string, user: any): Promise<void> {
    const exam = await this.examModel.findById(examId).select('createdBy examType subjectOfferingId').exec();
    if (!exam) {
      throw new NotFoundException('الامتحان غير موجود');
    }
    await this.assertTeacherMayManage(exam, user);
    await this.assertQuestionsOpen(exam._id);
  }

  async updateQuestion(examId: string, questionId: string, updateQuestionDto: UpdateQuestionDto, user?: any) {
    this.validateObjectId(examId, 'exam');
    this.validateObjectId(questionId, 'question');
    await this.assertMayEditQuestions(examId, user);

    // The question after the change is checked whole, against its (possibly
    // new) type, and against the others for marks — so a field changed alone
    // cannot leave it half one type and half another.
    const current: any = await this.examModel.findById(examId).select('questions').lean().exec();
    const index = (current?.questions ?? []).findIndex((q: any) => String(q._id) === String(questionId));
    if (index < 0) {
      throw new NotFoundException('الامتحان أو السؤال غير موجود');
    }
    const before = current.questions[index];
    const merged: any = { ...before, type: before.type ?? 'mcq' };
    for (const key of ['type', 'question', 'options', 'correctAnswer', 'modelAnswer', 'marks'] as const) {
      if (updateQuestionDto[key] !== undefined) merged[key] = updateQuestionDto[key];
    }
    // Switching to an essay drops what an essay cannot have, rather than
    // making the client send empties for fields it never meant to keep.
    if (updateQuestionDto.type === 'essay') {
      if (updateQuestionDto.options === undefined) merged.options = [];
      if (updateQuestionDto.correctAnswer === undefined) merged.correctAnswer = null;
    } else if (updateQuestionDto.type && updateQuestionDto.modelAnswer === undefined) {
      merged.modelAnswer = null;
    }
    const normalized = normalizeQuestion(merged, `السؤال ${index + 1}`);
    assertMarksConsistent(
      current.questions.map((q: any, i: number) => (i === index ? normalized : q)),
    );

    const updateFields = {};
    for (const [key, value] of Object.entries(normalized)) {
      updateFields[`questions.$.${key}`] = value;
    }

    const result = await this.examModel.updateOne(
      { _id: examId, 'questions._id': questionId },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('الامتحان أو السؤال غير موجود');
    }

    const exam = await this.examModel
      .findById(examId)
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER });
    return transformExamResponse(exam);
  }

  async deleteQuestion(examId: string, questionId: string, user?: any) {
    this.validateObjectId(examId, 'exam');
    this.validateObjectId(questionId, 'question');
    await this.assertMayEditQuestions(examId, user);

    const result = await this.examModel.updateOne(
      { _id: examId },
      { $pull: { questions: { _id: questionId } } }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('الامتحان غير موجود');
    }

    const exam = await this.examModel
      .findById(examId)
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER });
    return transformExamResponse(exam);
  }

  async addQuestion(examId: string, questionDto: QuestionDto, user?: any) {
    this.validateObjectId(examId, 'exam');
    await this.assertMayEditQuestions(examId, user);

    const current: any = await this.examModel.findById(examId).select('questions').lean().exec();
    const normalized = normalizeQuestion(questionDto, `السؤال ${(current?.questions?.length ?? 0) + 1}`);
    assertMarksConsistent([...(current?.questions ?? []), normalized]);

    const result = await this.examModel.updateOne(
      { _id: examId },
      { $push: { questions: normalized } }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('الامتحان غير موجود');
    }

    const exam = await this.examModel
      .findById(examId)
      .populate(ExamsService.GRADES_CRITERIA_POPULATE)
      .populate({ path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER });
    return transformExamResponse(exam);
  }

  private readonly logger = new Logger(ExamsService.name);
  private sweeping = false;

  /** When a session's paper closes: her own time, or the exam's window, whichever is first. */
  private static deadline(session: any, exam: any): number {
    const ownTime = new Date(session.startedAt).getTime() + Number(exam.duration) * 60000;
    return Math.min(ownTime, new Date(exam.endDate).getTime());
  }

  private static expired(session: any, exam: any, now = Date.now()): boolean {
    return now > ExamsService.deadline(session, exam) + SUBMIT_GRACE_MINUTES * 60000;
  }

  /**
   * Mark a paper. One answer per question, the first one sent — counted as
   * sent, the same correct answer repeated scored past 100%. `strict` refuses
   * an unknown question (a live submission); saved drafts skip it instead.
   */
  private markPaper(exam: any, answers: { questionId: string; answer: string }[], strict: boolean) {
    // Every question gets an entry. Multiple choice and true/false are
    // marked here; an essay answered is left for the teacher, which leaves
    // the whole paper pending_review with no grade.
    return markAnswers(exam, answers, strict, (id) => {
      throw new BadRequestException(`السؤال ذو المعرف ${id} غير موجود في هذا الامتحان`);
    });
  }

  /**
   * Close a session whose time has run out, marking what she saved.
   * Conditional on it still being open, so it never overwrites a paper the
   * student handed in herself.
   */
  private async finalizeSession(session: any, exam: any): Promise<void> {
    if (session.submitted) return;
    const marked = this.markPaper(exam, session.draftAnswers ?? [], false);
    await this.examResultModel.updateOne(
      { _id: session._id, submitted: { $ne: true } },
      {
        submitted: true,
        autoSubmitted: true,
        status: marked.status,
        achievedGrade: marked.achievedGrade,
        percentage: marked.percentage,
        passed: marked.passed,
        answers: marked.results,
      },
    );
  }

  /**
   * Every few minutes, mark the papers whose time ran out unsubmitted. Results
   * carry no school, so exams are read across schools here; marking needs
   * nothing but the exam and the session.
   */
  @Cron('*/5 * * * *', { name: 'exam-auto-submit' })
  async sweepExpiredSessions(now: number = Date.now()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let closed = 0;
    try {
      const open = await this.examResultModel
        .find({ submitted: { $ne: true } })
        .select('_id examId startedAt submitted draftAnswers')
        .lean()
        .exec();
      if (!open.length) return 0;
      const exams = await this.examModel
        .find({ _id: { $in: [...new Set(open.map((r: any) => String(r.examId)))] } })
        .select('_id grade duration endDate questions')
        .setOptions({ skipTenantScope: true } as any)
        .lean()
        .exec();
      const byId = new Map(exams.map((e: any) => [String(e._id), e]));
      for (const session of open) {
        const exam = byId.get(String((session as any).examId));
        if (!exam || !ExamsService.expired(session, exam, now)) continue;
        try {
          await this.finalizeSession(session, exam);
          closed++;
        } catch (error: any) {
          this.logger.error(`Auto-submit failed for result ${(session as any)._id}: ${error?.message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
    return closed;
  }

  /**
   * Save the student's answers so far. Called as she answers; replaces what
   * was saved. Marked only if her time runs out before she submits.
   */
  async saveAnswers(examId: string, submitAnswersDto: SubmitAnswersDto, user: any) {
    this.validateObjectId(examId, 'exam');
    const exam = await this.examModel.findById(examId).exec();
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }
    await this.assertStudentMaySit(exam, user);

    const session = await this.examResultModel.findOne({ examId, studentId: user.userId });
    if (!session) {
      throw new BadRequestException('يجب بدء الامتحان أولاً قبل حفظ الإجابات');
    }
    if (session.submitted) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }
    if (ExamsService.expired(session, exam)) {
      await this.finalizeSession(session, exam);
      throw new BadRequestException('انتهى وقت الامتحان، وسُلّمت إجاباتك المحفوظة');
    }

    const known = new Set(exam.questions.map((q: any) => q._id.toString()));
    const seen = new Set<string>();
    const draft = (submitAnswersDto.answers ?? [])
      .filter((a) => {
        const id = String(a.questionId);
        if (!known.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map((a) => ({ questionId: String(a.questionId), answer: String(a.answer ?? '') }));

    await this.examResultModel.updateOne(
      { _id: session._id, submitted: { $ne: true } },
      { draftAnswers: draft },
    );

    return {
      message: 'تم حفظ الإجابات',
      data: {
        savedAnswers: draft.length,
        remainingSeconds: Math.max(0, Math.floor((ExamsService.deadline(session, exam) - Date.now()) / 1000)),
      },
    };
  }

  async startExam(examId: string, user: any) {
    this.validateObjectId(examId, 'exam');

    const exam = await this.examModel.findById(examId).exec();
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }
    await this.assertStudentMaySit(exam, user);

    const now = new Date();
    if (now < (exam as any).startDate) {
      throw new BadRequestException('لم يبدأ وقت الامتحان بعد');
    }

    const existing = await this.examResultModel.findOne({ examId, studentId: user.userId });
    if (existing?.submitted) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    // Reopened after her time or the window ran out: what she saved is
    // marked now, rather than leaving the paper open until the sweep.
    if (existing && ExamsService.expired(existing, exam, now.getTime())) {
      await this.finalizeSession(existing, exam);
      throw new BadRequestException('انتهى وقت الامتحان، وسُلّمت إجاباتك المحفوظة');
    }
    if (now > (exam as any).endDate) {
      throw new BadRequestException('انتهى وقت الامتحان');
    }

    const session =
      existing ??
      (await this.examResultModel.create({
        examId,
        studentId: user.userId,
        startedAt: now,
        submitted: false,
      }));
    const startedAt: Date = session.startedAt;
    // Counted from when she first opened it, not from now, and never past
    // the exam's own end: a paper reopened after the app closed shows the
    // time actually left, not the whole duration again.
    const remainingSeconds = Math.max(
      0,
      Math.floor((ExamsService.deadline(session, exam) - now.getTime()) / 1000),
    );

    // No answer key and no model answer.
    const questions = this.forStudent(exam);

    return {
      message: existing ? 'الامتحان قيد التقدم بالفعل' : 'تم بدء الامتحان بنجاح',
      data: {
        startedAt,
        remainingSeconds,
        duration: (exam as any).duration,
        exam: {
          _id: exam._id,
          examType: exam.examType,
          grade: exam.grade,
          questions,
        },
        // What she saved before the app closed, to put back on screen.
        savedAnswers: (existing?.draftAnswers ?? []).map((a: any) => ({
          questionId: a.questionId,
          answer: a.answer,
        })),
      },
    };
  }

  async gradeExam(examId: string, submitAnswersDto: SubmitAnswersDto, user: any) {
    this.validateObjectId(examId, 'exam');

    const exam = await this.examModel
      .findById(examId)
      .populate('gradesCriteriaId')
      .exec();

    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }
    await this.assertStudentMaySit(exam, user);

    const now = new Date();
    if (now < (exam as any).startDate) {
      throw new BadRequestException('لم يبدأ وقت الامتحان بعد');
    }

    const session = await this.examResultModel.findOne({ examId, studentId: user.userId });

    if (!session) {
      throw new BadRequestException('يجب بدء الامتحان أولاً قبل تقديم الإجابات');
    }
    if (session.submitted) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    // Past her time or the window, with grace: what she saved is marked
    // instead, so a paper that arrives too late is not simply a zero.
    if (ExamsService.expired(session, exam, now.getTime())) {
      await this.finalizeSession(session, exam);
      throw new BadRequestException('انتهى وقت الامتحان، وسُلّمت إجاباتك المحفوظة');
    }

    const totalQuestions = exam.questions.length;
    if (totalQuestions === 0) {
      throw new BadRequestException('هذا الامتحان لا يحتوي على أسئلة');
    }

    const { answers } = submitAnswersDto;
    const marked = this.markPaper(exam, answers, true);
    const results = marked.results;
    const correctAnswersCount = marked.correct;
    const maxGrade = exam.grade;

    // Conditional on submitted: false, so two submissions racing each other
    // cannot both be accepted, the second overwriting the first.
    const saved = await this.examResultModel.findOneAndUpdate(
      { _id: session._id, submitted: { $ne: true } },
      {
        submitted: true,
        status: marked.status,
        achievedGrade: marked.achievedGrade,
        percentage: marked.percentage,
        passed: marked.passed,
        answers: results,
      },
    );
    if (!saved) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    const answered = results.filter((r) => r.studentAnswer.trim() !== '').length;

    // An essay waits for the teacher: no score now, not even a partial one —
    // it would read as final.
    if (marked.status === 'pending_review') {
      return {
        message: 'تم التسليم، وستظهر النتيجة بعد تصحيح المعلمة',
        examId: exam._id,
        examType: exam.examType,
        status: marked.status,
        totalQuestions,
        answeredQuestions: answered,
        maxGrade,
        achievedGrade: null,
        percentage: null,
        passed: null,
        results: [],
      };
    }

    return {
      examId: exam._id,
      examType: exam.examType,
      status: marked.status,
      totalQuestions: totalQuestions,
      answeredQuestions: answered,
      correctAnswers: correctAnswersCount,
      incorrectAnswers: totalQuestions - correctAnswersCount,
      percentage: marked.percentage,
      maxGrade: maxGrade,
      achievedGrade: marked.achievedGrade,
      results: presentAnswers(exam as any, results),
      passed: marked.passed,
    };
  }

  /**
   * The caller's own result for one exam.
   *
   * Grading answered with the full breakdown, but only once, in the reply to
   * the submission — reopening a finished exam had nothing to read, and the
   * app was asking GET /exams/:examId/grade, a route that never existed. So a
   * student could sit an exam and never see the mark again.
   *
   * `answers` is empty for anything submitted before the schema kept them;
   * the score is still exact, since it was always stored.
   */
  async getMyResult(examId: string, user: any) {
    this.validateObjectId(examId, 'exam');

    const exam = await this.examModel
      .findById(examId)
      .select('_id examType grade questions duration endDate')
      .exec();
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }

    let result = await this.examResultModel
      .findOne({
        examId: new mongoose.Types.ObjectId(examId),
        studentId: new mongoose.Types.ObjectId(String(user.userId)),
      })
      .exec();

    if (!result) {
      throw new NotFoundException('لم تقم بدخول هذا الامتحان');
    }
    if (!result.submitted && ExamsService.expired(result, exam)) {
      await this.finalizeSession(result, exam);
      result = await this.examResultModel.findById(result._id).exec();
    }
    if (!result.submitted) {
      throw new BadRequestException('لم تقم بتسليم هذا الامتحان بعد');
    }

    const totalQuestions = exam.questions?.length ?? 0;
    const submittedAt = (result as any).updatedAt ?? null;

    // Waiting for the teacher: no answers and no partial score — it would
    // read as a final grade when it is not one.
    if ((result as any).status === 'pending_review') {
      return {
        message: 'تم التسليم، وستظهر النتيجة بعد تصحيح المعلمة',
        data: {
          examId: exam._id,
          examType: (exam as any).examType,
          status: 'pending_review',
          submittedAt,
          totalQuestions,
          maxGrade: (exam as any).grade,
          achievedGrade: null,
          percentage: null,
          passed: null,
          results: [],
        },
      };
    }

    const answers = result.answers ?? [];
    // Older rows kept no answers, so the count has to come back out of the
    // percentage that was stored alongside the grade.
    const correctAnswers = answers.length
      ? answers.filter((a) => a.isCorrect).length
      : Math.round(((result.percentage ?? 0) / 100) * totalQuestions);
    // Rows since question types hold every question, answered or not.
    const answeredQuestions = answers.some((a: any) => a.type)
      ? answers.filter((a: any) => String(a.studentAnswer ?? '').trim() !== '').length
      : answers.length;

    return {
      message: 'تم استرجاع نتيجة الامتحان بنجاح',
      data: {
        examId: exam._id,
        examType: (exam as any).examType,
        status: 'graded',
        totalQuestions,
        answeredQuestions,
        correctAnswers,
        incorrectAnswers: totalQuestions - correctAnswers,
        percentage: result.percentage ?? 0,
        maxGrade: (exam as any).grade,
        achievedGrade: result.achievedGrade ?? 0,
        passed: result.passed ?? false,
        submittedAt,
        // Her mark and the teacher's note on each; the model answer on an
        // essay; the correct answer only where there is one.
        results: presentAnswers(exam as any, answers),
      },
    };
  }

  /**
   * Who sat this exam, and what they scored.
   *
   * PATCH /exams/:examId/students/:studentId/grade existed with nothing to
   * drive it: GET /exams/:id returns the exam, its questions and its classes
   * but no results, so a teacher could set a mark and never read one. They
   * could not see who had taken the exam, what it currently said, or why a
   * student they picked answered 404 — editStudentGrade requires an existing
   * ExamResult, which only exists once the student has started the exam.
   *
   * Mirrors GET /projects/:id/submissions, which is the same question asked
   * of a project and has worked all along.
   *
   * Ownership is checked the same way editStudentGrade checks it — a lecture
   * for this teacher on this offering — so read and write agree. Without that,
   * a teacher could enumerate another subject's results and simply be refused
   * on the write.
   */
  async listResults(examId: string, user: any) {
    this.validateObjectId(examId, 'exam');

    const exam = await this.examModel
      .findById(examId)
      .select('_id grade examType subjectOfferingId classIds duration endDate questions makeupOf studentIds')
      .exec();
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      const lecture = await this.lectureModel.findOne({
        teacherId: new mongoose.Types.ObjectId(String(user.userId)),
        subjectOfferingId: exam.subjectOfferingId,
      });
      if (!lecture) {
        throw new ForbiddenException('ليس لديك صلاحية لعرض نتائج هذه المادة');
      }
    }

    // Papers whose time ran out are marked from what was saved before the
    // list is read, not up to five minutes later.
    const open = await this.examResultModel
      .find({ examId: new mongoose.Types.ObjectId(examId), submitted: { $ne: true } })
      .exec();
    for (const session of open) {
      if (ExamsService.expired(session, exam)) await this.finalizeSession(session, exam);
    }

    const own = await this.examResultModel
      .find({ examId: new mongoose.Types.ObjectId(examId) })
      .populate({ path: 'studentId', select: 'name schoolEmail classId' })
      .sort({ createdAt: 1 })
      .exec();

    // One sheet for the exam: the makeup papers sit on it as rows, marked
    // with the makeup they came from. The original's paper wins if both exist.
    const fromMakeup = new Map<string, string>();
    // makeupId → the makeup itself, to read its papers' answers against.
    const makeupShape = new Map<string, any>();
    let results: any[] = own;
    if (!(exam as any).makeupOf) {
      const makeups: any[] = await this.examModel
        .find({ makeupOf: exam._id })
        .select('_id grade duration endDate questions studentIds')
        .lean()
        .exec();
      if (makeups.length) {
        for (const makeup of makeups) makeupShape.set(String(makeup._id), makeup);
        for (const makeup of makeups) {
          const openOnMakeup = await this.examResultModel.find({ examId: makeup._id, submitted: { $ne: true } }).exec();
          for (const session of openOnMakeup) {
            if (ExamsService.expired(session, makeup)) await this.finalizeSession(session, makeup);
          }
        }
        const seen = new Set(own.map((r: any) => String(r.studentId?._id ?? r.studentId)));
        const extra = await this.examResultModel
          .find({ examId: { $in: makeups.map((x) => x._id) } })
          .populate({ path: 'studentId', select: 'name schoolEmail classId' })
          .sort({ createdAt: 1 })
          .exec();
        for (const r of extra as any[]) {
          const sid = String(r.studentId?._id ?? r.studentId);
          if (seen.has(sid)) continue;
          seen.add(sid);
          fromMakeup.set(String(r._id), String(r.examId));
          results = [...results, r];
        }
      }
    }

    // A student who has not started the exam has no result row at all, so the
    // count of results is not the size of the class. Both numbers are returned
    // because the difference is exactly what the teacher is looking for.
    // A makeup is for the students picked for it, not the whole class.
    const enrolled = (exam as any).makeupOf
      ? ((exam as any).studentIds ?? []).length
      : await this.studentModel.countDocuments({ classId: { $in: exam.classIds } }).exec();

    // Each paper's answers, so the teacher can read what a student wrote —
    // her essay above all, which no score can stand in for. Never to a
    // student: this is the whole class's papers.
    const staff = user?.role !== 'STUDENT';
    const examShape: any = exam.toObject();

    return {
      message: 'تم استرجاع نتائج الامتحان بنجاح',
      data: {
        examId: exam._id,
        examType: exam.examType,
        totalGrade: exam.grade,
        enrolledCount: enrolled,
        startedCount: results.length,
        gradedCount: results.filter((r) => r.achievedGrade !== undefined && r.achievedGrade !== null).length,
        pendingReviewCount: results.filter((r: any) => r.submitted && r.status === 'pending_review').length,
        results: results.map((r: any) => ({
          studentId: r.studentId?._id ?? r.studentId,
          studentName: r.studentId?.name ?? null,
          schoolEmail: r.studentId?.schoolEmail ?? null,
          startedAt: r.startedAt,
          submitted: r.submitted,
          // null while the paper is still being sat.
          status: r.submitted ? r.status ?? 'graded' : null,
          // Essay answers in this paper still waiting for the teacher.
          pendingCount: (r.answers ?? []).filter(isPendingEssay).length,
          achievedGrade: r.achievedGrade ?? null,
          percentage: r.percentage ?? null,
          passed: r.passed ?? null,
          // Handed-in papers only: an open one has drafts, not answers. A
          // makeup paper is read against the makeup's own questions.
          answers: staff && r.submitted
            ? presentAnswers(makeupShape.get(fromMakeup.get(String(r._id)) ?? '') ?? examShape, r.answers ?? [])
            : [],
          // The makeup this paper was sat on; null for the exam's own.
          fromMakeup: fromMakeup.get(String(r._id)) ?? null,
        })),
      },
    };
  }

  async editStudentGrade(examId: string, studentId: string, achievedGrade: number, teacher: any) {
    this.validateObjectId(examId, 'exam');
    this.validateObjectId(studentId, 'student');

    const exam = await this.examModel.findById(examId).exec();
    if (!exam) throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);

    const student = await this.studentModel.findById(studentId).exec();
    if (!student) throw new NotFoundException(`الطالب غير موجود`);

    // She teaches this subject to this student's class. Teaching it to
    // another section is not enough — that student has her own teacher.
    const teacherClassIds = (
      await this.lectureModel
        .distinct('classId', {
          teacherId: new mongoose.Types.ObjectId(String(teacher.userId)),
          subjectOfferingId: exam.subjectOfferingId,
        })
        .exec()
    ).map(String);
    const studentClassIds = await this.studentClassResolver.resolveClassIds(studentId);
    if (!studentClassIds.some((id) => teacherClassIds.includes(String(id)))) {
      throw new ForbiddenException('ليس لديك صلاحية لتعديل درجات هذا الطالب في هذه المادة');
    }

    if (achievedGrade < 0 || achievedGrade > exam.grade) {
      throw new BadRequestException(`الدرجة يجب أن تكون بين 0 و ${exam.grade}`);
    }

    const result = await this.examResultModel.findOne({ examId, studentId });
    if (!result) throw new NotFoundException('لا توجد نتيجة لهذا الطالب في هذا الامتحان');

    const percentage = parseFloat(((achievedGrade / exam.grade) * 100).toFixed(2));
    const passed = percentage >= 50;

    // The whole-paper override also closes a paper waiting on an essay: the
    // teacher has given its mark. The essay answers stay unmarked (null).
    const wasPending = (result as any).status === 'pending_review';
    const updated = await this.examResultModel.findByIdAndUpdate(
      result._id,
      { achievedGrade, percentage, passed, status: 'graded' },
      { new: true },
    );
    // The student was told to wait for this mark; tell her it came.
    if (wasPending) await this.notifyGraded(exam, studentId, updated.achievedGrade as number);

    return {
      message: 'تم تعديل درجة الطالب بنجاح',
      data: {
        studentId,
        examId,
        achievedGrade: updated.achievedGrade,
        maxGrade: exam.grade,
        percentage: updated.percentage,
        passed: updated.passed,
      },
    };
  }

  // ─────────────────────────────────────────── الاختبار البديل

  /** The original exam a makeup is made of — never a makeup itself. */
  private async loadOriginal(examId: string): Promise<any> {
    this.validateObjectId(examId, 'exam');
    const exam: any = await this.examModel.findById(examId).exec();
    if (!exam) throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    if (exam.makeupOf) {
      throw new BadRequestException('لا يكون للاختبار البديل اختبار بديل؛ أنشئه من الاختبار الأصلي');
    }
    return exam;
  }

  /**
   * The original's classes this caller may give a makeup in: a teacher, the
   * ones she teaches this subject to (as in the essay review); an admin, all.
   */
  private async makeupClassIds(original: any, user: any): Promise<string[]> {
    const all = (original.classIds ?? []).map(String);
    if (user?.role !== 'TEACHER') return all;
    const mine = new Set(
      (
        await this.lectureModel
          .distinct('classId', {
            teacherId: new mongoose.Types.ObjectId(String(user.userId)),
            subjectOfferingId: original.subjectOfferingId,
          })
          .exec()
      ).map(String),
    );
    return all.filter((id: string) => mine.has(id));
  }

  /** Mark the original's papers whose time ran out, so they count as sat. */
  private async closeExpired(exam: any): Promise<void> {
    const open = await this.examResultModel.find({ examId: exam._id, submitted: { $ne: true } }).exec();
    for (const session of open) {
      if (ExamsService.expired(session, exam)) await this.finalizeSession(session, exam);
    }
  }

  /**
   * Who sat what, for an original and its makeups: submitted papers on the
   * original, submitted papers on each makeup, and the makeups themselves.
   */
  private async makeupState(original: any) {
    const makeups: any[] = await this.examModel
      .find({ makeupOf: original._id })
      .select('_id startDate endDate studentIds createdAt')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const [onOriginal, onMakeups] = await Promise.all([
      this.examResultModel.distinct('studentId', { examId: original._id, submitted: true }).exec(),
      makeups.length
        ? this.examResultModel
            .find({ examId: { $in: makeups.map((x) => x._id) }, submitted: true })
            .select('examId studentId')
            .lean()
            .exec()
        : Promise.resolve([] as any[]),
    ]);
    return {
      makeups,
      satOriginal: new Set(onOriginal.map(String)),
      satMakeup: new Set((onMakeups as any[]).map((r) => `${r.examId}|${r.studentId}`)),
    };
  }

  /**
   * Every student must be a current candidate: in the caller's classes of the
   * exam, no paper handed in on it or on any of its makeups, and not already
   * in a makeup of it that is still open. `exceptMakeup` is the makeup being
   * edited. Returns the students, for their names.
   */
  private async assertMakeupCandidates(original: any, studentIds: string[], user: any, exceptMakeup?: any) {
    if (!studentIds.length) return [];
    const classIds = new Set(await this.makeupClassIds(original, user));
    const students: any[] = await this.studentModel
      .find({ _id: { $in: studentIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('name classId')
      .lean()
      .exec();
    const byId = new Map(students.map((x) => [String(x._id), x]));
    const { makeups, satOriginal, satMakeup } = await this.makeupState(original);
    const now = Date.now();

    for (const id of studentIds) {
      const student = byId.get(id);
      if (!student) throw new BadRequestException('طالبة غير موجودة');
      const name = student.name ?? 'الطالبة';
      if (!classIds.has(String(student.classId))) {
        throw new BadRequestException(`${name} ليست من طالبات هذا الاختبار في فصولك`);
      }
      if (satOriginal.has(id)) {
        throw new BadRequestException(`${name} أدّت الاختبار الأصلي`);
      }
      for (const makeup of makeups) {
        if (exceptMakeup && String(makeup._id) === String(exceptMakeup._id)) continue;
        if (satMakeup.has(`${makeup._id}|${id}`)) {
          throw new BadRequestException(`${name} أدّت اختبارًا بديلًا لهذا الاختبار`);
        }
        const isIn = (makeup.studentIds ?? []).some((s: any) => String(s) === id);
        if (isIn && new Date(makeup.endDate).getTime() >= now) {
          throw new BadRequestException(`${name} لديها اختبار بديل قائم`);
        }
      }
    }
    return students;
  }

  /**
   * «اختبار بديل»: the students of the exam's classes (the caller's) who have
   * not handed it in, each with her absence on the exam's days — information
   * for the teacher, not a rule — and the makeup she is already in.
   */
  async makeupCandidates(examId: string, user: any) {
    const original = await this.loadOriginal(examId);
    await this.assertTeacherMayManage(original, user);
    await this.closeExpired(original);

    const classIds = await this.makeupClassIds(original, user);
    const students: any[] = classIds.length
      ? await this.studentModel
          .find({ classId: { $in: classIds.map((id) => new mongoose.Types.ObjectId(id)) }, isActive: { $ne: false } })
          .select('name classId')
          .lean()
          .exec()
      : [];
    const { makeups, satOriginal, satMakeup } = await this.makeupState(original);
    const missed = students.filter((x) => !satOriginal.has(String(x._id)));

    // Absence on any day of the exam's window.
    const from = new Date(original.startDate);
    from.setUTCHours(0, 0, 0, 0);
    const absences: any[] =
      this.attendanceModel && missed.length
        ? await this.attendanceModel
            .find({
              studentId: { $in: missed.map((x) => x._id) },
              date: { $gte: from, $lte: new Date(original.endDate) },
            })
            .select('studentId date excuseStatus')
            .lean()
            .exec()
        : [];

    const names = new Map(
      (
        await this.classModel
          .find({ _id: { $in: classIds.map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('name')
          .lean()
          .exec()
      ).map((c: any) => [String(c._id), c.name]),
    );
    const now = Date.now();
    const order = { excused: 0, unexcused: 1, none: 2 } as const;

    const candidates = missed
      .map((x) => {
        const sid = String(x._id);
        const mine = absences.filter((a) => String(a.studentId) === sid);
        const absence: keyof typeof order = mine.some((a) => a.excuseStatus === 'accepted')
          ? 'excused'
          : mine.length
            ? 'unexcused'
            : 'none';
        // The most recent makeup she is in.
        const makeup = [...makeups].reverse().find((m) => (m.studentIds ?? []).some((s: any) => String(s) === sid));
        return {
          studentId: sid,
          name: x.name ?? null,
          className: names.get(String(x.classId)) ?? null,
          absence,
          absenceDates: [...new Set(mine.map((a) => new Date(a.date).toISOString().slice(0, 10)))].sort(),
          makeup: makeup
            ? {
                examId: String(makeup._id),
                startDate: makeup.startDate,
                endDate: makeup.endDate,
                status: satMakeup.has(`${makeup._id}|${sid}`)
                  ? 'taken'
                  : new Date(makeup.endDate).getTime() < now
                    ? 'missed'
                    : 'scheduled',
              }
            : null,
        };
      })
      .sort(
        (a, b) =>
          order[a.absence] - order[b.absence] || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ar'),
      );

    return {
      message: 'تم استرجاع المرشحات للاختبار البديل',
      data: { examId: String(original._id), candidates },
    };
  }

  /** YYYY-MM-DD is the whole day, as when an exam is created; a date-time is that moment. */
  private static makeupDate(value: any, edge: 'start' | 'end'): Date {
    if (value instanceof Date) return value;
    const text = String(value ?? '');
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاريخ غير صالح');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      if (edge === 'start') d.setHours(0, 0, 0, 0);
      else d.setHours(23, 59, 59, 999);
    }
    return d;
  }

  async createMakeup(examId: string, dto: CreateMakeupExamDto, user: any) {
    const original = await this.loadOriginal(examId);
    await this.assertTeacherMayManage(original, user);

    const studentIds = [...new Set((dto.studentIds ?? []).map(String))];
    if (studentIds.length < 1 || studentIds.length > 200) {
      throw new BadRequestException('اختر من طالبة واحدة إلى 200 طالبة');
    }
    const startDate = ExamsService.makeupDate(dto.startDate, 'start');
    const endDate = ExamsService.makeupDate(dto.endDate, 'end');
    if (startDate > endDate) {
      throw new BadRequestException('بداية الاختبار البديل يجب أن تسبق نهايته');
    }
    if (endDate.getTime() <= Date.now()) {
      throw new BadRequestException('موعد الاختبار البديل يجب أن يكون اليوم أو بعده');
    }

    await this.closeExpired(original);
    await this.assertMakeupCandidates(original, studentIds, user);

    // A copy of the original's questions (new ids — the teacher usually
    // changes the one that leaked), or her own, under the same rules.
    let questions: any[];
    if (dto.copyQuestions) {
      questions = (original.questions ?? []).map((q: any) => ({
        type: q.type ?? 'mcq',
        question: q.question,
        options: [...(q.options ?? [])],
        correctAnswer: q.correctAnswer ?? null,
        modelAnswer: q.modelAnswer ?? null,
        marks: q.marks ?? null,
      }));
    } else {
      if (!dto.questions?.length) {
        throw new BadRequestException('أضف أسئلة الاختبار البديل، أو انسخ أسئلة الاختبار الأصلي');
      }
      questions = this.normalizeQuestions(dto.questions);
    }

    // No assertWithinCount: a makeup stands in for an exam, it is not another.
    const makeup = await this.examModel.create({
      gradesCriteriaId: original.gradesCriteriaId ?? null,
      subjectOfferingId: original.subjectOfferingId,
      classIds: original.classIds,
      examType: original.examType,
      grade: original.grade,
      // createdBy is a Teacher; an admin's makeup stays the teacher's exam.
      createdBy: user?.role === 'TEACHER' ? user.userId : original.createdBy,
      startDate,
      endDate,
      duration: dto.duration,
      questions,
      makeupOf: original._id,
      studentIds: studentIds.map((id) => new mongoose.Types.ObjectId(id)),
    });

    await this.notifyMakeup(makeup, studentIds);

    await makeup.populate([
      ExamsService.GRADES_CRITERIA_POPULATE,
      { path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER },
    ]);
    return {
      message: 'تم إنشاء الاختبار البديل',
      data: transformExamResponse(makeup),
    };
  }

  /**
   * PATCH on a makeup: its dates, duration, questions and students. What it
   * copied from the original stays the original's. A student added is checked
   * and told; one who has started it cannot be removed.
   */
  private async updateMakeup(makeup: any, dto: UpdateExamDto, user: any) {
    const copied = ['subjectOfferingId', 'classIds', 'examType', 'grade'] as const;
    if (copied.some((k) => (dto as any)[k] !== undefined)) {
      throw new BadRequestException('المادة والفصول والنوع والدرجة تُنسخ من الاختبار الأصلي ولا تُعدَّل في الاختبار البديل');
    }
    const startDate = dto.startDate ? new Date(dto.startDate) : makeup.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : makeup.endDate;
    if (new Date(startDate) > new Date(endDate)) {
      throw new BadRequestException('بداية الاختبار البديل يجب أن تسبق نهايته');
    }

    const update: any = {};
    if (dto.startDate) update.startDate = startDate;
    if (dto.endDate) update.endDate = endDate;
    if (dto.duration !== undefined) update.duration = dto.duration;
    if (dto.questions) update.questions = dto.questions;

    let added: string[] = [];
    if (dto.studentIds !== undefined) {
      const next = [...new Set(dto.studentIds.map(String))];
      const current = (makeup.studentIds ?? []).map(String);
      const removed = current.filter((id: string) => !next.includes(id));
      added = next.filter((id) => !current.includes(id));

      if (removed.length) {
        const started: any[] = await this.examResultModel
          .find({ examId: makeup._id, studentId: { $in: removed.map((id: string) => new mongoose.Types.ObjectId(id)) } })
          .populate({ path: 'studentId', select: 'name' })
          .lean()
          .exec();
        if (started.length) {
          throw new BadRequestException(`${started[0].studentId?.name ?? 'الطالبة'} بدأت الاختبار البديل ولا يمكن إزالتها`);
        }
      }
      if (added.length) {
        const original = await this.loadOriginal(String(makeup.makeupOf));
        await this.closeExpired(original);
        await this.assertMakeupCandidates(original, added, user, makeup);
      }
      update.studentIds = next.map((id) => new mongoose.Types.ObjectId(id));
    }

    const updated = await this.examModel.findByIdAndUpdate(makeup._id, update, { new: true, runValidators: true });
    if (added.length) await this.notifyMakeup(updated, added);
    await updated.populate([
      ExamsService.GRADES_CRITERIA_POPULATE,
      { path: 'classIds', select: ExamsService.CLASS_FIELDS_GENDER },
    ]);
    return transformExamResponse(updated);
  }

  /** "2026-12-08 08:00" in the school's own time. */
  private async whenLabel(date: Date, schoolId: any): Promise<string> {
    let tz = 'Asia/Riyadh';
    try {
      const School = this.examModel.db?.models?.['School'];
      const school: any = School && schoolId
        ? await School.findById(schoolId).select('settings.timezone').setOptions({ skipTenantScope: true }).lean().exec()
        : null;
      tz = school?.settings?.timezone || tz;
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(date));
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
    } catch {
      return new Date(date).toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  /** makeup_exam_scheduled to each student (and her family, through the student's own delivery). Never throws. */
  private async notifyMakeup(makeup: any, studentIds: string[]): Promise<void> {
    if (!this.notifications || !studentIds.length) return;
    try {
      const offering: any = await this.subjectOfferingModel
        .findById(makeup.subjectOfferingId)
        .populate('subjectId', 'subjectName')
        .lean()
        .exec();
      const subjectName = offering?.subjectId?.subjectName ?? '';
      const start = await this.whenLabel(makeup.startDate, makeup.schoolId);
      const end = await this.whenLabel(makeup.endDate, makeup.schoolId);
      for (const studentId of studentIds) {
        await this.notifications.notify({
          recipientId: studentId,
          type: 'makeup_exam_scheduled',
          title: 'اختبار بديل',
          body: `حُدِّد لكِ اختبار بديل في ${subjectName} من ${start} إلى ${end}، ومدته ${makeup.duration} دقيقة.`,
          data: {
            examId: String(makeup._id),
            makeupOf: String(makeup.makeupOf),
            subjectName,
            startDate: new Date(makeup.startDate).toISOString(),
            endDate: new Date(makeup.endDate).toISOString(),
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Could not announce makeup ${makeup?._id}: ${error?.message}`);
    }
  }

  // ─────────────────────────────────────────── تصحيح الأسئلة المقالية

  /**
   * Who may mark this exam's essays, and whose answers they see: a teacher,
   * the students of the classes she teaches this subject to (the same rule
   * as editStudentGrade); the school's admins, everyone (null).
   */
  private async reviewScope(exam: any, user: any): Promise<Set<string> | null> {
    if (REVIEW_ADMIN_ROLES.includes(user?.role)) return null;
    if (user?.role !== 'TEACHER') {
      throw new ForbiddenException('تصحيح الأسئلة المقالية متاح لمعلمة المادة وإدارة المدرسة فقط');
    }
    const classIds = (
      await this.lectureModel
        .distinct('classId', {
          teacherId: new mongoose.Types.ObjectId(String(user.userId)),
          subjectOfferingId: exam.subjectOfferingId,
        })
        .exec()
    ).map(String);
    if (!classIds.length) {
      throw new ForbiddenException('ليس لديك صلاحية لتصحيح هذا الامتحان');
    }
    return new Set(classIds);
  }

  /** studentId → her current classes, read as editStudentGrade reads them. */
  private async classesOf(studentIds: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(studentIds.map(String))];
    const entries = await Promise.all(
      unique.map(async (id) => [id, (await this.studentClassResolver.resolveClassIds(id)).map(String)] as const),
    );
    return new Map(entries);
  }

  private inScope(scope: Set<string> | null, classIds: string[] | undefined): boolean {
    return scope === null || (classIds ?? []).some((c) => scope.has(c));
  }

  /**
   * The essay answers of an exam, by question, with the model answer beside
   * them. `pending` (default) lists only those waiting for a mark.
   */
  async getReview(examId: string, status: string | undefined, user: any) {
    this.validateObjectId(examId, 'exam');
    const which = status ?? 'pending';
    if (which !== 'pending' && which !== 'all') {
      throw new BadRequestException('status يجب أن يكون pending أو all');
    }
    const exam: any = await this.examModel
      .findById(examId)
      .select('_id grade subjectOfferingId classIds questions')
      .lean()
      .exec();
    if (!exam) throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    const scope = await this.reviewScope(exam, user);

    const results: any[] = await this.examResultModel
      .find({ examId: exam._id, submitted: true })
      .select('studentId status answers')
      .populate({ path: 'studentId', select: 'name' })
      .lean()
      .exec();
    const sid = (r: any) => String(r.studentId?._id ?? r.studentId);
    const classes = await this.classesOf(results.map(sid));
    const visible = results.filter((r) => this.inScope(scope, classes.get(sid(r))));

    const examClasses = new Set((exam.classIds ?? []).map(String));
    const classIds = [...new Set([...classes.values()].flat())]
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const names = new Map(
      (
        await this.classModel.find({ _id: { $in: classIds } }).select('name').lean().exec()
      ).map((c: any) => [String(c._id), c.name]),
    );
    const classNameOf = (studentId: string) => {
      const mine = classes.get(studentId) ?? [];
      const id = mine.find((c) => examClasses.has(c)) ?? mine[0];
      return id ? names.get(id) ?? null : null;
    };

    const marks = effectiveMarks(exam);
    let pendingCount = 0;
    const questions = (exam.questions ?? [])
      .map((q: any, i: number) => ({ q, marks: marks[i] }))
      .filter(({ q }: any) => q.type === 'essay')
      .map(({ q, marks: m }: any) => {
        const answers: any[] = [];
        for (const r of visible) {
          const a = (r.answers ?? []).find((x: any) => String(x.questionId) === String(q._id));
          if (!a || a.type !== 'essay') continue;
          // A paper closed by the whole-paper override is not waiting on anyone.
          const pending = isPendingEssay(a) && r.status === 'pending_review';
          if (pending) pendingCount++;
          if (which === 'pending' && !pending) continue;
          answers.push({
            studentId: sid(r),
            studentName: r.studentId?.name ?? null,
            className: classNameOf(sid(r)),
            answer: a.studentAnswer ?? '',
            earned: a.earned ?? null,
            feedback: a.feedback ?? null,
            gradedAt: a.gradedAt ?? null,
          });
        }
        return {
          questionId: String(q._id),
          question: q.question,
          marks: round2(m),
          modelAnswer: q.modelAnswer ?? null,
          answers,
        };
      });

    return {
      message: 'تم استرجاع إجابات التصحيح',
      data: {
        examId: String(exam._id),
        grade: exam.grade,
        totalMarks: round2(marks.reduce((a, b) => a + b, 0)),
        pendingCount,
        questions,
      },
    };
  }

  /**
   * Mark essay answers — one save for a whole screen. Everything is checked
   * before anything is written. A paper whose last essay is marked becomes
   * graded, and the student is told, once.
   */
  async reviewAnswers(examId: string, dto: ReviewExamDto, user: any) {
    this.validateObjectId(examId, 'exam');
    const exam: any = await this.examModel
      .findById(examId)
      .select('_id grade subjectOfferingId classIds questions')
      .lean()
      .exec();
    if (!exam) throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    const scope = await this.reviewScope(exam, user);

    const grades = dto?.grades ?? [];
    if (grades.length < 1 || grades.length > 500) {
      throw new BadRequestException('عدد الدرجات بين 1 و 500');
    }

    const marks = effectiveMarks(exam);
    const questionOf = new Map<string, { q: any; marks: number }>(
      (exam.questions ?? []).map((q: any, i: number) => [String(q._id), { q, marks: marks[i] }]),
    );
    const seen = new Set<string>();
    for (const g of grades) {
      const key = `${g.studentId}|${g.questionId}`;
      if (seen.has(key)) throw new BadRequestException('إجابة مكررة في الطلب نفسه');
      seen.add(key);
      const found = questionOf.get(String(g.questionId));
      if (!found) throw new BadRequestException('السؤال غير موجود في هذا الامتحان');
      if (found.q.type !== 'essay') {
        throw new BadRequestException('التصحيح اليدوي للأسئلة المقالية فقط');
      }
      const full = round2(found.marks);
      const earned = Number(g.earned);
      const isFull = Math.abs(earned - full) < 1e-9;
      if (!Number.isFinite(earned) || earned < 0 || earned > full + 1e-9 || !(isQuarter(earned) || isFull)) {
        throw new BadRequestException(`الدرجة يجب أن تكون من مضاعفات 0.25 بين 0 و ${full}`);
      }
    }

    const studentIds = [...new Set(grades.map((g) => String(g.studentId)))];
    const results: any[] = await this.examResultModel
      .find({ examId: exam._id, studentId: { $in: studentIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id studentId submitted status answers')
      .lean()
      .exec();
    const resultOf = new Map(results.map((r) => [String(r.studentId), r]));
    for (const g of grades) {
      const r = resultOf.get(String(g.studentId));
      if (!r || !r.submitted) {
        throw new BadRequestException('لا توجد إجابة مسلّمة لهذه الطالبة في هذا الامتحان');
      }
      if (!(r.answers ?? []).some((a: any) => String(a.questionId) === String(g.questionId) && a.type === 'essay')) {
        throw new BadRequestException('لا توجد إجابة لهذه الطالبة على هذا السؤال');
      }
    }
    const classes = await this.classesOf(studentIds);
    if (studentIds.some((id) => !this.inScope(scope, classes.get(id)))) {
      throw new ForbiddenException('ليس لديك صلاحية لتصحيح إجابات طالبة ليست في فصولك');
    }

    const now = new Date();
    const gradedBy = mongoose.Types.ObjectId.isValid(String(user?.userId))
      ? new mongoose.Types.ObjectId(String(user.userId))
      : null;
    const equalShare = !allMarksSet(exam.questions ?? []);
    const gradedNow: string[] = [];
    let updated = 0;

    for (const studentId of studentIds) {
      const result = resultOf.get(studentId);
      const mine = grades.filter((g) => String(g.studentId) === studentId);

      // Positional writes, one per answer: two teachers marking different
      // questions of the same paper at once do not overwrite each other.
      const set: Record<string, any> = {};
      const arrayFilters: any[] = [];
      mine.forEach((g, k) => {
        const full = questionOf.get(String(g.questionId))!.marks;
        const earned = Math.abs(Number(g.earned) - round2(full)) < 1e-9 ? full : Number(g.earned);
        set[`answers.$[a${k}].earned`] = earned;
        if (g.feedback !== undefined) set[`answers.$[a${k}].feedback`] = g.feedback ?? null;
        set[`answers.$[a${k}].gradedAt`] = now;
        set[`answers.$[a${k}].gradedBy`] = gradedBy;
        arrayFilters.push({ [`a${k}.questionId`]: String(g.questionId) });
      });
      await this.examResultModel.updateOne({ _id: result._id }, { $set: set }, { arrayFilters });
      updated += mine.length;

      // Re-read, then score from what is stored now.
      const fresh: any = await this.examResultModel.findById(result._id).select('status answers').lean().exec();
      const score = scorePaper(fresh.answers ?? [], exam.grade, equalShare);
      if (score.status !== 'graded') continue;
      const totals = { achievedGrade: score.achievedGrade, percentage: score.percentage, passed: score.passed };

      if (fresh.status === 'pending_review') {
        // Only the write that moves it out of pending tells the student.
        const moved = await this.examResultModel.updateOne(
          { _id: result._id, status: 'pending_review' },
          { $set: { status: 'graded', ...totals } },
        );
        if (moved.modifiedCount === 1) {
          gradedNow.push(studentId);
          await this.notifyGraded(exam, studentId, score.achievedGrade as number);
          continue;
        }
      }
      // Already graded: re-marking recomputes the total, without a second notice.
      await this.examResultModel.updateOne({ _id: result._id }, { $set: totals });
    }

    const { data } = await this.getReview(examId, 'pending', user);
    return {
      message: 'تم حفظ التصحيح',
      data: { updated, gradedNow, pendingCount: data.pendingCount },
    };
  }

  /** exam_graded to the student (and her family, through the student's own delivery). Never throws. */
  private async notifyGraded(exam: any, studentId: string, achievedGrade: number): Promise<void> {
    if (!this.notifications) return;
    try {
      const offering: any = await this.subjectOfferingModel
        .findById(exam.subjectOfferingId)
        .populate('subjectId', 'subjectName')
        .lean()
        .exec();
      const subjectName = offering?.subjectId?.subjectName ?? '';
      const grade = round2(Number(exam.grade));
      await this.notifications.notify({
        recipientId: studentId,
        type: 'exam_graded',
        title: 'تم تصحيح اختبار',
        body: `صُحِّح اختبار ${subjectName}، ودرجتك ${achievedGrade} من ${grade}.`,
        data: { examId: String(exam._id), subjectName, achievedGrade, grade },
      });
    } catch (error: any) {
      this.logger.error(`Could not tell ${studentId} that exam ${exam?._id} was graded: ${error?.message}`);
    }
  }
}
