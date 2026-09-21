import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LessonObservation } from './schemas/lesson-observation.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Term } from '../terms/schemas/term.schema';
import { Substitution } from '../duty/schemas/substitution.schema';
import { TeacherAttendance } from '../teacher-attendance/schemas/teacher-attendance.schema';
import { Admin } from '../admin/schemas/admin.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ExplainObservationDto,
  ListObservationsDto,
  RecordObservationDto,
  ReviewObservationDto,
} from './dto/lesson-observation.dto';

const WEEKDAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
];

/** Midnight UTC for the calendar day, which is how every date here is keyed. */
function dayStart(value?: string | Date): Date {
  const raw = value ?? new Date();
  const parsed =
    typeof raw === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? `${raw.trim()}T00:00:00.000Z` : raw)
      : new Date(raw);
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

const label = (date: Date) => date.toISOString().slice(0, 10);

@Injectable()
export class LessonObservationsService {
  private readonly logger = new Logger(LessonObservationsService.name);

  constructor(
    @InjectModel(LessonObservation.name)
    private readonly observationModel: Model<LessonObservation>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    @InjectModel(Substitution.name)
    private readonly substitutionModel: Model<Substitution>,
    @InjectModel(TeacherAttendance.name)
    private readonly teacherAttendanceModel: Model<TeacherAttendance>,
    @InjectModel(Admin.name) private readonly adminModel: Model<Admin>,
    private readonly notifications: NotificationsService,
  ) {}

  private async schoolAdminIds(schoolId: any, exclude?: any): Promise<string[]> {
    if (!schoolId) return [];

    const admins = await this.adminModel
      .find({
        schoolId: new Types.ObjectId(String(schoolId)),
        role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] },
      })
      .select('_id')
      .setOptions({ skipTenantScope: true })
      .lean()
      .exec();

    const skip = exclude ? String(exclude) : null;
    return admins.map((a: any) => String(a._id)).filter((id) => id !== skip);
  }

  // ───────────────────────────────────────────────────── the round

  /**
   * The day's lessons, each with whatever has already been written about it.
   *
   * One call rather than a timetable the client then decorates: the supervisor
   * is walking a corridor on a phone, and a screen that needs three requests
   * to say whether this room has been visited is a screen they stop using.
   *
   * Cover is included because a lesson the office already reassigned is not an
   * absence to report. Without it the supervisor writes up a teacher who was
   * never expected, and the teacher gets a notice about a lesson that was
   * taken off them.
   */
  async round(dateStr: string | undefined, user: any) {
    const date = dayStart(dateStr);
    const weekday = WEEKDAYS[date.getUTCDay()];

    const term: any = await this.termModel
      .findOne({ status: 'active' })
      .lean()
      .exec();

    const filter: any = { dayOfWeek: weekday };
    if (term) filter.termId = term._id;

    const [lectures, observations, covers, checkIns]: any[] = await Promise.all([
      this.lectureModel
        .find(filter)
        .populate('classId', 'name roomNumber')
        .populate('teacherId', 'name')
        .populate({
          path: 'subjectOfferingId',
          populate: [{ path: 'subjectId', select: 'subjectName' }],
        })
        .lean()
        .exec(),
      this.observationModel.find({ date }).lean().exec(),
      this.substitutionModel.find({ date }).lean().exec(),
      this.teacherAttendanceModel.find({ date }).select('teacherId').lean().exec(),
    ]);

    const seen = new Map<string, any>(
      observations.map((row: any) => [String(row.lectureId), row]),
    );
    const covered = new Map<string, any>(
      covers.map((row: any) => [String(row.lectureId), row]),
    );

    /*
     * Who has clocked in today.
     *
     * A supervisor walking a corridor cannot know this, and without it they
     * write up a teacher for reaching the fourth period late when that
     * teacher never came in at all — and the notice goes to someone at home.
     *
     * A signal, never a lock. The supervisor is standing in front of the
     * room; a missing row in a table is weaker evidence than their eyes. A
     * teacher who forgot to clock in, or whose GPS failed, is still teaching.
     *
     * On a morning nobody has clocked in yet — or in a school not using
     * check-in at all — this would flag every teacher, which is noise. So it
     * reports null and the clients show nothing.
     */
    const checkedInIds = new Set<string>(
      checkIns.map((row: any) => String(row.teacherId)),
    );
    const checkInInUse = checkIns.length > 0;

    const items = lectures
      .map((lecture: any) => {
        const id = String(lecture._id);
        const row = seen.get(id);
        const cover = covered.get(id);

        return {
          lectureId: id,
          slot: lecture.slot,
          className: lecture.classId?.name ?? '',
          roomNumber: lecture.classId?.roomNumber ?? '',
          subjectName:
            lecture.subjectOfferingId?.subjectId?.subjectName ?? '',
          teacherId: lecture.teacherId?._id
            ? String(lecture.teacherId._id)
            : null,
          teacherName: lecture.teacherId?.name ?? '',
          // Who is actually expected in the room, which is not always the
          // teacher on the timetable.
          coveredBy: cover ? cover.substituteTeacherName : null,
          // true, false, or null when the school is not using check-in today.
          teacherCheckedIn:
            !checkInInUse || !lecture.teacherId
              ? null
              : checkedInIds.has(String(lecture.teacherId._id)),
          observation: row
            ? {
                id: String(row._id),
                status: row.status,
                lateMinutes: row.lateMinutes,
                observedAt: row.observedAt,
                note: row.note,
                recordedByName: row.recordedByName,
              }
            : null,
        };
      })
      .sort((a, b) => a.slot - b.slot || a.className.localeCompare(b.className, 'ar'));

    return {
      status: true,
      data: {
        date: label(date),
        dayOfWeek: weekday,
        termName: term?.name ?? null,
        checkInInUse,
        total: items.length,
        visited: items.filter((item) => item.observation).length,
        late: items.filter((item) => item.observation?.status === 'late').length,
        absent: items.filter((item) => item.observation?.status === 'absent').length,
        items,
      },
    };
  }

  // ───────────────────────────────────────────────────── recording

  /**
   * Write down one classroom, or correct what was written.
   *
   * An upsert on (lecture, day): two supervisors walk the same corridor, and
   * without this the teacher is notified twice and one absence is counted as
   * two. The second write wins and is treated as a correction.
   *
   * A record the teacher has already answered is frozen. Changing the
   * accusation under a reply leaves an answer to a question nobody asked.
   */
  async record(dto: RecordObservationDto, user: any) {
    const date = dayStart(dto.date);
    const weekday = WEEKDAYS[date.getUTCDay()];

    const lecture: any = await this.lectureModel
      .findById(dto.lectureId)
      .populate('classId', 'name')
      .populate('teacherId', 'name')
      .populate({
        path: 'subjectOfferingId',
        populate: [{ path: 'subjectId', select: 'subjectName' }],
      })
      .lean()
      .exec();

    if (!lecture) throw new NotFoundException('الحصة غير موجودة');

    // A lesson is only observable on the day it is taught. Without this a
    // typo in the date files Sunday's absence against Wednesday.
    if (lecture.dayOfWeek !== weekday) {
      throw new BadRequestException(
        `هذه الحصة ليست في يوم ${label(date)} — جدولها يوم ${lecture.dayOfWeek}`,
      );
    }

    const existing = await this.observationModel.findOne({
      lectureId: new Types.ObjectId(dto.lectureId),
      date,
    });

    if (existing?.reason) {
      throw new ConflictException(
        'لا يمكن تعديل الملاحظة بعد أن ردّ عليها المعلم',
      );
    }

    const lateMinutes =
      dto.status === 'late' ? (dto.lateMinutes ?? null) : null;

    // "HH:mm" against the observed day, so the clock time the supervisor read
    // survives as an instant.
    const observedAt = dto.observedAt
      ? new Date(`${label(date)}T${dto.observedAt}:00.000Z`)
      : new Date();

    const payload = {
      lectureId: new Types.ObjectId(dto.lectureId),
      date,
      teacherId: lecture.teacherId?._id ?? null,
      teacherName: lecture.teacherId?.name ?? '',
      className: lecture.classId?.name ?? '',
      subjectName: lecture.subjectOfferingId?.subjectId?.subjectName ?? '',
      slot: lecture.slot,
      dayOfWeek: weekday,
      status: dto.status,
      lateMinutes,
      observedAt,
      note: (dto.note ?? '').trim(),
      recordedBy: user?.userId ? new Types.ObjectId(String(user.userId)) : null,
      recordedByName: user?.name ?? '',
    };

    const saved = await this.observationModel
      .findOneAndUpdate(
        { lectureId: payload.lectureId, date },
        payload,
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // 'present' is a tick on a round sheet, not news. Telling a teacher they
    // were seen teaching is how a useful notice becomes noise.
    if (dto.status !== 'present') {
      await this.announce(saved, lateMinutes);
    }

    return {
      status: true,
      message:
        dto.status === 'present'
          ? 'تم تسجيل المرور'
          : 'تم تسجيل الملاحظة وإبلاغ المعلم',
      data: saved,
    };
  }

  /** Never throws: an observation that was written must stay written. */
  private async announce(row: any, lateMinutes: number | null) {
    if (!row.teacherId) return;

    const when = `${row.className} · الحصة ${row.slot} · ${label(new Date(row.date))}`;

    try {
      await this.notifications.notify({
        recipientId: row.teacherId,
        type: 'lesson_observation_recorded',
        title:
          row.status === 'late'
            ? 'سُجّل تأخرك عن حصة'
            : 'سُجّل عدم حضورك حصة',
        body: [
          when,
          row.status === 'late' && lateMinutes ? `تأخر ${lateMinutes} دقيقة` : null,
          row.note || null,
          'يمكنك بيان السبب من سجل الملاحظات.',
        ]
          .filter(Boolean)
          .join(' — '),
        data: {
          observationId: String(row._id),
          lectureId: String(row.lectureId),
          date: label(new Date(row.date)),
          status: row.status,
          lateMinutes,
          className: row.className,
          slot: row.slot,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Could not announce observation ${row._id}: ${error?.message}`,
      );
    }
  }

  // ───────────────────────────────────────────────────── the teacher

  /** Observations this teacher has not answered. */
  async minePending(user: any, days = 14) {
    const since = dayStart();
    since.setUTCDate(since.getUTCDate() - days);

    const rows = await this.observationModel
      .find({
        teacherId: new Types.ObjectId(String(user.userId)),
        status: { $in: ['late', 'absent'] },
        reason: null,
        date: { $gte: since },
      })
      .sort({ date: -1, slot: 1 })
      .lean()
      .exec();

    return {
      status: true,
      data: {
        pending: rows.length > 0,
        count: rows.length,
        items: rows.map((row: any) => ({
          observationId: String(row._id),
          date: label(new Date(row.date)),
          className: row.className,
          subjectName: row.subjectName,
          slot: row.slot,
          status: row.status,
          lateMinutes: row.lateMinutes,
          note: row.note,
        })),
      },
    };
  }

  /**
   * The teacher's account. Written once, like every other explanation here:
   * one a manager has read and ruled on must not change underneath them.
   */
  async explain(id: string, user: any, dto: ExplainObservationDto) {
    const row = await this.observationModel.findById(id);
    if (!row) throw new NotFoundException('الملاحظة غير موجودة');

    if (String(row.teacherId ?? '') !== String(user.userId)) {
      throw new ForbiddenException('هذه الملاحظة ليست عنك');
    }
    if (row.status === 'present') {
      throw new BadRequestException('لا توجد ملاحظة تستدعي ردًا');
    }
    if (row.reason) {
      throw new ConflictException('تم إرسال الرد على هذه الملاحظة بالفعل');
    }

    const reason = dto.reason.trim();
    row.reason = reason;
    row.reasonAt = new Date();
    row.reasonStatus = 'pending';
    await row.save();

    try {
      const admins = await this.schoolAdminIds(user.schoolId);
      await Promise.all(
        admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'lesson_observation_explained',
            title: `رد ${row.teacherName} على ملاحظة حصة`,
            body: `${row.className} · الحصة ${row.slot} · ${label(new Date(row.date))} — ${reason}`,
            data: {
              observationId: String(row._id),
              teacherId: String(row.teacherId),
              teacherName: row.teacherName,
              date: label(new Date(row.date)),
              reason,
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(`Could not announce explanation ${row._id}: ${error?.message}`);
    }

    return {
      status: true,
      message: 'تم إرسال ردك إلى إدارة المدرسة',
      data: { observationId: String(row._id), reason, reasonStatus: row.reasonStatus },
    };
  }

  // ───────────────────────────────────────────────────── the school

  /**
   * The log.
   *
   * 'unexplained' is its own filter: a lateness the teacher has not answered
   * is a different problem from one awaiting a ruling, and it is the one that
   * otherwise sits in the record unchallenged.
   */
  async list(filters: ListObservationsDto, page = 1, limit = 30) {
    const query: any = {};

    switch (filters.status) {
      case 'present':
      case 'late':
      case 'absent':
        query.status = filters.status;
        break;
      case 'pending':
        query.reason = { $ne: null };
        query.reasonStatus = 'pending';
        break;
      case 'unexplained':
        query.status = { $in: ['late', 'absent'] };
        query.reason = null;
        break;
      default:
        query.status = { $in: ['late', 'absent'] };
    }

    if (filters.teacherId) {
      query.teacherId = new Types.ObjectId(filters.teacherId);
    }
    if (filters.dateFrom || filters.dateTo) {
      query.date = {};
      if (filters.dateFrom) query.date.$gte = dayStart(filters.dateFrom);
      if (filters.dateTo) query.date.$lte = dayStart(filters.dateTo);
    }

    const skip = (Math.max(page, 1) - 1) * limit;

    const [rows, total] = await Promise.all([
      this.observationModel
        .find(query)
        .sort({ date: -1, slot: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.observationModel.countDocuments(query).exec(),
    ]);

    return {
      status: true,
      data: {
        page,
        limit,
        total,
        items: rows.map((row: any) => ({
          observationId: String(row._id),
          date: label(new Date(row.date)),
          teacherId: row.teacherId ? String(row.teacherId) : null,
          teacherName: row.teacherName,
          className: row.className,
          subjectName: row.subjectName,
          slot: row.slot,
          status: row.status,
          lateMinutes: row.lateMinutes,
          observedAt: row.observedAt,
          note: row.note,
          recordedByName: row.recordedByName,
          reason: row.reason,
          reasonStatus: row.reasonStatus,
          reasonReviewedByName: row.reasonReviewedByName,
          reasonReviewNote: row.reasonReviewNote,
        })),
      },
    };
  }

  /** Accept or refuse the teacher's account, and tell them which. */
  async review(id: string, user: any, dto: ReviewObservationDto) {
    const row = await this.observationModel.findById(id);
    if (!row) throw new NotFoundException('الملاحظة غير موجودة');
    if (!row.reason) throw new BadRequestException('لا يوجد رد لمراجعته');
    if (row.reasonStatus && row.reasonStatus !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا الرد بالفعل');
    }

    const note = (dto.note ?? '').trim();
    if (dto.verdict === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض العذر');
    }

    row.reasonStatus = dto.verdict;
    row.reasonReviewedBy = new Types.ObjectId(String(user.userId));
    row.reasonReviewedByName = user.name ?? '';
    row.reasonReviewedAt = new Date();
    row.reasonReviewNote = note;
    await row.save();

    const accepted = dto.verdict === 'accepted';

    try {
      if (row.teacherId) {
        await this.notifications.notify({
          recipientId: row.teacherId,
          type: 'lesson_observation_reviewed',
          title: accepted ? 'تم قبول عذرك' : 'لم يُقبل عذرك',
          body: [
            `${row.className} · الحصة ${row.slot} · ${label(new Date(row.date))}`,
            note,
          ]
            .filter(Boolean)
            .join(' — '),
          data: {
            observationId: String(row._id),
            date: label(new Date(row.date)),
            reasonStatus: row.reasonStatus,
            note,
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Could not announce verdict on ${row._id}: ${error?.message}`);
    }

    return {
      status: true,
      message: accepted ? 'تم قبول العذر' : 'تم رفض العذر',
      data: {
        observationId: String(row._id),
        reasonStatus: row.reasonStatus,
        reasonReviewNote: row.reasonReviewNote,
      },
    };
  }
}
