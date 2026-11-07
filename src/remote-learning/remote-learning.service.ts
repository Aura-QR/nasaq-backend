import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RemoteDay } from './schemas/remote-day.schema';
import { RemoteLessonLink } from './schemas/remote-lesson-link.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Class } from '../classes/schemas/class.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { Stage } from '../stages/schemas/stage.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Student } from '../students/schemas/student.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { currentScope, currentTermFilter } from '../terms/current-scope.util';
import { parseDateOnly } from '../preparation/utils/week.util';
import { todayAtSchool } from '../common/utils/school-date.util';
import { CreateRemoteDayDto } from './dto';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ADMIN_ROLES = ['OWNER', 'MANAGER', 'SUPERVISOR', 'SUPER_ADMIN'];
const id = (v: any) => String(v?._id ?? v ?? '');
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Remote learning without a meeting provider.
 *
 * The school declares remote days; each teacher keeps one standing meeting
 * link (Teams, Zoom, Meet) and may set another for a single lesson. On a
 * remote day every lesson of the affected classes carries a join link, which
 * the student sees on their day's lessons, and the teacher may check in
 * from home. Creating Teams meetings automatically can later fill the same
 * links without the school doing anything differently.
 */
@Injectable()
export class RemoteLearningService {
  private readonly logger = new Logger(RemoteLearningService.name);

  constructor(
    @InjectModel(RemoteDay.name) private readonly days: Model<RemoteDay>,
    @InjectModel(RemoteLessonLink.name) private readonly links: Model<RemoteLessonLink>,
    @InjectModel(Lecture.name) private readonly lectures: Model<Lecture>,
    @InjectModel(Class.name) private readonly classes: Model<Class>,
    @InjectModel(GradeLevel.name) private readonly grades: Model<GradeLevel>,
    @InjectModel(Stage.name) private readonly stages: Model<Stage>,
    @InjectModel(Teacher.name) private readonly teachers: Model<Teacher>,
    @InjectModel(Student.name) private readonly students: Model<Student>,
    private readonly notifications: NotificationsService,
  ) {}

  private day(value?: string): Date {
    return parseDateOnly(value || todayAtSchool(), 'date');
  }

  // ───────────────────────────────────────────── remote days (administration)

  async listDays() {
    const rows: any[] = await this.days.find().sort({ startDate: -1 }).lean();
    const stageNames = new Map(
      ((await this.stages.find().select('name').lean()) as any[]).map((s) => [id(s), s.name]),
    );
    return {
      data: rows.map((r) => ({
        _id: id(r),
        startDate: dayKey(new Date(r.startDate)),
        endDate: dayKey(new Date(r.endDate)),
        stageIds: (r.stageIds || []).map(id),
        stageNames: (r.stageIds || []).map((s: any) => stageNames.get(id(s)) || ''),
        note: r.note || '',
      })),
    };
  }

  async createDay(dto: CreateRemoteDayDto, user: any) {
    const startDate = parseDateOnly(dto.startDate, 'startDate');
    const endDate = parseDateOnly(dto.endDate || dto.startDate, 'endDate');
    if (endDate < startDate) throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
    if ((endDate.getTime() - startDate.getTime()) / 86400000 > 60) {
      throw new BadRequestException('المدة لا تتجاوز ٦٠ يومًا في المرة الواحدة');
    }
    const stageIds = [...new Set((dto.stageIds || []).map(String))];
    if (stageIds.length && (await this.stages.countDocuments({ _id: { $in: stageIds } })) !== stageIds.length) {
      throw new BadRequestException('مرحلة غير موجودة');
    }
    const row = await this.days.create({
      startDate, endDate, stageIds, note: (dto.note || '').trim(),
      createdBy: Types.ObjectId.isValid(user?.userId) ? new Types.ObjectId(user.userId) : null,
    });
    // Told in the background: hundreds of pushes must not hold the request.
    void this.announce(row).catch((e) => this.logger.error(`announce remote day: ${e.message}`));
    return { message: 'تم تحديد أيام التعليم عن بُعد وإشعار الطلاب والمعلمين', data: row };
  }

  async deleteDay(dayId: string) {
    if (!Types.ObjectId.isValid(dayId)) throw new BadRequestException('معرّف غير صالح');
    const removed = await this.days.findByIdAndDelete(dayId).lean();
    if (!removed) throw new NotFoundException('اليوم غير موجود');
    return { message: 'تم إلغاء التعليم عن بُعد لهذه الأيام' };
  }

  /** Classes of these stages (all classes when none), in the current year's terms' lectures. */
  private async classIdsOfStages(stageIds: string[]): Promise<string[]> {
    const grades: any[] = await this.grades.find(stageIds.length ? { stageId: { $in: stageIds } } : {}).select('_id').lean();
    const classes: any[] = await this.classes.find({ gradeLevelId: { $in: grades.map((g) => g._id) } }).select('_id').lean();
    return classes.map(id);
  }

  private async announce(row: any) {
    const stageIds = (row.stageIds || []).map(id);
    const classIds = await this.classIdsOfStages(stageIds);
    if (!classIds.length) return;
    const fmt = (d: Date) => new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d);
    const when = dayKey(row.startDate) === dayKey(row.endDate) ? `يوم ${fmt(row.startDate)}` : `من ${fmt(row.startDate)} إلى ${fmt(row.endDate)}`;
    const data = { startDate: dayKey(row.startDate), endDate: dayKey(row.endDate) };

    const students: any[] = await this.students.find({ classId: { $in: classIds }, isActive: true }).select('_id').lean();
    for (const s of students) {
      await this.notifications.notify({
        recipientId: s._id, type: 'remote_day_announced' as any, title: 'تعليم عن بُعد',
        body: `الدراسة عن بُعد ${when}. روابط الحصص تظهر في «حصص اليوم عن بُعد».`, data,
      });
    }
    const scope = currentTermFilter(await currentScope(this.lectures.db));
    const teacherIds: any[] = await this.lectures.distinct('teacherId', { ...scope, classId: { $in: classIds } });
    for (const t of teacherIds.filter(Boolean)) {
      await this.notifications.notify({
        recipientId: t, type: 'remote_day_announced' as any, title: 'تعليم عن بُعد',
        body: `الدراسة عن بُعد ${when}. تأكد من إضافة رابط حصتك في نسق، ويمكنك تسجيل الحضور من خارج المدرسة.`, data,
      });
    }
  }

  // ───────────────────────────────────────────── links

  async setMyMeetingUrl(user: any, meetingUrl: string) {
    if (user?.role !== 'TEACHER') throw new ForbiddenException();
    await this.teachers.updateOne({ _id: user.userId }, { $set: { meetingUrl: meetingUrl.trim() } });
    return { message: meetingUrl.trim() ? 'تم حفظ رابط حصتك' : 'تم حذف رابط حصتك', data: { meetingUrl: meetingUrl.trim() } };
  }

  async setTeacherMeetingUrl(teacherId: string, meetingUrl: string) {
    if (!Types.ObjectId.isValid(teacherId)) throw new BadRequestException('معرّف غير صالح');
    const res = await this.teachers.updateOne({ _id: teacherId }, { $set: { meetingUrl: meetingUrl.trim() } });
    if (!res.matchedCount) throw new NotFoundException('المعلم غير موجود');
    return { message: 'تم حفظ رابط المعلم', data: { meetingUrl: meetingUrl.trim() } };
  }

  /** Active teachers and their standing links, for the administration. */
  async teacherLinks() {
    const rows: any[] = await this.teachers.find({ isActive: true, serviceEndedAt: null }).select('name meetingUrl').sort({ name: 1 }).lean();
    return { data: rows.map((t) => ({ _id: id(t), name: t.name, meetingUrl: t.meetingUrl || '' })) };
  }

  async setLessonLink(user: any, lectureId: string, date: string, joinUrl: string) {
    if (!Types.ObjectId.isValid(lectureId)) throw new BadRequestException('معرّف غير صالح');
    const lecture: any = await this.lectures.findById(lectureId).select('teacherId').lean();
    if (!lecture) throw new NotFoundException('الحصة غير موجودة');
    if (!ADMIN_ROLES.includes(user?.role) && !(user?.role === 'TEACHER' && id(lecture.teacherId) === String(user.userId))) {
      throw new ForbiddenException('هذه ليست حصتك');
    }
    const day = this.day(date);
    if (!joinUrl.trim()) {
      await this.links.deleteOne({ lectureId: new Types.ObjectId(lectureId), date: day });
      return { message: 'تم حذف رابط الحصة؛ يُستخدم رابطك الثابت' };
    }
    await this.links.updateOne(
      { lectureId: new Types.ObjectId(lectureId), date: day },
      { $set: { joinUrl: joinUrl.trim(), setBy: Types.ObjectId.isValid(user?.userId) ? new Types.ObjectId(user.userId) : null } },
      { upsert: true },
    );
    return { message: 'تم حفظ رابط الحصة' };
  }

  // ───────────────────────────────────────────── a day's remote lessons

  /** Remote days covering this date. */
  private daysOn(day: Date) {
    return this.days.find({ startDate: { $lte: day }, endDate: { $gte: day } }).lean();
  }

  /** stageId per class id. */
  private async stageOfClasses(classIds: string[]): Promise<Map<string, string>> {
    const classes: any[] = await this.classes.find({ _id: { $in: classIds } }).select('gradeLevelId').lean();
    const grades: any[] = await this.grades.find({ _id: { $in: classes.map((c) => c.gradeLevelId).filter(Boolean) } }).select('stageId').lean();
    const stageOfGrade = new Map(grades.map((g) => [id(g), id(g.stageId)]));
    return new Map(classes.map((c) => [id(c), stageOfGrade.get(id(c.gradeLevelId)) || '']));
  }

  private covers(remoteDays: any[], stageId: string) {
    return remoteDays.some((d) => !(d.stageIds || []).length || (d.stageIds || []).some((s: any) => id(s) === stageId));
  }

  /**
   * The remote lessons of a day for a teacher or a student, with join links.
   * `remote` is false (and `lessons` empty) on an ordinary day.
   */
  async lessonsOn(user: any, date?: string) {
    const day = this.day(date);
    const remoteDays: any[] = await this.daysOn(day);
    const base = { date: dayKey(day), remote: false, lessons: [] as any[] };
    if (!remoteDays.length) return { data: base };

    const filter: any = { ...currentTermFilter(await currentScope(this.lectures.db)), dayOfWeek: DAY_NAMES[day.getUTCDay()] };
    if (user?.role === 'TEACHER') filter.teacherId = new Types.ObjectId(user.userId);
    else if (user?.role === 'STUDENT') {
      const student: any = await this.students.findById(user.userId).select('classId').lean();
      if (!student?.classId) return { data: base };
      filter.classId = student.classId;
    } else throw new ForbiddenException();

    const lectures: any[] = await this.lectures.find(filter)
      .populate('classId', 'name')
      .populate({ path: 'subjectOfferingId', select: 'subjectId', populate: { path: 'subjectId', select: 'subjectName isActivity' } })
      .populate('teacherId', 'name meetingUrl')
      .sort({ slot: 1 })
      .lean();
    const stageOf = await this.stageOfClasses([...new Set(lectures.map((l) => id(l.classId)))]);
    const remote = lectures.filter((l) => this.covers(remoteDays, stageOf.get(id(l.classId)) || ''));
    if (!remote.length) return { data: base };

    const overrides = new Map(
      ((await this.links.find({ lectureId: { $in: remote.map((l) => l._id) }, date: day }).lean()) as any[])
        .map((o) => [id(o.lectureId), o.joinUrl]),
    );
    return {
      data: {
        ...base,
        remote: true,
        note: remoteDays.map((d) => d.note).filter(Boolean).join(' · '),
        lessons: remote.map((l) => {
          const lesson = overrides.get(id(l)) || '';
          const standing = l.teacherId?.meetingUrl || '';
          return {
            lectureId: id(l),
            slot: l.slot,
            subjectName: l.subjectOfferingId?.subjectId?.subjectName || '',
            className: l.classId?.name || '',
            teacherName: l.teacherId?.name || '',
            joinUrl: lesson || standing,
            linkSource: lesson ? 'lesson' : standing ? 'teacher' : null,
          };
        }),
      },
    };
  }

  /**
   * Is today a remote day for this teacher — the whole school, or a stage
   * they teach today? Lets them check in from home.
   */
  async isRemoteDayForTeacher(teacherId: string, date: Date): Promise<boolean> {
    const remoteDays: any[] = await this.daysOn(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
    if (!remoteDays.length) return false;
    if (remoteDays.some((d) => !(d.stageIds || []).length)) return true;
    const classIds: any[] = await this.lectures.distinct('classId', {
      ...currentTermFilter(await currentScope(this.lectures.db)),
      teacherId: new Types.ObjectId(teacherId),
    });
    const stageOf = await this.stageOfClasses(classIds.map(String));
    return [...stageOf.values()].some((s) => this.covers(remoteDays, s));
  }
}
