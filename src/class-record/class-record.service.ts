import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attendance } from '../attendance/schemas/attendance.schema';
import { Student } from '../students/schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Term } from '../terms/schemas/term.schema';
import { workingDatesBetween } from '../attendance/attendance.utils';
import { schoolNow } from '../teacher-attendance/teacher-presence.util';
import { currentScope, pickCurrentTerm } from '../terms/current-scope.util';
import { GradeRegisterService } from '../grade-register/grade-register.service';
import { gradingSystemOf } from '../grade-register/grading-system.util';
import { AbsenceDay, dayKey, gradeFigures, overLimit, studentRow } from './class-record.util';

const ADMIN_ROLES = ['OWNER', 'SUPERVISOR', 'MANAGER', 'SUPER_ADMIN'];
const MAX_DAYS = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * سجل الحضور والغياب (a grid of students × school days) and ملخص الفصل.
 *
 * Read-only, and built from records the school already keeps: an absence is
 * a row in Attendance, a present day is a school day with no row. Nothing
 * here is typed by hand, so the grid cannot disagree with the absence screens.
 */
@Injectable()
export class ClassRecordService {
  constructor(
    @InjectModel(Attendance.name) private readonly attendanceModel: Model<Attendance>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    @Optional() private readonly gradeRegister?: GradeRegisterService,
  ) {}

  private async settingsOf(schoolId: any): Promise<any> {
    const School = this.studentModel.db.models['School'];
    if (!School || !schoolId || !Types.ObjectId.isValid(String(schoolId))) return {};
    const school: any = await School.findById(schoolId).select('settings').setOptions({ skipTenantScope: true }).lean().exec();
    return school?.settings ?? {};
  }

  /** Admins: any class. A teacher: a class she has a period with this year. */
  private async assertMayRead(classId: string, user: any) {
    if (!Types.ObjectId.isValid(String(classId))) throw new BadRequestException('اختر الفصل');
    const klass: any = await this.classModel.findById(classId).select('name').lean().exec();
    if (!klass) throw new NotFoundException('الفصل غير موجود');
    if (ADMIN_ROLES.includes(user?.role)) return klass;
    if (user?.role === 'TEACHER') {
      const scope = await currentScope(this.termModel.db);
      const teaches = await this.lectureModel.exists({
        classId: new Types.ObjectId(String(classId)),
        teacherId: new Types.ObjectId(String(user.userId)),
        ...(scope.termIds ? { termId: { $in: scope.termIds } } : {}),
      });
      if (teaches) return klass;
    }
    throw new ForbiddenException('لا يمكنك الاطلاع على سجل هذا الفصل');
  }

  /** The current term's dates, cut at today: the window both reports default to. */
  private async termWindow(settings: any) {
    const today = schoolNow(settings?.timezone).date;
    const scope = await currentScope(this.termModel.db);
    const terms: any[] = scope.termIds
      ? await this.termModel.find({ _id: { $in: scope.termIds } }).select('name startDate endDate status order').lean().exec()
      : [];
    const term: any = pickCurrentTerm(terms);
    const from = term?.startDate ? new Date(term.startDate) : new Date(today.getTime() - 30 * 86400000);
    const termEnd = term?.endDate ? new Date(term.endDate) : today;
    const to = termEnd < today ? termEnd : today;
    return { term: term ? { _id: String(term._id), name: term.name } : null, from, to };
  }

  private async rows(classId: string, settings: any, from: Date, to: Date) {
    const days = workingDatesBetween(settings, from, to).map(dayKey);
    const students: any[] = await this.studentModel
      .find({ classId: new Types.ObjectId(String(classId)), isActive: true })
      .select('name registrationDate')
      .sort({ name: 1 })
      .lean()
      .exec();
    const absences: any[] = students.length
      ? await this.attendanceModel
          .find({ studentId: { $in: students.map((s) => s._id) }, date: { $gte: from, $lte: to } })
          .select('studentId date excuseStatus')
          .lean()
          .exec()
      : [];
    const byStudent = new Map<string, AbsenceDay[]>();
    for (const a of absences) {
      const k = String(a.studentId);
      if (!byStudent.has(k)) byStudent.set(k, []);
      byStudent.get(k)!.push({ date: dayKey(a.date), excuseStatus: a.excuseStatus ?? null });
    }
    const limit = settings?.absenceAlertDays ?? null;
    return {
      days,
      limit,
      students: students.map((s) => {
        const row = studentRow(days, byStudent.get(String(s._id)) ?? [], s.registrationDate ? dayKey(s.registrationDate) : null);
        return { studentId: String(s._id), name: s.name, ...row, overLimit: overLimit(row.unexcusedDays, limit) };
      }),
    };
  }

  async attendanceRegister(query: { classId: string; from?: string; to?: string }, user: any) {
    const klass = await this.assertMayRead(query.classId, user);
    const settings = await this.settingsOf(user?.schoolId);
    const window = await this.termWindow(settings);
    for (const d of [query.from, query.to]) {
      if (d && !DATE_RE.test(d)) throw new BadRequestException('صيغة التاريخ YYYY-MM-DD');
    }
    const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : window.from;
    const to = query.to ? new Date(`${query.to}T00:00:00.000Z`) : window.to;
    if (from > to) throw new BadRequestException('تاريخ البداية بعد تاريخ النهاية');
    if ((to.getTime() - from.getTime()) / 86400000 > MAX_DAYS) {
      throw new BadRequestException(`أقصى مدة للسجل ${MAX_DAYS} يومًا`);
    }
    const { days, limit, students } = await this.rows(query.classId, settings, from, to);
    return {
      status: true,
      message: 'تم استرجاع سجل الحضور',
      data: { classId: String(query.classId), className: klass.name, from: dayKey(from), to: dayKey(to), term: window.term, absenceAlertDays: limit, days, students },
    };
  }

  async classSummary(classId: string, user: any) {
    const klass = await this.assertMayRead(classId, user);
    const settings = await this.settingsOf(user?.schoolId);
    const window = await this.termWindow(settings);
    const { days, limit, students } = await this.rows(classId, settings, window.from, window.to);

    const counted = students.reduce((a, s) => a + s.countedDays, 0);
    const present = students.reduce((a, s) => a + s.presentDays, 0);
    const over = students.filter((s) => s.overLimit);

    // Grades come from the annual register, admins only, ministry schools only.
    let grades: { averageGrade: number | null; passRate: number | null; gradedEntries: number } | null = null;
    if (this.gradeRegister && ADMIN_ROLES.includes(user?.role) && (await gradingSystemOf(this.studentModel.db, user?.schoolId)) === 'ministry') {
      const report: any = await this.gradeRegister.classReport(classId, window.term?._id, user).catch(() => null);
      if (report?.data) grades = gradeFigures(report.data.students ?? []);
    }

    return {
      status: true,
      message: 'تم استرجاع ملخص الفصل',
      data: {
        classId: String(classId),
        className: klass.name,
        term: window.term,
        from: dayKey(window.from),
        to: dayKey(window.to),
        schoolDays: days.length,
        studentCount: students.length,
        attendanceRate: counted ? Math.round((present / counted) * 1000) / 10 : null,
        absenceAlertDays: limit,
        overLimitCount: limit ? over.length : null,
        overLimit: over.map((s) => ({ studentId: s.studentId, name: s.name, unexcusedDays: s.unexcusedDays, absentDays: s.absentDays })),
        averageGrade: grades?.averageGrade ?? null,
        passRate: grades?.passRate ?? null,
        gradesAvailable: grades !== null && grades.gradedEntries > 0,
      },
    };
  }
}
