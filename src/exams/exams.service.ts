import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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

  async create(createExamDto: CreateExamDto, user: any) {

    const { subjectOfferingId, classIds, examType, questions, startDate, endDate, duration } = createExamDto;

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

    // Verify the teacher actually teaches these classes with this subject offering
    await this.verifyTeacherClassAccess(
      user.userId,
      classIds,
      subjectOfferingId,
    );

    for (const classId of classIds) {
      this.validateObjectId(classId, 'class');
      const classExists = await this.classModel.findById(classId);
      if (!classExists) {
        throw new NotFoundException(`الفصل ذو المعرف ${classId} غير موجود`);
      }
    }

    const gradesCriteria = await this.gradesCriteriaModel.findOne({
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
    let calculatedGrade: number;
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


    if (examType === 'final') {
      const existingExam = await this.examModel.findOne({
        gradesCriteriaId: gradesCriteria._id,
        examType: 'final',
        classIds: { $in: classIds },
      });

      if (existingExam) {
        throw new BadRequestException(
          `فصل واحد أو أكثر من هذه الفصول لديه بالفعل امتحان نهائي لهذه المادة والعام الدراسي`
        );
      }
    }



    const exam = await this.examModel.create({
       gradesCriteriaId: gradesCriteria._id,
       subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId),
       classIds,
       examType,
       grade: calculatedGrade,
       startDate,
       endDate,
       duration,
       questions,
       createdBy: user.userId,
    });

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
 if(user.role === 'TEACHER')
   query['createdBy'] = user.userId;


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

  async findOne(id: string) {
    this.validateObjectId(id, 'exam');

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

    // If user is a teacher, verify they created this exam
    if (user?.role === 'TEACHER') {
      if (existingExam.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لتحديث هذا الامتحان. يمكنك فقط تحديث الامتحانات التي قمت بإنشائها.',
        );
      }
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

    // If user is a teacher, verify they created this exam
    if (user?.role === 'TEACHER') {
      if (exam.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لحذف هذا الامتحان. يمكنك فقط حذف الامتحانات التي قمت بإنشائها.',
        );
      }
    }

    await this.examModel.findByIdAndDelete(id);

    return {
      message: `تم حذف الامتحان ذو المعرف ${id} بنجاح`,
      data: transformExamResponse(exam)
    };
  }

  async updateQuestion(examId: string, questionId: string, updateQuestionDto: UpdateQuestionDto) {
    this.validateObjectId(examId, 'exam');
    this.validateObjectId(questionId, 'question');

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

  async deleteQuestion(examId: string, questionId: string) {
    this.validateObjectId(examId, 'exam');
    this.validateObjectId(questionId, 'question');

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

  async addQuestion(examId: string, questionDto: QuestionDto) {
    this.validateObjectId(examId, 'exam');

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

  async startExam(examId: string, user: any) {
    this.validateObjectId(examId, 'exam');

    const exam = await this.examModel.findById(examId).exec();
    if (!exam) {
      throw new NotFoundException(`الامتحان ذو المعرف ${examId} غير موجود`);
    }

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

    const now = new Date();
    if (now < (exam as any).startDate) {
      throw new BadRequestException('لم يبدأ وقت الامتحان بعد');
    }
    if (now > (exam as any).endDate) {
      throw new BadRequestException('انتهى وقت الامتحان');
    }

    const session = await this.examResultModel.findOne({ examId, studentId: user.userId });

    if (!session) {
      throw new BadRequestException('يجب بدء الامتحان أولاً قبل تقديم الإجابات');
    }
    if (session.submitted) {
      throw new BadRequestException('لقد أديت هذا الامتحان من قبل');
    }

    // Duration check: now - startedAt must be within the allowed duration
    const elapsedMinutes = (now.getTime() - session.startedAt.getTime()) / 60000;
    if (elapsedMinutes > (exam as any).duration) {
      throw new BadRequestException('انتهى وقت الامتحان المخصص لك');
    }

    const totalQuestions = exam.questions.length;
    if (totalQuestions === 0) {
      throw new BadRequestException('هذا الامتحان لا يحتوي على أسئلة');
    }

    const { answers } = submitAnswersDto;

    const questionMap = new Map();
    exam.questions.forEach((question: any) => {
      questionMap.set(question._id.toString(), question.correctAnswer);
    });

    const results = answers.map((answer) => {
      const correctAnswer = questionMap.get(answer.questionId);

      if (correctAnswer === undefined) {
        throw new BadRequestException(
          `السؤال ذو المعرف ${answer.questionId} غير موجود في هذا الامتحان`
        );
      }

      const isCorrect = answer.answer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();

      return {
        questionId: answer.questionId,
        studentAnswer: answer.answer,
        correctAnswer: correctAnswer,
        isCorrect: isCorrect,
      };
    });


    const correctAnswersCount = results.filter((r) => r.isCorrect).length;


    const percentage = (correctAnswersCount / totalQuestions) * 100;

    // const examTypeWeights = {
    //   final: gradesCriteria.final,
    //   assignment: gradesCriteria.assignments,
    //   project: gradesCriteria.projects,
    //   activity: gradesCriteria.activities,
    //   quiz: gradesCriteria.quizzes,
    // }

    const maxGrade = exam.grade;

    console.log(maxGrade)

    const finalGrade = parseFloat(((percentage / 100) * maxGrade).toFixed(2));
    const passed = percentage >= 50;

  
    await this.examResultModel.findByIdAndUpdate(session._id, {
      submitted: true,
      achievedGrade: finalGrade,
      percentage: parseFloat(percentage.toFixed(2)),
      passed,
    });

    return {
      examId: exam._id,
      examType: exam.examType,
      totalQuestions: totalQuestions,
      answeredQuestions: answers.length,
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
      .select('_id grade examType subjectOfferingId classIds')
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

    // Verify teacher teaches this subject offering
    const lecture = await this.lectureModel.findOne({
      teacherId: new mongoose.Types.ObjectId(String(teacher.userId)),
      subjectOfferingId: exam.subjectOfferingId,
    });
    if (!lecture) {
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

  async deleteAll() {
    await this.examModel.deleteMany().exec();
    return {
      message: 'تم حذف جميع الامتحانات بنجاح',
    };
  }
}
