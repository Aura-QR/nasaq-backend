import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TeacherAbsenceExcuse } from './schemas/teacher-absence-excuse.schema';
import { TeacherAttendance } from './schemas/teacher-attendance.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { Admin } from '../admin/schemas/admin.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizeDate, workingDatesBetween } from '../attendance/attendance.utils';
import {
  ListAbsenceExcusesDto,
  ReviewAbsenceExcuseDto,
  SubmitAbsenceExcuseDto,
} from './dto/absence-excuse.dto';

/**
 * أعذار غياب المعلمين.
 *
 * A teacher who is late can already explain herself; a teacher who missed a
 * whole day could not. The school saw a name on the absence report and had
 * to ask by phone, or not ask at all.
 *
 * Deliberately separate from the attendance calculation. Nothing here is
 * read by `findAbsent` or by the monthly summary's absence count: an excused
 * day is still an absence, marked as excused. The school asked for the
 * conversation, not for the number to change — and a feature that quietly
 * edits attendance figures is one nobody can audit.
 */
@Injectable()
export class TeacherAbsenceExcuseService {
  private readonly logger = new Logger(TeacherAbsenceExcuseService.name);

  constructor(
    @InjectModel(TeacherAbsenceExcuse.name)
    private readonly excuseModel: Model<TeacherAbsenceExcuse>,
    @InjectModel(TeacherAttendance.name)
    private readonly attendanceModel: Model<TeacherAttendance>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(School.name)
    private readonly schoolModel: Model<School>,
    @InjectModel(Admin.name)
    private readonly adminModel: Model<Admin>,
    private readonly notifications: NotificationsService,
  ) {}

  /** Everyone at the school who should see a teacher's explanation. */
  private async schoolAdminIds(schoolId: any): Promise<string[]> {
    if (!schoolId) return [];
    const admins = await this.adminModel
      .find({
        schoolId: new Types.ObjectId(String(schoolId)),
        role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] },
      })
      .select('_id')
      .lean()
      .exec();
    return admins.map((a: any) => String(a._id));
  }

  private async settingsOf(schoolId: any): Promise<any | null> {
    if (!schoolId) return null;
    const school: any = await this.schoolModel
      .findById(schoolId)
      .select('settings')
      .lean()
      .exec();
    return school?.settings ?? null;
  }

  private static toObjectId(value: unknown): Types.ObjectId | null {
    const raw = String(value ?? '');
    return Types.ObjectId.isValid(raw) ? new Types.ObjectId(raw) : null;
  }

  private static dateLabel(d: Date): string {
    return normalizeDate(d).toISOString().slice(0, 10);
  }

  /**
   * The days this teacher was away and has not explained.
   *
   * Recent rather than today only: somebody off sick for three days answers
   * once, when she is back, and the other two days have to still be there to
   * answer. Days off and school holidays are excluded by
   * `workingDatesBetween`, so a Friday never appears as something to explain.
   */
  async pendingDays(user: any, days = 14) {
    const teacherId = TeacherAbsenceExcuseService.toObjectId(user?.userId);
    if (!teacherId) throw new BadRequestException('حساب غير صالح');

    const to = normalizeDate(new Date());
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (days - 1));

    const settings = await this.settingsOf(user?.schoolId);
    const workingDays = workingDatesBetween(settings, from, to);
    if (workingDays.length === 0) {
      return { status: true, message: 'لا توجد أيام عمل في هذه المدة', data: [] };
    }

    const [present, explained] = await Promise.all([
      this.attendanceModel
        .find({ teacherId, date: { $gte: from, $lte: to } })
        .select('date')
        .lean()
        .exec(),
      this.excuseModel
        .find({ teacherId, date: { $gte: from, $lte: to } })
        .select('date')
        .lean()
        .exec(),
    ]);

    const seen = new Set<string>([
      ...present.map((r: any) => TeacherAbsenceExcuseService.dateLabel(r.date)),
      ...explained.map((r: any) => TeacherAbsenceExcuseService.dateLabel(r.date)),
    ]);

    const data = workingDays
      .map((d) => TeacherAbsenceExcuseService.dateLabel(d))
      .filter((label) => !seen.has(label))
      // Newest first: the day she is most likely answering for.
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date }));

    return { status: true, message: 'أيام غياب بلا عذر', data };
  }

  /**
   * The teacher's own account of a day she missed.
   *
   * Written once. An explanation a manager has already read and ruled on
   * cannot be quietly rewritten afterwards — the unique index says so too.
   */
  async submit(user: any, dto: SubmitAbsenceExcuseDto) {
    const teacherId = TeacherAbsenceExcuseService.toObjectId(user?.userId);
    if (!teacherId) throw new BadRequestException('حساب غير صالح');

    const date = normalizeDate(dto.date);
    const today = normalizeDate(new Date());
    if (date > today) {
      // An excuse is an account of something that happened. A future day has
      // not happened, and leaving before the day is استئذان, which already
      // has its own flow with its own approval.
      throw new BadRequestException(
        'لا يمكن تقديم عذر عن يوم لم يأتِ بعد — استخدم طلب الاستئذان',
      );
    }

    const settings = await this.settingsOf(user?.schoolId);
    if (workingDatesBetween(settings, date, date).length === 0) {
      throw new BadRequestException('هذا اليوم ليس يوم عمل');
    }

    const attended = await this.attendanceModel
      .findOne({ teacherId, date })
      .select('_id')
      .lean()
      .exec();
    if (attended) {
      // She was here. If she arrived late, the lateness flow is the one that
      // takes an explanation for that.
      throw new BadRequestException(
        'لديك سجل حضور في هذا اليوم — عذر التأخير هو المناسب هنا',
      );
    }

    const existing = await this.excuseModel
      .findOne({ teacherId, date })
      .select('_id status')
      .lean()
      .exec();
    if (existing) {
      throw new ConflictException('تم إرسال عذر عن هذا اليوم بالفعل');
    }

    const teacher: any = await this.teacherModel
      .findById(teacherId)
      .select('name')
      .lean()
      .exec();

    const reason = dto.reason.trim();
    const excuse = await this.excuseModel.create({
      teacherId,
      teacherName: teacher?.name ?? '',
      date,
      reason,
      attachment: dto.attachment ?? null,
      submittedAt: new Date(),
      status: 'pending',
    });

    await this.announce(excuse, user?.schoolId);

    return {
      status: true,
      message: 'تم إرسال عذر الغياب إلى إدارة المدرسة',
      data: {
        id: String(excuse._id),
        date: TeacherAbsenceExcuseService.dateLabel(date),
        status: excuse.status,
      },
    };
  }

  /**
   * Tell the school. Never throws: an excuse that was saved must not be
   * reported as failed because a push did not go out.
   */
  private async announce(excuse: any, schoolId: any) {
    try {
      const admins = await this.schoolAdminIds(schoolId);
      const dateLabel = TeacherAbsenceExcuseService.dateLabel(excuse.date);
      const name = excuse.teacherName || 'المعلم';

      await Promise.all(
        admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'teacher_absence_excuse_submitted',
            title: `عذر غياب ${name}`,
            body: `${dateLabel} — ${excuse.reason}`,
            data: {
              excuseId: String(excuse._id),
              teacherId: String(excuse.teacherId),
              teacherName: name,
              date: dateLabel,
              reason: excuse.reason,
              hasAttachment: Boolean(excuse.attachment),
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Could not announce absence excuse ${excuse?._id}: ${error?.message}`,
      );
    }
  }

  /** The school's queue, pending by default. */
  async list(filters: ListAbsenceExcusesDto, schoolId?: any) {
    const query: any = { status: filters.status ?? 'pending' };

    if (filters.teacherId) {
      const id = TeacherAbsenceExcuseService.toObjectId(filters.teacherId);
      if (!id) throw new BadRequestException('معرّف المعلم غير صالح');
      query.teacherId = id;
    }

    if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = normalizeDate(filters.from);
      if (filters.to) query.date.$lte = normalizeDate(filters.to);
    }

    const rows = await this.excuseModel
      .find(query)
      .sort({ submittedAt: -1 })
      .lean()
      .exec();

    return {
      status: true,
      message: 'تم استرجاع أعذار الغياب',
      data: rows.map((r: any) => ({
        id: String(r._id),
        teacherId: String(r.teacherId),
        teacherName: r.teacherName,
        date: TeacherAbsenceExcuseService.dateLabel(r.date),
        reason: r.reason,
        attachment: r.attachment,
        status: r.status,
        submittedAt: r.submittedAt,
        reviewedByName: r.reviewedByName,
        reviewedAt: r.reviewedAt,
        reviewNote: r.reviewNote,
      })),
    };
  }

  /** Accept or refuse. The teacher is told either way. */
  async review(id: string, user: any, dto: ReviewAbsenceExcuseDto) {
    const excuseId = TeacherAbsenceExcuseService.toObjectId(id);
    if (!excuseId) throw new BadRequestException('معرّف العذر غير صالح');

    const excuse = await this.excuseModel.findById(excuseId);
    if (!excuse) throw new NotFoundException('العذر غير موجود');
    if (excuse.status !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا العذر بالفعل');
    }

    const note = (dto.note ?? '').trim();
    // A refusal with no reason is the one thing a teacher cannot answer.
    if (dto.verdict === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض العذر');
    }

    excuse.status = dto.verdict;
    excuse.reviewedBy = TeacherAbsenceExcuseService.toObjectId(user?.userId);
    excuse.reviewedByName = user?.name ?? '';
    excuse.reviewedAt = new Date();
    excuse.reviewNote = note;
    await excuse.save();

    const dateLabel = TeacherAbsenceExcuseService.dateLabel(excuse.date);
    const accepted = dto.verdict === 'accepted';

    // Never let a failed notice undo a saved ruling.
    try {
      await this.notifications.notify({
        recipientId: excuse.teacherId,
        type: 'teacher_absence_excuse_reviewed',
        title: accepted ? 'تم قبول عذر الغياب' : 'لم يُقبل عذر الغياب',
        body: [`غياب ${dateLabel}`, note].filter(Boolean).join(' — '),
        data: {
          excuseId: String(excuse._id),
          date: dateLabel,
          status: excuse.status,
          note,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Could not announce excuse verdict on ${excuse._id}: ${error?.message}`,
      );
    }

    return {
      status: true,
      message: accepted ? 'تم قبول العذر' : 'تم رفض العذر',
      data: {
        id: String(excuse._id),
        status: excuse.status,
        reviewNote: excuse.reviewNote,
        reviewedAt: excuse.reviewedAt,
      },
    };
  }

  /**
   * Excused days for a set of teachers over a range, keyed by teacher id.
   *
   * Read by the monthly summary so an absence can be shown as excused. The
   * absence count itself is untouched: three absences with accepted excuses
   * stay three absences, marked.
   */
  async excusedByTeacher(from: Date, to: Date): Promise<Map<string, number>> {
    const rows = await this.excuseModel
      .find({ date: { $gte: normalizeDate(from), $lte: normalizeDate(to) }, status: 'accepted' })
      .select('teacherId')
      .lean()
      .exec();

    const counts = new Map<string, number>();
    for (const row of rows as any[]) {
      const key = String(row.teacherId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}
