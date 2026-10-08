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
import { gradingSystemOf } from '../grade-register/grading-system.util';
import { DEFAULT_EXAM_GRADE, EXAM_PART, resolveAssessmentType } from '../grade-register/ministry-template';

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
  ) {}

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
      throw new ForbiddenException(
        `ليس لديك صلاحية لإنشاء امتحانات للفصول: ${unauthorizedClasses.join(', ')}. يمكنك الإنشاء فقط للفصول التي تدرس فيها هذه المادة.`,
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

    const { subjectOfferingId, examType, questions, startDate, endDate, duration } = createExamDto;
    let { classIds } = createExamDto;

    if (new Date(endDate) <= new Date(startDate)) {
      throw new BadRequestException('تاريخ انتهاء الامتحان يجب أن يكون بعد تاريخ البداية');
    }

    if (!questions || questions.length === 0) {
      throw new BadRequestException('يجب أن يحتوي الامتحان على سؤال واحد على الأقل');
    }

    for (const q of questions) {
      if (!q.options.includes(q.correctAnswer)) {
        throw new BadRequestException(
          `الإجابة الصحيحة "${q.correctAnswer}" يجب أن تكون إحدى الخيارات المتاحة في السؤال: "${q.question}"`
        );
      }
    }

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

    const query: any = {
      classIds: { $in: studentClassObjectIds },
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

    const data = exams.map(e => {
      const base = transformExamResponse(e);
      const start: Date = (e as any).startDate;
      const end: Date = (e as any).endDate;

      let status: 'upcoming' | 'available' | 'expired';
      if (now < start) status = 'upcoming';
      else if (now > end) status = 'expired';
      else status = 'available';

      return {
        ...base,
        questions: base.questions?.map(({ correctAnswer, ...q }) => q),
        status,
        hasTaken: takenExamIds.has(e._id.toString()),
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

    if (isPaginationRequested) {
      return {
        data: exams.map(exam => transformExamResponse(exam)),
        totalDocs,
        totalPages
      };
    }

    return exams.map(exam => transformExamResponse(exam));
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

    return transformExamResponse(exam);
  }

  async update(id: string, updateExamDto: UpdateExamDto, user?: any) {
    this.validateObjectId(id, 'exam');

    const existingExam = await this.examModel.findById(id);
    if (!existingExam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${id} غير موجود`);
    }

    await this.assertTeacherMayManage(existingExam, user);
    if (updateExamDto.questions) {
      await this.assertQuestionsOpen(existingExam._id);
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
    const classIds = await this.studentClassResolver.resolveClassIds(user.userId);
    if (!(exam.classIds ?? []).some((c) => classIds.includes(String(c)))) {
      throw new ForbiddenException('هذا الامتحان غير مخصص لفصلك');
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

    const updateFields = {};

    if (updateQuestionDto.question !== undefined) {
      updateFields['questions.$.question'] = updateQuestionDto.question;
    }
    if (updateQuestionDto.options !== undefined) {
      updateFields['questions.$.options'] = updateQuestionDto.options;
    }
    if (updateQuestionDto.correctAnswer !== undefined) {
      updateFields['questions.$.correctAnswer'] = updateQuestionDto.correctAnswer;
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

    if (!questionDto.options.includes(questionDto.correctAnswer)) {
      throw new BadRequestException(
        `الإجابة الصحيحة "${questionDto.correctAnswer}" يجب أن تكون إحدى الخيارات المتاحة`
      );
    }

    const result = await this.examModel.updateOne(
      { _id: examId },
      { $push: { questions: questionDto } }
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
    const questionMap = new Map<string, string>();
    exam.questions.forEach((q: any) => questionMap.set(q._id.toString(), q.correctAnswer));

    const seen = new Set<string>();
    const results = [];
    for (const answer of answers ?? []) {
      const id = String(answer.questionId);
      if (seen.has(id)) continue;
      const correctAnswer = questionMap.get(id);
      if (correctAnswer === undefined) {
        if (strict) {
          throw new BadRequestException(`السؤال ذو المعرف ${id} غير موجود في هذا الامتحان`);
        }
        continue;
      }
      seen.add(id);
      results.push({
        questionId: id,
        studentAnswer: String(answer.answer ?? ''),
        correctAnswer,
        isCorrect: String(answer.answer ?? '').trim().toLowerCase() === correctAnswer.trim().toLowerCase(),
      });
    }

    const total = exam.questions.length || 1;
    const correct = results.filter((r) => r.isCorrect).length;
    const percentage = (correct / total) * 100;
    return {
      results,
      correct,
      percentage: parseFloat(percentage.toFixed(2)),
      achievedGrade: parseFloat(((percentage / 100) * exam.grade).toFixed(2)),
      passed: percentage >= 50,
    };
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
    if (now > (exam as any).endDate) {
      throw new BadRequestException('انتهى وقت الامتحان');
    }

    const existing = await this.examResultModel.findOne({ examId, studentId: user.userId });
    if (existing?.submitted) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    let startedAt: Date;
    let remainingSeconds: number;

    if (existing && ExamsService.expired(existing, exam, now.getTime())) {
      await this.finalizeSession(existing, exam);
      throw new BadRequestException('انتهى وقت الامتحان، وسُلّمت إجاباتك المحفوظة');
    }

    if (existing) {
      const elapsedMinutes = (now.getTime() - existing.startedAt.getTime()) / 60000;
      remainingSeconds = Math.floor(Math.max(0, ((exam as any).duration - elapsedMinutes) * 60));
      startedAt = existing.startedAt;
    } else {
      const session = await this.examResultModel.create({
        examId,
        studentId: user.userId,
        startedAt: now,
        submitted: false,
      });
      startedAt = session.startedAt;
      remainingSeconds = (exam as any).duration * 60;
    }

    const questions = exam.questions.map((q: any) => ({
      _id: q._id,
      question: q.question,
      options: q.options,
    }));

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
    const percentage = marked.percentage;
    const maxGrade = exam.grade;
    const finalGrade = marked.achievedGrade;
    const passed = marked.passed;

    // Conditional on submitted: false, so two submissions racing each other
    // cannot both be accepted, the second overwriting the first.
    const saved = await this.examResultModel.findOneAndUpdate(
      { _id: session._id, submitted: { $ne: true } },
      {
        submitted: true,
        achievedGrade: finalGrade,
        percentage: parseFloat(percentage.toFixed(2)),
        passed,
        answers: results,
      },
    );
    if (!saved) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    return {
      examId: exam._id,
      examType: exam.examType,
      totalQuestions: totalQuestions,
      answeredQuestions: results.length,
      correctAnswers: correctAnswersCount,
      incorrectAnswers: totalQuestions - correctAnswersCount,
      percentage: parseFloat(percentage.toFixed(2)),
      maxGrade: maxGrade,
      achievedGrade: finalGrade,
      results: results,
      passed,
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
    const answers = result.answers ?? [];
    // Older rows kept no answers, so the count has to come back out of the
    // percentage that was stored alongside the grade.
    const correctAnswers = answers.length
      ? answers.filter((a) => a.isCorrect).length
      : Math.round(((result.percentage ?? 0) / 100) * totalQuestions);

    return {
      message: 'تم استرجاع نتيجة الامتحان بنجاح',
      data: {
        examId: exam._id,
        examType: (exam as any).examType,
        totalQuestions,
        answeredQuestions: answers.length,
        correctAnswers,
        incorrectAnswers: totalQuestions - correctAnswers,
        percentage: result.percentage ?? 0,
        maxGrade: (exam as any).grade,
        achievedGrade: result.achievedGrade ?? 0,
        passed: result.passed ?? false,
        submittedAt: (result as any).updatedAt ?? null,
        results: answers,
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
      .select('_id grade examType subjectOfferingId classIds duration endDate questions')
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

    const results = await this.examResultModel
      .find({ examId: new mongoose.Types.ObjectId(examId) })
      .populate({ path: 'studentId', select: 'name schoolEmail classId' })
      .sort({ createdAt: 1 })
      .exec();

    // A student who has not started the exam has no result row at all, so the
    // count of results is not the size of the class. Both numbers are returned
    // because the difference is exactly what the teacher is looking for.
    const enrolled = await this.studentModel
      .countDocuments({ classId: { $in: exam.classIds } })
      .exec();

    return {
      message: 'تم استرجاع نتائج الامتحان بنجاح',
      data: {
        examId: exam._id,
        examType: exam.examType,
        totalGrade: exam.grade,
        enrolledCount: enrolled,
        startedCount: results.length,
        gradedCount: results.filter((r) => r.achievedGrade !== undefined && r.achievedGrade !== null).length,
        results: results.map((r: any) => ({
          studentId: r.studentId?._id ?? r.studentId,
          studentName: r.studentId?.name ?? null,
          schoolEmail: r.studentId?.schoolEmail ?? null,
          startedAt: r.startedAt,
          submitted: r.submitted,
          achievedGrade: r.achievedGrade ?? null,
          percentage: r.percentage ?? null,
          passed: r.passed ?? null,
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

    const updated = await this.examResultModel.findByIdAndUpdate(
      result._id,
      { achievedGrade, percentage, passed },
      { new: true },
    );

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

}
