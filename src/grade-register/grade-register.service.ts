import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as mongoose from 'mongoose';
import { Model } from 'mongoose';
import { GradeRegisterSheet } from './schemas/grade-register-sheet.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { Class } from '../classes/schemas/class.schema';
import { Student } from '../students/schemas/student.schema';
import { DailyTracking } from '../daily-tracking/schemas/daily-tracking.schema';
import { Attendance } from '../attendance/schemas/attendance.schema';
import { Exam } from '../exams/schemas/exam.schema';
import { ExamResult } from '../exams/schemas/exam-result.schema';
import { Project } from '../projects/schemas/project.schema';
import { ProjectSubmission } from '../projects/schemas/project-submission.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Term } from '../terms/schemas/term.schema';
import { StudentClassResolverService } from '../enrollments/student-class-resolver.service';
import { isActivitySubject } from '../subjects/activity.util';
import {
  AssessmentType,
  EXAM_PART,
  MINISTRY_PARTS,
  PERFORMANCE_SPLIT,
  resolveAssessmentType,
  round2,
} from './ministry-template';
import { gradingSystemOf } from './grading-system.util';
import { SaveRegisterMarksDto } from './dto/save-register-marks.dto';

const ADMIN_ROLES = ['OWNER', 'SUPERVISOR', 'MANAGER', 'SUPER_ADMIN'];
const oid = (v: any) => new mongoose.Types.ObjectId(String(v));
const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);

/** Earned over possible, accumulated across papers of different sizes. */
class Tally {
  earned = 0;
  max = 0;
  count = 0;
  add(earned: number, max: number) {
    if (!(max > 0)) return;
    this.earned += Math.max(0, Math.min(earned, max));
    this.max += max;
    this.count++;
  }
  get rate(): number | null {
    return this.max > 0 ? this.earned / this.max : null;
  }
}

/**
 * السجل السنوي — the ministry template's register, one class and subject
 * offering (one term) at a time.
 *
 * Computed live from what teachers already record: daily tracking (the 40
 * for performance and interaction), quizzes paper and electronic (written
 * assessments), the final (electronic, or typed for a paper one). Approval
 * freezes the rows; promotion and the student read the frozen rows.
 */
@Injectable()
export class GradeRegisterService {
  constructor(
    @InjectModel(GradeRegisterSheet.name) private readonly sheetModel: Model<GradeRegisterSheet>,
    @InjectModel(SubjectOffering.name) private readonly offeringModel: Model<SubjectOffering>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(DailyTracking.name) private readonly trackingModel: Model<DailyTracking>,
    @InjectModel(Attendance.name) private readonly attendanceModel: Model<Attendance>,
    @InjectModel(Exam.name) private readonly examModel: Model<Exam>,
    @InjectModel(ExamResult.name) private readonly examResultModel: Model<ExamResult>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(ProjectSubmission.name) private readonly submissionModel: Model<ProjectSubmission>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    private readonly studentClassResolver: StudentClassResolverService,
  ) {}

  // ─────────────────────────────────────────────── access and loading

  private async assertMinistry(): Promise<void> {
    if ((await gradingSystemOf(this.sheetModel.db)) !== 'ministry') {
      throw new BadRequestException('السجل السنوي متاح للمدارس التي تعمل بنظام درجات الوزارة');
    }
  }

  /** A teacher reaches the register of a class she teaches the subject to. */
  private async assertMayOpen(classId: string, offeringId: string, user: any): Promise<void> {
    if (ADMIN_ROLES.includes(user?.role)) return;
    if (user?.role === 'TEACHER') {
      const teaches = await this.lectureModel.exists({
        teacherId: oid(user.userId),
        classId: oid(classId),
        subjectOfferingId: oid(offeringId),
      });
      if (teaches) return;
    }
    throw new ForbiddenException('ليس لديك صلاحية على سجل هذه المادة في هذا الفصل');
  }

  private async load(classId: string, offeringId: string) {
    if (!mongoose.Types.ObjectId.isValid(classId) || !mongoose.Types.ObjectId.isValid(offeringId)) {
      throw new BadRequestException('معرّف الفصل أو المادة غير صالح');
    }
    const [klass, offering] = await Promise.all([
      this.classModel.findById(classId).select('name gradeLevelId').lean().exec(),
      this.offeringModel
        .findById(offeringId)
        .populate('subjectId', 'subjectName assessmentType passingGrade isActivity')
        .populate('termId', 'name order')
        .lean()
        .exec(),
    ]);
    if (!klass) throw new NotFoundException('الفصل غير موجود');
    if (!offering) throw new NotFoundException('المادة غير موجودة في هذا الصف والفصل الدراسي');
    if (String((offering as any).gradeLevelId) !== String((klass as any).gradeLevelId)) {
      throw new BadRequestException('المادة ليست من صف هذا الفصل');
    }
    if (isActivitySubject((offering as any).subjectId)) {
      throw new BadRequestException('النشاط غير الدراسي لا يدخل في السجل السنوي');
    }
    const type = resolveAssessmentType(offering);
    if (!type) {
      throw new BadRequestException('لم يُحدَّد نوع التقويم لهذه المادة (مستمر أو ختامي)');
    }
    return { klass: klass as any, offering: offering as any, type };
  }

  // ─────────────────────────────────────────────── the calculation

  /**
   * Every row of one class and subject, worked out from the records.
   *
   * - Participation and homework: ticks on the periods she attended, so an
   *   absence never lowers them.
   * - Written: paper quiz marks on days present, electronic quizzes, and the
   *   teacher's extra written items, as earned over possible. An electronic
   *   paper whose window closed unsat counts 0; one still open is not counted.
   * - Tasks: electronic assignments and activities, and projects, the same way.
   * - Final: a typed mark wins; else the electronic final, scaled to 40.
   */
  private async computeRows(klass: any, offering: any, type: AssessmentType, sheet: any) {
    const classId = oid(klass._id);
    const offeringId = oid(offering._id);
    const now = Date.now();
    const parts = MINISTRY_PARTS[type];

    const students = await this.studentModel
      .find({ classId, isActive: true })
      .select('name')
      .sort({ name: 1 })
      .lean()
      .exec();
    const studentIds = students.map((s: any) => s._id);

    const tracking = await this.trackingModel
      .find({ classId, subjectOfferingId: offeringId, studentId: { $in: studentIds } })
      .select('studentId date participation homework quizScore quizMaxScore')
      .lean()
      .exec();
    const dates = [...new Set(tracking.map((t: any) => new Date(t.date).getTime()))].map((d) => new Date(d));
    const absences = dates.length
      ? await this.attendanceModel
          .find({ classId, date: { $in: dates } })
          .select('studentId date')
          .lean()
          .exec()
      : [];
    const absent = new Set(absences.map((a: any) => `${a.studentId}|${new Date(a.date).getTime()}`));

    const exams = await this.examModel
      .find({ subjectOfferingId: offeringId, classIds: classId })
      .select('_id examType grade endDate')
      .lean()
      .exec();
    const results = exams.length
      ? await this.examResultModel
          .find({ examId: { $in: exams.map((e: any) => e._id) }, studentId: { $in: studentIds } })
          .select('examId studentId achievedGrade')
          .lean()
          .exec()
      : [];
    const resultOf = new Map(results.map((r: any) => [`${r.examId}|${r.studentId}`, r]));

    const projects = await this.projectModel
      .find({ subjectOfferingId: offeringId, classIds: classId })
      .select('_id grade dueDate')
      .lean()
      .exec();
    const submissions = projects.length
      ? await this.submissionModel
          .find({ projectId: { $in: projects.map((p: any) => p._id) }, studentId: { $in: studentIds } })
          .select('projectId studentId achievedGrade')
          .lean()
          .exec()
      : [];
    const submissionOf = new Map(submissions.map((s: any) => [`${s.projectId}|${s.studentId}`, s]));

    const finalMarks = new Map((sheet?.finalMarks ?? []).map((m: any) => [String(m.studentId), m.score]));
    const items = (sheet?.writtenItems ?? []) as any[];

    return students.map((student: any) => {
      const sid = String(student._id);
      const mine = tracking.filter((t: any) => String(t.studentId) === sid);
      const present = mine.filter((t: any) => !absent.has(`${sid}|${new Date(t.date).getTime()}`));

      const participationRate = present.length
        ? present.filter((t: any) => t.participation !== false).length / present.length
        : null;
      const homeworkRate = present.length
        ? present.filter((t: any) => t.homework !== false).length / present.length
        : null;

      const written = new Tally();
      const tasks = new Tally();
      let electronicFinal: number | null = null;

      for (const t of present) {
        if (typeof (t as any).quizScore === 'number' && (t as any).quizMaxScore > 0) {
          written.add((t as any).quizScore, (t as any).quizMaxScore);
        }
      }
      for (const exam of exams as any[]) {
        const part = EXAM_PART[exam.examType];
        const result: any = resultOf.get(`${exam._id}|${sid}`);
        const got = typeof result?.achievedGrade === 'number' ? result.achievedGrade : null;
        const closed = new Date(exam.endDate).getTime() < now;
        if (got === null && !closed) continue; // not held yet, or still open
        const earned = got ?? 0;
        if (part === 'written') written.add(earned, exam.grade);
        else if (part === 'tasks') tasks.add(earned, exam.grade);
        else if (part === 'final' && exam.grade > 0) {
          electronicFinal = (earned / exam.grade) * parts.final;
        }
      }
      for (const project of projects as any[]) {
        const submission: any = submissionOf.get(`${project._id}|${sid}`);
        const got = typeof submission?.achievedGrade === 'number' ? submission.achievedGrade : null;
        if (got !== null) tasks.add(got, project.grade);
        else if (!submission && new Date(project.dueDate).getTime() < now) tasks.add(0, project.grade);
        // Handed in and not yet marked: not counted either way.
      }
      const writtenMarks: Record<string, number> = {};
      for (const item of items) {
        const mark = (item.marks ?? []).find((m: any) => String(m.studentId) === sid);
        if (mark) {
          written.add(mark.score, item.maxScore);
          writtenMarks[String(item._id)] = mark.score;
        }
      }

      let performance: number | null = null;
      if (participationRate !== null || tasks.rate !== null) {
        const split = tasks.rate !== null ? PERFORMANCE_SPLIT.withTasks : PERFORMANCE_SPLIT.withoutTasks;
        // With tasks but no tracked period, the tracking shares cannot be
        // earned or lost yet; scale the tasks share up rather than read 0.
        performance =
          participationRate === null
            ? (tasks.rate as number) * parts.performance
            : participationRate * split.participation +
              (homeworkRate as number) * split.homework +
              (tasks.rate ?? 0) * split.tasks;
      }

      const writtenScore = written.rate === null ? null : written.rate * parts.written;

      let finalScore: number | null = null;
      let finalSource: 'manual' | 'electronic' | null = null;
      if (type === 'final_exam') {
        if (finalMarks.has(sid)) {
          finalScore = finalMarks.get(sid) as number;
          finalSource = 'manual';
        } else if (electronicFinal !== null) {
          finalScore = electronicFinal;
          finalSource = 'electronic';
        }
      }

      const complete =
        performance !== null && writtenScore !== null && (type === 'continuous' || finalScore !== null);
      const total = complete ? round2((performance as number) + (writtenScore as number) + (finalScore ?? 0)) : null;

      return {
        studentId: sid,
        name: student.name,
        performance: {
          score: performance === null ? null : round2(performance),
          participationRate: pct(participationRate),
          homeworkRate: pct(homeworkRate),
          tasksRate: pct(tasks.rate),
          presentPeriods: present.length,
        },
        written: {
          score: writtenScore === null ? null : round2(writtenScore),
          rate: pct(written.rate),
          count: written.count,
          marks: writtenMarks,
        },
        final:
          type === 'final_exam'
            ? { score: finalScore === null ? null : round2(finalScore), source: finalSource }
            : null,
        total,
        complete,
      };
    });
  }

  private present(klass: any, offering: any, type: AssessmentType, sheet: any, students: any[]) {
    const subject = offering.subjectId ?? {};
    return {
      classId: String(klass._id),
      className: klass.name,
      subjectOfferingId: String(offering._id),
      subjectName: subject.subjectName ?? '',
      term: offering.termId ? { _id: String(offering.termId._id), name: offering.termId.name } : null,
      assessmentType: type,
      maxScores: MINISTRY_PARTS[type],
      passingGrade: typeof subject.passingGrade === 'number' ? subject.passingGrade : null,
      status: sheet?.status ?? 'draft',
      approvedAt: sheet?.approvedAt ?? null,
      approvedByName: sheet?.approvedByName ?? '',
      writtenItems: (sheet?.writtenItems ?? []).map((i: any) => ({
        _id: String(i._id),
        title: i.title,
        maxScore: i.maxScore,
      })),
      students,
    };
  }

  // ─────────────────────────────────────────────── routes

  async getSheet(classId: string, offeringId: string, user: any) {
    await this.assertMinistry();
    await this.assertMayOpen(classId, offeringId, user);
    const { klass, offering, type } = await this.load(classId, offeringId);
    const sheet: any = await this.sheetModel.findOne({ classId: oid(classId), subjectOfferingId: oid(offeringId) }).lean().exec();
    const students =
      sheet?.status === 'approved' && Array.isArray(sheet.snapshot)
        ? sheet.snapshot
        : await this.computeRows(klass, offering, type, sheet);
    return { status: true, message: 'تم استرجاع السجل السنوي', data: this.present(klass, offering, type, sheet, students) };
  }

  async saveMarks(dto: SaveRegisterMarksDto, user: any) {
    await this.assertMinistry();
    await this.assertMayOpen(dto.classId, dto.subjectOfferingId, user);
    const { type } = await this.load(dto.classId, dto.subjectOfferingId);

    const filter = { classId: oid(dto.classId), subjectOfferingId: oid(dto.subjectOfferingId) };
    const sheet: any =
      (await this.sheetModel.findOne(filter).exec()) ?? new this.sheetModel({ ...filter, finalMarks: [], writtenItems: [] });
    if (sheet.status === 'approved') {
      throw new ConflictException('السجل معتمد؛ يلزم إعادة فتحه للتعديل');
    }

    const roster = new Set(
      (await this.studentModel.find({ classId: filter.classId, isActive: true }).select('_id').lean().exec()).map((s: any) =>
        String(s._id),
      ),
    );
    const assertRoster = (studentId: string) => {
      if (!roster.has(String(studentId))) throw new BadRequestException('طالبة لا تنتمي إلى هذا الفصل');
    };
    const merge = (marks: any[], updates: { studentId: string; score: number | null }[], max: number) => {
      const byStudent = new Map(marks.map((m: any) => [String(m.studentId), m]));
      for (const u of updates) {
        assertRoster(u.studentId);
        if (u.score === null || u.score === undefined) {
          byStudent.delete(String(u.studentId));
          continue;
        }
        if (u.score < 0 || u.score > max) {
          throw new BadRequestException(`الدرجة يجب أن تكون بين 0 و${max}`);
        }
        byStudent.set(String(u.studentId), { studentId: oid(u.studentId), score: u.score });
      }
      return [...byStudent.values()];
    };

    if (dto.finalMarks?.length) {
      if (type !== 'final_exam') {
        throw new BadRequestException('هذه المادة تقويم مستمر ولا يوجد لها اختبار نهاية فترة');
      }
      sheet.finalMarks = merge(sheet.finalMarks ?? [], dto.finalMarks, MINISTRY_PARTS.final_exam.final);
    }

    for (const item of dto.writtenItems ?? []) {
      const existing = item._id ? sheet.writtenItems.id(item._id) : null;
      if (item._id && !existing) throw new NotFoundException('بند التقويم غير موجود');
      if (item.remove) {
        if (existing) existing.deleteOne();
        continue;
      }
      if (existing) {
        if (item.title !== undefined) existing.title = item.title;
        if (item.maxScore !== undefined) {
          const highest = Math.max(0, ...(existing.marks ?? []).map((m: any) => m.score));
          if (item.maxScore < highest) {
            throw new BadRequestException('الدرجة العظمى أقل من درجة مرصودة في هذا البند');
          }
          existing.maxScore = item.maxScore;
        }
        existing.marks = merge(existing.marks ?? [], item.marks ?? [], existing.maxScore);
      } else {
        if (!item.title || !item.maxScore) {
          throw new BadRequestException('عنوان البند ودرجته العظمى مطلوبان');
        }
        sheet.writtenItems.push({ title: item.title, maxScore: item.maxScore, marks: merge([], item.marks ?? [], item.maxScore) });
      }
    }

    sheet.markModified('finalMarks');
    sheet.markModified('writtenItems');
    await sheet.save();
    return this.getSheet(dto.classId, dto.subjectOfferingId, user);
  }

  async approve(classId: string, offeringId: string, user: any) {
    await this.assertMinistry();
    const { klass, offering, type } = await this.load(classId, offeringId);
    const filter = { classId: oid(classId), subjectOfferingId: oid(offeringId) };
    const sheet: any = (await this.sheetModel.findOne(filter).exec()) ?? new this.sheetModel({ ...filter });
    if (sheet.status === 'approved') {
      throw new ConflictException('السجل معتمد بالفعل');
    }
    const rows = await this.computeRows(klass, offering, type, sheet);
    const incomplete = rows.filter((r) => !r.complete).length;
    if (incomplete) {
      throw new BadRequestException(`لا يمكن الاعتماد: ${incomplete} من الطالبات درجاتهن غير مكتملة`);
    }
    sheet.status = 'approved';
    sheet.snapshot = rows;
    sheet.approvedAt = new Date();
    sheet.approvedBy = mongoose.Types.ObjectId.isValid(String(user?.userId)) ? oid(user.userId) : null;
    sheet.approvedByName = user?.name ?? '';
    sheet.markModified('snapshot');
    await sheet.save();
    return this.getSheet(classId, offeringId, user);
  }

  async reopen(classId: string, offeringId: string, user: any) {
    await this.assertMinistry();
    const sheet: any = await this.sheetModel
      .findOne({ classId: oid(classId), subjectOfferingId: oid(offeringId) })
      .exec();
    if (!sheet || sheet.status !== 'approved') {
      throw new ConflictException('السجل غير معتمد');
    }
    sheet.status = 'draft';
    sheet.snapshot = null;
    sheet.approvedAt = null;
    sheet.approvedBy = null;
    sheet.approvedByName = '';
    sheet.markModified('snapshot');
    await sheet.save();
    return this.getSheet(classId, offeringId, user);
  }

  /** The term a class is in now: active, else today's, else the latest. */
  private async currentTermId(termIds: string[]): Promise<string | null> {
    if (termIds.length <= 1) return termIds[0] ?? null;
    const terms: any[] = await this.termModel.find({ _id: { $in: termIds } }).select('status startDate endDate order').lean().exec();
    const now = Date.now();
    const pick =
      terms.find((t) => t.status === 'active') ??
      terms.find((t) => t.startDate && t.endDate && +new Date(t.startDate) <= now && now <= +new Date(t.endDate)) ??
      [...terms].sort((a, b) => +new Date(b.startDate ?? 0) - +new Date(a.startDate ?? 0))[0];
    return pick ? String(pick._id) : null;
  }

  /** The class's registered subjects in a term (the current one by default). */
  private async registerOfferings(klass: any, termId?: string) {
    const all: any[] = await this.offeringModel
      .find({ gradeLevelId: klass.gradeLevelId })
      .populate('subjectId', 'subjectName assessmentType passingGrade isActivity')
      .populate('termId', 'name order')
      .lean()
      .exec();
    const live = all.filter((o) => o.termId?._id);
    const term = termId ?? (await this.currentTermId([...new Set(live.map((o) => String(o.termId._id)))]));
    return live.filter(
      (o) => String(o.termId._id) === String(term) && !isActivitySubject(o.subjectId) && resolveAssessmentType(o),
    );
  }

  /** Every subject's total for one class — the class sheet admins print. */
  async classReport(classId: string, termId: string | undefined, user: any) {
    await this.assertMinistry();
    if (!ADMIN_ROLES.includes(user?.role)) throw new ForbiddenException('تقرير الفصل متاح للإدارة');
    const klass: any = await this.classModel.findById(classId).select('name gradeLevelId').lean().exec();
    if (!klass) throw new NotFoundException('الفصل غير موجود');

    const offerings = await this.registerOfferings(klass, termId);
    const subjects = [];
    const totals = new Map<string, any>();
    for (const offering of offerings) {
      const type = resolveAssessmentType(offering) as AssessmentType;
      const sheet: any = await this.sheetModel.findOne({ classId: oid(classId), subjectOfferingId: offering._id }).lean().exec();
      const rows =
        sheet?.status === 'approved' && Array.isArray(sheet.snapshot)
          ? sheet.snapshot
          : await this.computeRows(klass, offering, type, sheet);
      subjects.push({
        subjectOfferingId: String(offering._id),
        subjectName: offering.subjectId?.subjectName ?? '',
        assessmentType: type,
        status: sheet?.status ?? 'draft',
      });
      for (const row of rows) {
        const entry = totals.get(row.studentId) ?? { studentId: row.studentId, name: row.name, totals: {} };
        entry.totals[String(offering._id)] = row.total;
        totals.set(row.studentId, entry);
      }
    }
    return {
      status: true,
      message: 'تم استرجاع تقرير الفصل',
      data: { classId, className: klass.name, subjects, students: [...totals.values()] },
    };
  }

  /** A student's approved row for one subject offering, or null. For promotion. */
  async approvedRow(studentId: string, offeringId: any, classIds: string[]): Promise<any | null> {
    const sheet: any = await this.sheetModel
      .findOne({
        subjectOfferingId: oid(offeringId),
        classId: { $in: classIds.filter((c) => mongoose.Types.ObjectId.isValid(String(c))).map(oid) },
        status: 'approved',
      })
      .lean()
      .exec();
    return (sheet?.snapshot ?? []).find((r: any) => String(r.studentId) === String(studentId)) ?? null;
  }

  /**
   * The student's own register, by subject, for one term. Only approved
   * registers carry marks: a draft moves as the teacher records.
   */
  async myRegister(user: any, termId?: string) {
    await this.assertMinistry();
    const [classId] = await this.studentClassResolver.resolveClassIds(user.userId);
    if (!classId) return { status: true, message: 'لا يوجد فصل', data: { subjects: [] } };
    const klass: any = await this.classModel.findById(classId).select('name gradeLevelId').lean().exec();
    const offerings = await this.registerOfferings(klass, termId);
    const subjects = [];
    for (const offering of offerings) {
      const type = resolveAssessmentType(offering) as AssessmentType;
      const sheet: any = await this.sheetModel.findOne({ classId: oid(classId), subjectOfferingId: offering._id }).lean().exec();
      const approved = sheet?.status === 'approved';
      const row = approved ? (sheet.snapshot ?? []).find((r: any) => String(r.studentId) === String(user.userId)) : null;
      subjects.push({
        subjectOfferingId: String(offering._id),
        subjectName: offering.subjectId?.subjectName ?? '',
        term: offering.termId ? { _id: String(offering.termId._id), name: offering.termId.name } : null,
        assessmentType: type,
        maxScores: MINISTRY_PARTS[type],
        status: approved ? 'approved' : 'pending',
        performance: row?.performance?.score ?? null,
        written: row?.written?.score ?? null,
        final: row?.final?.score ?? null,
        total: row?.total ?? null,
      });
    }
    return { status: true, message: 'تم استرجاع السجل السنوي', data: { className: klass?.name ?? '', subjects } };
  }
}
