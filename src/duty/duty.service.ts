import { currentScope, currentTermFilter } from '../terms/current-scope.util';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { EARLY_LEAVE_ONLY, LeaveRequest } from './schemas/leave-request.schema';
import { resolveDaySchedule, workingDatesBetween } from '../attendance/attendance.utils';
import { schoolNow, worksOn } from '../teacher-attendance/teacher-presence.util';
import { DutySupervisor } from './schemas/duty-supervisor.schema';
import {
  COVER_ADMIN_ROLES,
  SubstituteType,
  Substitution,
} from './schemas/substitution.schema';
import { Admin } from '../admin/schemas/admin.schema';
import { StaffAttendance } from '../staff-attendance/schemas/staff-attendance.schema';
import { StaffLeaveRequest } from '../staff-attendance/schemas/staff-leave-request.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { TeacherAttendance } from '../teacher-attendance/schemas/teacher-attendance.schema';
import { Term } from '../terms/schemas/term.schema';
import { Class } from '../classes/schemas/class.schema';
import {
  CreateLeaveRequestDto,
  ReviewLeaveRequestDto,
} from './dto/leave-request.dto';
import { SetDutySupervisorsDto } from './dto/duty-supervisor.dto';
import { CreateSubstitutionDto } from './dto/substitution.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { adminsWhoCanRead } from '../notifications/admin-audience';
import { isActivityLecture } from '../subjects/activity.util';

/** Arabic weekday names, Sunday first — «الخميس 2026-12-03». */
const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** At most this many calendar days in one planned absence. */
const MAX_PLANNED_DAYS = 30;

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * A calendar day, not an instant. A lesson on the 2nd is on the 2nd in every
 * timezone, so days are anchored at UTC midnight and never shifted.
 */
function dayStart(value: string | Date): Date {
  const raw = typeof value === 'string' ? value.trim() : value;
  const parsed =
    typeof raw === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw)
      : raw;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`تاريخ غير صالح: "${value}"`);
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function toDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** An administrator is known by name when one was given, else by username. */
const adminName = (admin: any): string =>
  String(admin?.fullName || '').trim() || admin?.username || '';

interface ResolvedSubstitute {
  id: string;
  name: string;
  type: SubstituteType;
  role: string;
}

@Injectable()
export class DutyService {
  constructor(
    @InjectModel(LeaveRequest.name)
    private readonly leaveModel: Model<LeaveRequest>,
    @InjectModel(DutySupervisor.name)
    private readonly supervisorModel: Model<DutySupervisor>,
    @InjectModel(Substitution.name)
    private readonly substitutionModel: Model<Substitution>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(TeacherAttendance.name)
    private readonly attendanceModel: Model<TeacherAttendance>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(Admin.name) private readonly adminModel: Model<Admin>,
    @InjectModel(StaffAttendance.name)
    private readonly staffAttendanceModel: Model<StaffAttendance>,
    @InjectModel(StaffLeaveRequest.name)
    private readonly staffLeaveModel: Model<StaffLeaveRequest>,
    private readonly notifications: NotificationsService,
    // Optional: without it every administrator is told (adminsWhoCanRead).
    @Optional() private readonly permissions?: PermissionsService,
  ) {}

  // ───────────────────────────────────────────────── leave requests

  async createLeaveRequest(dto: CreateLeaveRequestDto, user: any) {
    // A teacher always files for themselves; only staff may file on behalf.
    const teacherId =
      user?.role === 'TEACHER' ? String(user.userId) : (dto.teacherId ?? null);

    if (!teacherId) {
      throw new BadRequestException('teacherId مطلوب عند تقديم الطلب نيابة عن معلم');
    }

    const teacher = await this.teacherModel.findById(teacherId).lean().exec();
    if (!teacher) {
      throw new NotFoundException(`المدرس ${teacherId} غير موجود`);
    }

    if (dto.kind === 'full_day') {
      return this.createPlannedAbsence(dto, teacher, user);
    }
    if (!dto.leaveAt) {
      throw new BadRequestException('leaveAt مطلوب في الاستئذان');
    }

    const date = dayStart(dto.date);

    const existing = await this.leaveModel.findOne({ teacherId, date }).exec();
    if (existing) {
      if (existing.status !== 'pending') {
        throw new BadRequestException(
          `تمت مراجعة استئذان هذا اليوم بالفعل (${existing.status}).`,
        );
      }
      // A second request for the same day is an edit of the first, not a
      // separate ask — the day has one answer.
      existing.kind = 'early_leave';
      existing.groupId = null;
      existing.leaveAt = dto.leaveAt;
      existing.fromSlot = dto.fromSlot ?? null;
      existing.reason = dto.reason ?? '';
      await existing.save();
      await this.announceLeaveRequest(existing, user, true);
      return { message: 'تم تحديث طلب الاستئذان', data: existing };
    }

    const created = await new this.leaveModel({
      teacherId,
      teacherName: (teacher as any).name ?? '',
      date,
      leaveAt: dto.leaveAt,
      fromSlot: dto.fromSlot ?? null,
      reason: dto.reason ?? '',
      status: 'pending',
    }).save();

    await this.announceLeaveRequest(created, user, false);
    return { message: 'تم إرسال طلب الاستئذان', data: created };
  }

  /** The school's settings block, or {} — for its week, holidays and timezone. */
  private async schoolSettings(schoolId: any): Promise<any> {
    const School = this.leaveModel.db?.models?.['School'];
    if (!School || !schoolId || !mongoose.Types.ObjectId.isValid(String(schoolId))) return {};
    const school: any = await School.findById(schoolId)
      .select('settings')
      .setOptions({ skipTenantScope: true })
      .lean()
      .exec();
    return school?.settings ?? {};
  }

  private static rangeLabel(dates: Date[]): string {
    const labels = dates.map((d) => toDateOnly(d) as string).sort();
    return labels.length > 1 ? `${labels[0]} إلى ${labels[labels.length - 1]}` : labels[0] ?? '';
  }

  /**
   * «غياب مسبق»: a whole day, or several, known ahead — one row per working
   * day she works, sharing a groupId. A teacher's request waits for review;
   * staff filing on her behalf are the approvers, so theirs is approved.
   * Nothing is written unless every day passes.
   */
  private async createPlannedAbsence(dto: CreateLeaveRequestDto, teacher: any, user: any) {
    const settings = await this.schoolSettings(user?.schoolId ?? teacher.schoolId);
    const today = schoolNow(settings?.timezone).date;
    const from = dayStart(dto.date);
    const to = dayStart(dto.dateTo ?? dto.date);

    if (from < today) {
      throw new BadRequestException('لا يُسجَّل غياب مسبق ليوم مضى؛ للأيام الماضية عذر الغياب');
    }
    if (to < from) {
      throw new BadRequestException('تاريخ النهاية يجب ألا يسبق تاريخ البداية');
    }
    const span = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (span > MAX_PLANNED_DAYS) {
      throw new BadRequestException(`الغياب المسبق لا يتجاوز ${MAX_PLANNED_DAYS} يومًا`);
    }

    // Weekends, holidays and her own days off are not absences.
    const days = workingDatesBetween(settings, from, to).filter((d) => worksOn(teacher.workDays, d));
    if (days.length === 0) {
      throw new BadRequestException('لا توجد أيام دوام في الفترة المحددة');
    }

    const existing: any[] = await this.leaveModel
      .find({ teacherId: teacher._id, date: { $in: days } })
      .exec();
    const reviewed = existing.find((r) => r.status !== 'pending');
    if (reviewed) {
      throw new BadRequestException(`يوجد طلب مراجَع بتاريخ ${toDateOnly(reviewed.date)}`);
    }

    const byStaff = user?.role !== 'TEACHER';
    const groupId = new mongoose.Types.ObjectId();
    const review = byStaff
      ? {
          status: 'approved',
          reviewedBy: user?.userId ?? null,
          reviewedByName: user?.name ?? user?.email ?? '',
          reviewedAt: new Date(),
        }
      : { status: 'pending' };
    const fields = {
      kind: 'full_day',
      groupId,
      leaveAt: null,
      fromSlot: null,
      reason: dto.reason ?? '',
      ...review,
    };

    // A pending request on one of these days becomes this one.
    const taken = new Set(existing.map((r) => toDateOnly(r.date)));
    if (existing.length) {
      await this.leaveModel.updateMany({ _id: { $in: existing.map((r) => r._id) } }, { $set: fields }).exec();
    }
    const fresh = days.filter((d) => !taken.has(toDateOnly(d)));
    if (fresh.length) {
      await this.leaveModel.insertMany(
        fresh.map((date) => ({ teacherId: teacher._id, teacherName: teacher.name ?? '', date, ...fields })),
      );
    }

    const rows: any[] = await this.leaveModel.find({ groupId }).sort({ date: 1 }).lean().exec();
    const label = DutyService.rangeLabel(days);

    try {
      if (byStaff) {
        await this.notifications.notify({
          recipientId: teacher._id,
          type: 'leave_approved',
          title: 'تم تسجيل غيابك المسبق',
          body: [label, dto.reason].filter(Boolean).join(' · '),
          data: {
            leaveRequestId: String(rows[0]?._id),
            groupId: String(groupId),
            kind: 'full_day',
            dates: rows.map((r) => toDateOnly(r.date)),
            status: 'approved',
          },
        });
      } else {
        await this.announcePlannedAbsence(rows, teacher, user, label);
      }
    } catch (error: any) {
      new Logger(DutyService.name).error(`Could not announce planned absence ${groupId}: ${error?.message}`);
    }

    return {
      message: byStaff ? 'تم تسجيل الغياب المسبق' : 'تم إرسال طلب الغياب',
      data: rows.map((r) => ({ ...r, date: toDateOnly(r.date), groupDays: rows.length })),
      groupId: String(groupId),
    };
  }

  /** One notice to the admins for the whole group. */
  private async announcePlannedAbsence(rows: any[], teacher: any, user: any, label: string) {
    const schoolId = user?.schoolId ?? rows[0]?.schoolId;
    if (!schoolId) return;
    const admins = await this.adminModel
      .find({ schoolId: new mongoose.Types.ObjectId(String(schoolId)), role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] } })
      .select('_id role jobTitleId')
      .setOptions({ skipTenantScope: true })
      .lean()
      .exec();
    const recipients = await adminsWhoCanRead(admins as any[], 'duty', schoolId, this.permissions);
    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.notify({
          recipientId,
          type: 'leave_requested',
          title: 'طلب غياب يوم كامل',
          body: [`${teacher.name ?? 'معلم'} · ${label}`, rows[0]?.reason].filter(Boolean).join(' — '),
          data: {
            leaveRequestId: String(rows[0]._id),
            groupId: String(rows[0].groupId),
            kind: 'full_day',
            teacherId: String(teacher._id),
            teacherName: teacher.name ?? '',
            dates: rows.map((r) => toDateOnly(r.date)),
          },
        }),
      ),
    );
  }

  /**
   * Covers already assigned for these days of this teacher. Never deleted
   * here: the screen asks the manager, and cancelling sends cover_removed.
   */
  private async affectedCovers(teacherId: any, dates: Date[]) {
    if (!dates.length) return [];
    const rows: any[] = await this.substitutionModel
      .find({ absentTeacherId: teacherId, date: { $in: dates } })
      .populate({ path: 'lectureId', select: 'slot' })
      .lean()
      .exec();
    return rows
      .map((r) => ({
        substitutionId: String(r._id),
        date: toDateOnly(r.date),
        slot: r.lectureId?.slot ?? null,
        substituteTeacherName: r.substituteTeacherName ?? '',
      }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.slot ?? 0) - (b.slot ?? 0));
  }

  /**
   * Tells the school's administrators a teacher asked to leave early.
   *
   * There was no notice at all: the request sat in the duty screen until
   * somebody happened to open it, and a teacher asking to leave at ten got
   * her answer after ten, if at all. Staff leave already notified; teachers
   * now match it. Whoever filed it on the teacher's behalf is not told.
   * Never throws: the request is saved whether or not the notice goes out.
   */
  private async announceLeaveRequest(request: any, user: any, updated: boolean) {
    try {
      const schoolId = user?.schoolId ?? request.schoolId;
      if (!schoolId) return;
      const admins = await this.adminModel
        .find({
          schoolId: new mongoose.Types.ObjectId(String(schoolId)),
          role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] },
        })
        .select('_id role jobTitleId')
        .setOptions({ skipTenantScope: true })
        .lean()
        .exec();
      const actor = user?.role === 'TEACHER' ? null : String(user?.userId ?? '');
      const recipients = (await adminsWhoCanRead(admins as any[], 'duty', schoolId, this.permissions)).filter(
        (id) => id !== actor,
      );
      const dateLabel = toDateOnly(request.date);
      await Promise.all(
        recipients.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'leave_requested',
            title: `${updated ? 'تعديل طلب استئذان' : 'طلب استئذان'} — ${request.teacherName || 'معلم'}`,
            body: [`${dateLabel} · انصراف ${request.leaveAt}`, request.reason].filter(Boolean).join(' — '),
            data: {
              leaveRequestId: String(request._id),
              teacherId: String(request.teacherId),
              teacherName: request.teacherName ?? '',
              date: dateLabel,
              leaveAt: request.leaveAt,
            },
          }),
        ),
      );
    } catch (error: any) {
      new Logger(DutyService.name).error(`Could not announce leave request ${request?._id}: ${error?.message}`);
    }
  }

  async listLeaveRequests(filters: {
    date?: string;
    from?: string;
    to?: string;
    status?: string;
    teacherId?: string;
    kind?: string;
  }, user: any) {
    const query: any = {};

    if (filters.date) {
      query.date = dayStart(filters.date);
    } else if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = dayStart(filters.from);
      if (filters.to) query.date.$lte = dayStart(filters.to);
    }

    if (filters.status) query.status = filters.status;
    if (filters.kind === 'full_day') query.kind = 'full_day';
    else if (filters.kind === 'early_leave') Object.assign(query, EARLY_LEAVE_ONLY);
    else if (filters.kind) throw new BadRequestException('kind لازم يكون early_leave أو full_day');

    // A teacher only ever sees their own, whatever they ask for.
    if (user?.role === 'TEACHER') {
      query.teacherId = user.userId;
    } else if (filters.teacherId) {
      query.teacherId = filters.teacherId;
    }

    const rows = await this.leaveModel
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();

    // How many days each group has, so a client can show «3 أيام» on one row.
    const groupIds = [...new Set(rows.map((r: any) => r.groupId).filter(Boolean).map(String))];
    const sizes = new Map<string, number>(
      groupIds.length
        ? (
            await this.leaveModel
              .aggregate([
                { $match: { groupId: { $in: groupIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
                { $group: { _id: '$groupId', n: { $sum: 1 } } },
              ])
              .exec()
          ).map((g: any) => [String(g._id), g.n] as [string, number])
        : [],
    );

    return rows.map((row: any) => ({
      ...row,
      date: toDateOnly(row.date),
      kind: row.kind ?? 'early_leave',
      groupId: row.groupId ? String(row.groupId) : null,
      groupDays: row.groupId ? sizes.get(String(row.groupId)) ?? 1 : 1,
    }));
  }

  async reviewLeaveRequest(id: string, dto: ReviewLeaveRequestDto, user: any) {
    if (user?.role === 'TEACHER') {
      throw new ForbiddenException('المدرس لا يراجع استئذانه بنفسه');
    }

    const request = await this.leaveModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException(`طلب الاستئذان ${id} غير موجود`);
    }

    // Days filed together are decided together, with one notice.
    if (request.groupId) {
      return this.reviewGroup(request, dto, user);
    }

    request.status = dto.status;
    request.reviewNote = dto.reviewNote ?? '';
    request.reviewedBy = user?.userId ?? null;
    request.reviewedByName = user?.name ?? user?.email ?? '';
    request.reviewedAt = new Date();
    await request.save();

    // Otherwise the teacher only finds out by opening a screen they have no
    // reason to open.
    if (dto.status === 'approved' || dto.status === 'rejected') {
      await this.notifications.notify({
        recipientId: request.teacherId,
        type: dto.status === 'approved' ? 'leave_approved' : 'leave_rejected',
        title:
          dto.status === 'approved'
            ? 'تمت الموافقة على استئذانك'
            : 'تم رفض طلب الاستئذان',
        body: [
          toDateOnly(request.date),
          `انصراف ${request.leaveAt}`,
          request.reviewNote,
        ]
          .filter(Boolean)
          .join(' · '),
        data: {
          leaveRequestId: String(request._id),
          date: toDateOnly(request.date),
          status: dto.status,
        },
      });
    }

    return {
      message:
        dto.status === 'approved'
          ? 'تمت الموافقة على الاستئذان'
          : dto.status === 'rejected'
            ? 'تم رفض الاستئذان'
            : 'تم إرجاع الطلب للمراجعة',
      data: request,
    };
  }

  private async reviewGroup(request: any, dto: ReviewLeaveRequestDto, user: any) {
    const rows: any[] = await this.leaveModel.find({ groupId: request.groupId }).sort({ date: 1 }).lean().exec();
    const wasApproved = rows.filter((r) => r.status === 'approved');
    await this.leaveModel
      .updateMany(
        { groupId: request.groupId },
        {
          $set: {
            status: dto.status,
            reviewNote: dto.reviewNote ?? '',
            reviewedBy: user?.userId ?? null,
            reviewedByName: user?.name ?? user?.email ?? '',
            reviewedAt: new Date(),
          },
        },
      )
      .exec();

    const label = DutyService.rangeLabel(rows.map((r) => r.date));
    if (dto.status === 'approved' || dto.status === 'rejected') {
      await this.notifications.notify({
        recipientId: request.teacherId,
        type: dto.status === 'approved' ? 'leave_approved' : 'leave_rejected',
        title: dto.status === 'approved' ? 'تمت الموافقة على غيابك' : 'تم رفض طلب الغياب',
        body: [label, dto.reviewNote].filter(Boolean).join(' · '),
        data: {
          leaveRequestId: String(request._id),
          groupId: String(request.groupId),
          kind: request.kind ?? 'early_leave',
          dates: rows.map((r) => toDateOnly(r.date)),
          status: dto.status,
        },
      });
    }

    // An approved group taken back: its covers are now for a teacher who is
    // coming. Listed, not deleted — the manager decides.
    const affectedCovers =
      dto.status !== 'approved'
        ? await this.affectedCovers(request.teacherId, wasApproved.map((r) => r.date))
        : [];
    const updated: any[] = await this.leaveModel.find({ groupId: request.groupId }).sort({ date: 1 }).lean().exec();

    return {
      message:
        dto.status === 'approved'
          ? 'تمت الموافقة على الغياب'
          : dto.status === 'rejected'
            ? 'تم رفض الغياب'
            : 'تم إرجاع الطلب للمراجعة',
      data: updated.map((r) => ({ ...r, date: toDateOnly(r.date), groupDays: updated.length })),
      affectedCovers,
    };
  }

  /**
   * Cancel a request. A group goes as a whole unless staff ask for one day
   * (`scope=day`). A teacher cancels only her own, and only while pending.
   * Covers set for the cancelled days are returned, not deleted.
   */
  async cancelLeaveRequest(id: string, user: any, scope: string = 'group') {
    if (scope !== 'group' && scope !== 'day') {
      throw new BadRequestException('scope لازم يكون day أو group');
    }
    const request = await this.leaveModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException(`طلب الاستئذان ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (String(request.teacherId) !== String(user.userId)) {
        throw new ForbiddenException('ليس مسموحاً لك بإلغاء استئذان مدرس تاني');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException(
          'تمت مراجعة الطلب بالفعل — راجع الإدارة لتعديله.',
        );
      }
      // Her own pending group goes together.
      scope = 'group';
    }

    const rows: any[] =
      request.groupId && scope === 'group'
        ? await this.leaveModel.find({ groupId: request.groupId }).lean().exec()
        : [request.toObject()];
    if (user?.role === 'TEACHER' && rows.some((r) => r.status !== 'pending')) {
      throw new BadRequestException('تمت مراجعة الطلب بالفعل — راجع الإدارة لتعديله.');
    }

    await this.leaveModel.deleteMany({ _id: { $in: rows.map((r) => r._id) } }).exec();
    const affectedCovers = await this.affectedCovers(
      request.teacherId,
      rows.filter((r) => r.status === 'approved').map((r) => r.date),
    );
    return {
      message: request.kind === 'full_day' ? 'تم إلغاء الغياب المسبق' : 'تم إلغاء طلب الاستئذان',
      data: request,
      cancelled: rows.map((r) => ({ _id: String(r._id), date: toDateOnly(r.date) })),
      affectedCovers,
    };
  }

  /**
   * Is this teacher excused from part of this day?
   *
   * Used by the attendance module so a sanctioned departure is not recorded as
   * leaving early. Returns null when there is no approved request.
   */
  async findApprovedLeave(teacherId: any, date: Date, kind: 'early_leave' | 'full_day' = 'early_leave') {
    return this.leaveModel
      .findOne({
        teacherId,
        date: dayStart(date),
        status: 'approved',
        ...(kind === 'full_day' ? { kind: 'full_day' } : EARLY_LEAVE_ONLY),
      })
      .lean()
      .exec();
  }

  // ─────────────────────────────────────────────── duty supervisors

  async setSupervisors(dto: SetDutySupervisorsDto, user: any) {
    const date = dayStart(dto.date);
    const ids = [...new Set(dto.teacherIds.map(String))];

    const teachers = await this.teacherModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean()
      .exec();

    const missing = ids.filter(
      (id) => !teachers.some((t: any) => String(t._id) === id),
    );
    if (missing.length > 0) {
      throw new NotFoundException(`مدرسون غير موجودين: ${missing.join(', ')}`);
    }

    // Names are stored in the same order as the ids so a roster reads back
    // exactly as it was set.
    const byId = new Map(teachers.map((t: any) => [String(t._id), t.name]));

    // Read the roster we are about to replace, so only the people whose duty
    // actually changed get told. Editing the notes on an unchanged roster must
    // not re-notify everyone on it.
    const previous = await this.supervisorModel.findOne({ date }).lean().exec();
    const before = new Set<string>(
      ((previous as any)?.teacherIds ?? []).map((id: any) => String(id)),
    );

    const saved = await this.supervisorModel
      .findOneAndUpdate(
        { date },
        {
          date,
          teacherIds: ids.map((id) => new mongoose.Types.ObjectId(id)),
          teacherNames: ids.map((id) => byId.get(id) ?? ''),
          notes: dto.notes ?? '',
          setBy: user?.userId ?? null,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // Same reasoning as cover: a supervisor who is not told is not a
    // supervisor. The manager sets the roster in the morning and the teacher,
    // who has no reason to open a screen they were not expecting, never finds
    // out the school is theirs to watch that day.
    const dateLabel = toDateOnly(saved.date);
    const added = ids.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !ids.includes(id));

    await Promise.all([
      ...added.map((id) =>
        this.notifications.notify({
          recipientId: id,
          type: 'duty_assigned',
          title: 'أنت مناوب اليوم',
          body: [dateLabel, dto.notes || null].filter(Boolean).join(' · '),
          data: { supervisorId: String(saved._id), date: dateLabel },
        }),
      ),
      ...removed.map((id) =>
        this.notifications.notify({
          recipientId: id,
          type: 'duty_removed',
          title: 'تم إلغاء مناوبتك',
          body: dateLabel,
          data: { supervisorId: String(saved._id), date: dateLabel },
        }),
      ),
    ]);

    return {
      message: ids.length === 0 ? 'تم مسح مناوبة اليوم' : 'تم حفظ مناوبة اليوم',
      data: { ...saved.toObject(), date: toDateOnly(saved.date) },
    };
  }

  async getSupervisors(filters: { date?: string; from?: string; to?: string }) {
    const query: any = {};

    if (filters.date) {
      query.date = dayStart(filters.date);
    } else if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = dayStart(filters.from);
      if (filters.to) query.date.$lte = dayStart(filters.to);
    } else {
      query.date = dayStart(new Date());
    }

    const rows = await this.supervisorModel
      .find(query)
      .sort({ date: 1 })
      .lean()
      .exec();

    return rows.map((row: any) => ({ ...row, date: toDateOnly(row.date) }));
  }

  // ────────────────────────────────────────────────── substitutions

  async createSubstitution(dto: CreateSubstitutionDto, user: any) {
    const date = dayStart(dto.date);

    const lecture: any = await this.lectureModel
      .findById(dto.lectureId)
      .lean()
      .exec();
    if (!lecture) {
      throw new NotFoundException(`الحصة ${dto.lectureId} غير موجودة`);
    }

    // The cover must actually fall on the day being covered, or it silently
    // never applies.
    const weekday = WEEKDAY_NAMES[date.getUTCDay()];
    if (lecture.dayOfWeek !== weekday) {
      throw new BadRequestException(
        `هذه الحصة في يوم ${lecture.dayOfWeek}، والتاريخ المختار ${weekday}.`,
      );
    }

    const substitute = await this.resolveSubstitute(dto.substituteTeacherId);
    if (!substitute) {
      throw new NotFoundException(
        `البديل ${dto.substituteTeacherId} غير موجود، أو ليس معلمًا أو مساعدًا إداريًا`,
      );
    }

    if (
      lecture.teacherId &&
      String(lecture.teacherId) === String(dto.substituteTeacherId)
    ) {
      throw new BadRequestException(
        'المدرس البديل هو نفسه مدرس الحصة الأصلي.',
      );
    }

    const conflicts = await this.findSubstituteConflicts(
      date,
      dto.substituteTeacherId,
      lecture,
    );
    if (conflicts.length > 0) {
      throw new BadRequestException(
        `${substitute.name} مشغول في نفس الوقت: ${conflicts.join('، ')}`,
      );
    }

    const absentTeacher: any = lecture.teacherId
      ? await this.teacherModel
          .findById(lecture.teacherId)
          .select('name')
          .lean()
          .exec()
      : null;

    const saved = await this.substitutionModel
      .findOneAndUpdate(
        { date, lectureId: lecture._id },
        {
          date,
          lectureId: lecture._id,
          absentTeacherId: lecture.teacherId ?? null,
          absentTeacherName: absentTeacher?.name ?? '',
          substituteTeacherId: new mongoose.Types.ObjectId(
            dto.substituteTeacherId,
          ),
          substituteTeacherName: substitute.name,
          substituteType: substitute.type,
          substituteRole: substitute.role,
          reason: dto.reason ?? 'absent',
          notes: dto.notes ?? '',
          createdBy: user?.userId ?? null,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    // The whole feature turns on this. A manager assigns cover at eight in the
    // morning; without a notice the substitute never learns of it and the
    // class sits empty.
    const classInfo: any = lecture.classId
      ? await this.classModel.findById(lecture.classId).select('name roomNumber').lean().exec()
      : null;

    // Set the day before, it has to say which day: «الخميس 2026-12-03».
    const settings = await this.schoolSettings(user?.schoolId);
    const ahead = date > schoolNow(settings?.timezone).date;
    await this.notifications.notify({
      recipientId: dto.substituteTeacherId,
      type: 'cover_assigned',
      title: 'لديك حصة احتياط',
      body: [
        ahead ? `${WEEKDAY_AR[date.getUTCDay()]} ${toDateOnly(date)}` : toDateOnly(date),
        `الحصة ${lecture.slot}`,
        classInfo?.name,
        absentTeacher?.name ? `بدلًا من ${absentTeacher.name}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      data: {
        substitutionId: String(saved._id),
        lectureId: String(lecture._id),
        date: toDateOnly(date),
        slot: lecture.slot,
      },
    });

    return {
      message: `تم تكليف ${substitute.name} بالحصة`,
      data: { ...saved.toObject(), date: toDateOnly(saved.date) },
    };
  }

  /**
   * A teacher, or failing that an administrative assistant (MANAGER).
   * Teachers are looked up first because nearly every cover is a teacher, and
   * an id is unique across collections. The owner, the principal
   * (SUPERVISOR) and STAFF are not substitutes.
   */
  private async resolveSubstitute(id: string): Promise<ResolvedSubstitute | null> {
    if (!mongoose.Types.ObjectId.isValid(String(id))) return null;

    const teacher: any = await this.teacherModel
      .findById(id)
      .select('name')
      .lean()
      .exec();
    if (teacher) {
      return { id: String(teacher._id), name: teacher.name ?? '', type: 'Teacher', role: 'TEACHER' };
    }

    const admin: any = await this.adminModel
      .findOne({ _id: id, role: { $in: COVER_ADMIN_ROLES } })
      .select('username fullName role')
      .lean()
      .exec();
    if (admin) {
      return { id: String(admin._id), name: adminName(admin), type: 'Admin', role: admin.role };
    }

    return null;
  }

  /**
   * Everything already claiming this teacher at this hour: their own lecture
   * in the slot, and any cover they have already been given.
   */
  private async findSubstituteConflicts(
    date: Date,
    substituteTeacherId: string,
    lecture: any,
  ): Promise<string[]> {
    const reasons: string[] = [];

    const ownLecture = await this.lectureModel
      .findOne({
        teacherId: substituteTeacherId,
        dayOfWeek: lecture.dayOfWeek,
        slot: lecture.slot,
        termId: lecture.termId,
      })
      .lean()
      .exec();
    if (ownLecture) reasons.push('لديه حصة في الخانة نفسها');

    const otherCover = await this.substitutionModel
      .findOne({
        date,
        substituteTeacherId,
        lectureId: { $ne: lecture._id },
      })
      .lean()
      .exec();

    if (otherCover) {
      const covered: any = await this.lectureModel
        .findById((otherCover as any).lectureId)
        .lean()
        .exec();
      if (covered?.slot === lecture.slot) {
        reasons.push('مكلّف بحصة احتياط أخرى في الخانة نفسها');
      }
    }

    return reasons;
  }

  async removeSubstitution(id: string) {
    const removed = await this.substitutionModel.findByIdAndDelete(id).exec();
    if (!removed) {
      throw new NotFoundException(`التكليف ${id} غير موجود`);
    }

    // Being un-assigned matters as much as being assigned: a teacher who was
    // told to take a class needs telling that they no longer are.
    await this.notifications.notify({
      recipientId: (removed as any).substituteTeacherId,
      type: 'cover_removed',
      title: 'تم إلغاء حصة احتياطي',
      body: toDateOnly((removed as any).date) ?? '',
      data: { date: toDateOnly((removed as any).date) },
    });

    return { message: 'تم إلغاء التكليف', data: removed };
  }

  async listSubstitutions(filters: { date?: string; teacherId?: string }, user: any) {
    const query: any = { date: dayStart(filters.date ?? new Date()) };

    if (user?.role === 'TEACHER') {
      query.substituteTeacherId = user.userId;
    } else if (filters.teacherId) {
      query.substituteTeacherId = filters.teacherId;
    }

    const rows = await this.substitutionModel
      .find(query)
      .populate({
        path: 'lectureId',
        populate: [
          { path: 'classId', select: 'name roomNumber' },
          { path: 'subjectOfferingId', populate: { path: 'subjectId' } },
        ],
      })
      .lean()
      .exec();

    return rows.map((row: any) => ({ ...row, date: toDateOnly(row.date) }));
  }

  /**
   * A teacher's actual day: their own lectures plus any cover assigned to them,
   * on one timeline.
   *
   * The cover screen exists, but a teacher has no reason to open it — they
   * open their timetable. A substitution that only lives on its own screen is
   * a substitution nobody sees, so this merges the two and marks which is
   * which.
   */
  async getMyDay(userId: string, dateStr: string | undefined) {
    const date = dayStart(dateStr ?? new Date());
    const weekday = WEEKDAY_NAMES[date.getUTCDay()];

    // The current term of the active year. «Active» alone matched nothing
    // while every term was still upcoming, and then every year's lectures
    // for that weekday came back.
    const lectureFilter: any = {
      teacherId: userId,
      dayOfWeek: weekday,
      ...currentTermFilter(await currentScope(this.lectureModel.db, date)),
    };

    const [own, cover]: any[] = await Promise.all([
      this.lectureModel
        .find(lectureFilter)
        .populate('classId', 'name roomNumber')
        .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
        .lean()
        .exec(),
      this.substitutionModel
        .find({ date, substituteTeacherId: userId })
        .populate({
          path: 'lectureId',
          populate: [
            { path: 'classId', select: 'name roomNumber' },
            { path: 'subjectOfferingId', populate: { path: 'subjectId' } },
          ],
        })
        .lean()
        .exec(),
    ]);

    const leave = await this.leaveModel
      .findOne({ teacherId: userId, date })
      .lean()
      .exec();

    const approvedLeave =
      leave && (leave as any).status === 'approved' ? (leave as any) : null;

    const ownSlots = own.map((lecture: any) => {
      // A period the teacher is excused from is still on their timetable;
      // showing it without saying so is how somebody turns up for a lesson
      // they were signed off.
      const excused =
        approvedLeave != null &&
        (approvedLeave.fromSlot == null || lecture.slot >= approvedLeave.fromSlot);

      return {
        kind: 'own' as const,
        lectureId: String(lecture._id),
        slot: lecture.slot,
        className: lecture.classId?.name ?? null,
        roomNumber: lecture.classId?.roomNumber ?? null,
        subjectName: lecture.subjectOfferingId?.subjectId?.subjectName ?? null,
        isActivity: isActivityLecture(lecture),
        excusedByLeave: excused,
      };
    });

    const coverSlots = cover
      .filter((row: any) => row.lectureId)
      .map((row: any) => ({
        kind: 'cover' as const,
        substitutionId: String(row._id),
        lectureId: String(row.lectureId._id),
        slot: row.lectureId.slot,
        className: row.lectureId.classId?.name ?? null,
        roomNumber: row.lectureId.classId?.roomNumber ?? null,
        subjectName:
          row.lectureId.subjectOfferingId?.subjectId?.subjectName ?? null,
        coveringFor: row.absentTeacherName || null,
        // A covered breakfast or play period has no register to open.
        isActivity: isActivityLecture(row.lectureId),
        excusedByLeave: false,
      }));

    const slots = [...ownSlots, ...coverSlots].sort((a, b) => a.slot - b.slot);

    return {
      date: toDateOnly(date),
      dayOfWeek: weekday,
      // A full_day leave (planned absence) excuses every period: fromSlot null.
      leave: approvedLeave
        ? {
            leaveAt: approvedLeave.leaveAt,
            fromSlot: approvedLeave.fromSlot,
            status: approvedLeave.status,
            kind: approvedLeave.kind ?? 'early_leave',
          }
        : leave
          ? { leaveAt: (leave as any).leaveAt, status: (leave as any).status, kind: (leave as any).kind ?? 'early_leave' }
          : null,
      stats: {
        own: ownSlots.length,
        cover: coverSlots.length,
        excused: ownSlots.filter((s) => s.excusedByLeave).length,
      },
      slots,
    };
  }

  /**
   * Who has been carrying the cover, over a period.
   *
   * This is the fairness question, and it is the first one asked once cover
   * exists: the same two obliging teachers end up taking everything, nobody
   * notices until they complain, and by then it is a grievance rather than a
   * rota problem. The numbers make it visible while it is still the latter.
   *
   * Counted from substitutions rather than recomputed from timetables, so the
   * report says what actually happened on each day — not what today's
   * timetable would imply about a term that has already been taught.
   */
  async getCoverReport(from: string, to: string) {
    const start = dayStart(from);
    const end = dayStart(to);

    if (end < start) {
      throw new BadRequestException('تاريخ النهاية قبل تاريخ البداية');
    }

    const range = { $gte: start, $lte: end };

    const [substitutions, leaves, attendance, teachers, admins]: any[] =
      await Promise.all([
        this.substitutionModel.find({ date: range }).lean().exec(),
        this.leaveModel.find({ date: range, status: 'approved' }).lean().exec(),
        this.attendanceModel.find({ date: range }).select('teacherId date').lean().exec(),
        this.teacherModel
          .find({ isActive: { $ne: false } })
          .select('name specialization')
          .lean()
          .exec(),
        this.adminModel
          .find({ role: { $in: COVER_ADMIN_ROLES } })
          .select('username fullName role')
          .lean()
          .exec(),
      ]);

    const row = (teacher: any) => ({
      teacherId: String(teacher._id),
      name: teacher.name,
      specialization: teacher.specialization ?? null,
      type: 'Teacher' as SubstituteType,
      role: 'TEACHER',
      covered: 0,
      neededCover: 0,
      approvedLeaves: 0,
      daysPresent: 0,
    });

    const rows = new Map<string, any>(
      teachers.map((t: any) => [String(t._id), row(t)]),
    );
    // Administrators only ever appear for cover they took: they have no
    // timetable to need covering and no teacher attendance or leave.
    for (const admin of admins) {
      rows.set(String(admin._id), {
        ...row({ _id: admin._id, name: adminName(admin) }),
        type: 'Admin' as SubstituteType,
        role: admin.role,
      });
    }

    for (const substitution of substitutions) {
      const cover = rows.get(String(substitution.substituteTeacherId));
      if (cover) cover.covered += 1;

      if (substitution.absentTeacherId) {
        const owner = rows.get(String(substitution.absentTeacherId));
        if (owner) owner.neededCover += 1;
      }
    }

    for (const leave of leaves) {
      const teacher = rows.get(String(leave.teacherId));
      if (teacher) teacher.approvedLeaves += 1;
    }

    // Distinct days, not records: one teacher has at most one attendance row
    // per day, but counting rows would still be the wrong thing to say.
    const presentDays = new Map<string, Set<string>>();
    for (const record of attendance) {
      const id = String(record.teacherId);
      if (!presentDays.has(id)) presentDays.set(id, new Set());
      presentDays.get(id).add(toDateOnly(record.date) ?? '');
    }
    for (const [id, days] of presentDays) {
      const teacher = rows.get(id);
      if (teacher) teacher.daysPresent = days.size;
    }

    const teacherRows = [...rows.values()]
      // Everybody who neither covered nor needed covering is noise on a
      // fairness report.
      .filter((r) => r.covered > 0 || r.neededCover > 0 || r.approvedLeaves > 0)
      .sort((a, b) => b.covered - a.covered || a.name.localeCompare(b.name, 'ar'));

    const totalCovered = substitutions.length;
    const carriers = teacherRows.filter((r) => r.covered > 0);
    const average =
      carriers.length === 0 ? 0 : totalCovered / carriers.length;

    /*
     * Flagged against what everybody ELSE is carrying, not against an average
     * that includes them.
     *
     * A teacher taking most of the cover drags the average up towards their
     * own figure and hides behind it: with two carriers on three and one, the
     * average is two and nobody clears twice it, even though one of them is
     * doing three quarters of the work. Comparing against the others makes the
     * lopsidedness visible, which is the entire point of the report.
     *
     * The floor of three keeps it from firing on the one-versus-two weeks that
     * are not yet a pattern.
     */
    const overloaded = carriers
      .filter((r) => {
        if (r.covered < 3) return false;
        const others = carriers.filter((c) => c.teacherId !== r.teacherId);
        const othersAverage =
          others.length === 0
            ? 0
            : others.reduce((sum, c) => sum + c.covered, 0) / others.length;
        return r.covered >= othersAverage * 2;
      })
      .map((r) => ({ teacherId: r.teacherId, name: r.name, covered: r.covered }));

    const byDay = new Map<string, number>();
    for (const substitution of substitutions) {
      const key = toDateOnly(substitution.date) ?? '';
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }

    return {
      from: toDateOnly(start),
      to: toDateOnly(end),
      totals: {
        coverAssigned: totalCovered,
        teachersWhoCovered: carriers.length,
        approvedLeaves: leaves.length,
        averagePerCarrier: Math.round(average * 10) / 10,
      },
      overloaded,
      byDay: [...byDay.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      teachers: teacherRows,
    };
  }

  // ───────────────────────────────────────────────── the cover board

  /**
   * Everything that needs covering today, and who could take it.
   *
   * Picking a substitute by hand means holding the whole timetable in your
   * head: who is off, which of their lectures fall today, and which of the
   * remaining teachers is free in that exact slot. This answers all three, and
   * the suggestions are what turns a twenty-minute puzzle into a tap.
   *
   * A teacher is offered as a substitute only if they are at school today, are
   * not the absent teacher, have no lecture of their own in that slot, and are
   * not already covering something else in it.
   */
  async getCoverage(dateStr: string | undefined, user: any) {
    const settings = await this.schoolSettings(user?.schoolId);
    const today = schoolNow(settings?.timezone).date;
    const date = dateStr ? dayStart(dateStr) : today;
    const weekday = WEEKDAY_NAMES[date.getUTCDay()];
    const isFuture = date > today;

    // A weekend or a holiday has no lectures to cover, whatever the
    // timetable's weekday says.
    const daySchedule = resolveDaySchedule(settings, date);
    if (!daySchedule.isWorkingDay) {
      return {
        date: toDateOnly(date),
        dayOfWeek: weekday,
        isWorkingDay: false,
        isFuture,
        message: daySchedule.holidayName
          ? `هذا اليوم إجازة: ${daySchedule.holidayName}`
          : 'هذا اليوم ليس يوم دوام',
        termId: null,
        checkInInUse: false,
        absentTeachers: [],
        onLeave: [],
        plannedAbsences: [],
        supervisors: null,
        stats: { needCover: 0, covered: 0, uncovered: 0 },
        uncovered: [],
        covered: [],
      };
    }

    const scope = await currentScope(this.lectureModel.db, date);
    const termFilter = currentTermFilter(scope);

    const [
      teachers,
      attendance,
      leaves,
      existingCover,
      admins,
      staffAttendance,
      staffLeaves,
    ]: any[] = await Promise.all([
      this.teacherModel.find({ isActive: { $ne: false } })
        .select('name specialization').lean().exec(),
      this.attendanceModel.find({ date }).select('teacherId').lean().exec(),
      this.leaveModel.find({ date, status: 'approved' }).lean().exec(),
      this.substitutionModel.find({ date }).lean().exec(),
      this.adminModel
        .find({ role: { $in: COVER_ADMIN_ROLES } })
        .select('username fullName role')
        .lean()
        .exec(),
      this.staffAttendanceModel
        .find({ date, role: { $in: COVER_ADMIN_ROLES } })
        .select('staffId')
        .lean()
        .exec(),
      this.staffLeaveModel
        .find({ date, status: 'approved' })
        .select('staffId')
        .lean()
        .exec(),
    ]);

    // Administrative assistants have no timetable, so every slot looks free;
    // what decides is whether they are in. Same rule as for teachers: once
    // anyone among them has checked in today, only those who did are offered.
    // A staff leave carries a clock time, not a period, so an approved one
    // takes them out for the day rather than guessing which periods it spares.
    const staffPresent = new Set<string>(
      staffAttendance.map((a: any) => String(a.staffId)),
    );
    const staffOnLeave = new Set<string>(
      staffLeaves.map((l: any) => String(l.staffId)),
    );
    const availableAdmins = admins.filter((admin: any) => {
      const id = String(admin._id);
      if (staffOnLeave.has(id)) return false;
      return staffPresent.size === 0 || staffPresent.has(id);
    });

    const presentIds = new Set<string>(
      attendance.map((a: any) => String(a.teacherId)),
    );
    // A استئذان covers part of the day; a planned absence («غياب مسبق»)
    // covers all of it, known ahead — so its lectures are on the board from
    // the day before, when nobody has checked in.
    const leaveByTeacher = new Map<string, any>(
      leaves.filter((l: any) => l.kind !== 'full_day').map((l: any) => [String(l.teacherId), l]),
    );
    const plannedByTeacher = new Map<string, any>(
      leaves.filter((l: any) => l.kind === 'full_day').map((l: any) => [String(l.teacherId), l]),
    );

    // Absent = did not check in. On a day nobody has checked in yet — early
    // morning, or a school not using check-in — that would flag the entire
    // staff, which is noise rather than information.
    const checkInInUse = attendance.length > 0;
    const absentIds = checkInInUse
      ? teachers
          .map((t: any) => String(t._id))
          .filter((id: string) => !presentIds.has(id))
      : [];

    // A teacher who came in after all is here to cover, not to be covered.
    const plannedAway = [...plannedByTeacher.keys()].filter((id) => !presentIds.has(id));
    const needsCoverFrom = new Set<string>([
      ...(absentIds as string[]),
      ...leaveByTeacher.keys(),
      ...plannedAway,
    ]);

    const lectureFilter: any = { dayOfWeek: weekday };
    Object.assign(lectureFilter, termFilter);

    const lectures: any[] = await this.lectureModel
      .find(lectureFilter)
      .populate('classId', 'name roomNumber')
      .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
      .lean()
      .exec();

    const teacherById = new Map<string, any>(
      teachers.map((t: any) => [String(t._id), t]),
    );
    const coverByLecture = new Map<string, any>(
      existingCover.map((c: any) => [String(c.lectureId), c]),
    );

    // Who is busy in which slot, counting cover already assigned.
    const busyBySlot = new Map<number, Set<string>>();
    for (const lecture of lectures) {
      if (!lecture.teacherId) continue;
      if (!busyBySlot.has(lecture.slot)) busyBySlot.set(lecture.slot, new Set());
      busyBySlot.get(lecture.slot).add(String(lecture.teacherId));
    }
    for (const cover of existingCover) {
      const lecture = lectures.find(
        (l) => String(l._id) === String(cover.lectureId),
      );
      if (!lecture) continue;
      if (!busyBySlot.has(lecture.slot)) busyBySlot.set(lecture.slot, new Set());
      busyBySlot.get(lecture.slot).add(String(cover.substituteTeacherId));
    }

    const uncovered: any[] = [];
    const covered: any[] = [];

    for (const lecture of lectures) {
      const ownerId = lecture.teacherId ? String(lecture.teacherId) : null;
      const leave = ownerId ? leaveByTeacher.get(ownerId) : null;

      // An approved leave from the fourth period does not touch the first
      // three. Without fromSlot the whole day is offered and the manager
      // decides — the school has no per-slot clock to convert a time from.
      const leaveApplies =
        leave != null &&
        (leave.fromSlot == null || lecture.slot >= leave.fromSlot);

      const planned = ownerId ? plannedByTeacher.get(ownerId) : null;
      const ownerPresent = ownerId != null && presentIds.has(ownerId);
      const isAbsent = ownerId != null && absentIds.includes(ownerId);
      const existing = coverByLecture.get(String(lecture._id));

      // A cover already set is always on the board, whatever its teacher's
      // status: set the day before, it must not vanish at 07:00 because
      // nobody has checked in yet. Otherwise a lecture is listed only when
      // its teacher is away: absent, on leave, or on a planned absence she
      // has not turned up for after all.
      const plannedApplies = planned != null && !ownerPresent;
      if (!existing && !isAbsent && !leaveApplies && !plannedApplies) continue;

      const reason = planned
        ? 'planned_absence'
        : isAbsent
          ? 'absent'
          : leaveApplies
            ? 'leave'
            : (existing?.reason ?? 'other');
      const entry = {
        lectureId: String(lecture._id),
        slot: lecture.slot,
        dayOfWeek: lecture.dayOfWeek,
        className: lecture.classId?.name ?? null,
        roomNumber: lecture.classId?.roomNumber ?? null,
        subjectName:
          lecture.subjectOfferingId?.subjectId?.subjectName ?? null,
        subjectId: lecture.subjectOfferingId?.subjectId?._id
          ? String(lecture.subjectOfferingId.subjectId._id)
          : null,
        absentTeacherId: ownerId,
        absentTeacherName: ownerId
          ? (teacherById.get(ownerId)?.name ?? null)
          : null,
        reason,
        leaveAt: leaveApplies ? leave.leaveAt : null,
        leaveRequestId: planned ? String(planned._id) : leaveApplies ? String(leave._id) : null,
        // She has a check-in on that date: «المعلمة حضرت».
        ownerPresent,
      };

      if (existing) {
        covered.push({
          ...entry,
          substitutionId: String(existing._id),
          substituteTeacherId: String(existing.substituteTeacherId),
          substituteTeacherName: existing.substituteTeacherName,
          substituteType: existing.substituteType ?? 'Teacher',
          substituteRole: existing.substituteRole ?? 'TEACHER',
        });
      } else {
        uncovered.push({
          ...entry,
          suggestions: this.suggestSubstitutes({
            teachers,
            admins: availableAdmins,
            busyBySlot,
            slot: lecture.slot,
            excludeId: ownerId,
            needsCoverFrom,
            presentIds,
            checkInInUse,
            subjectName: entry.subjectName,
          }),
        });
      }
    }

    uncovered.sort((a, b) => a.slot - b.slot);
    covered.sort((a, b) => a.slot - b.slot);

    const supervisors = await this.supervisorModel.findOne({ date }).lean().exec();

    return {
      date: toDateOnly(date),
      dayOfWeek: weekday,
      termId: scope.termId ? String(scope.termId) : null,
      isWorkingDay: true,
      isFuture,
      checkInInUse,
      absentTeachers: absentIds.map((id: string) => ({
        teacherId: id,
        name: teacherById.get(id)?.name ?? null,
      })),
      onLeave: [...leaveByTeacher.values()].map((l: any) => ({
        teacherId: String(l.teacherId),
        name: l.teacherName,
        leaveAt: l.leaveAt,
        fromSlot: l.fromSlot,
        kind: l.kind ?? 'early_leave',
      })),
      plannedAbsences: [...plannedByTeacher.values()].map((l: any) => ({
        teacherId: String(l.teacherId),
        name: teacherById.get(String(l.teacherId))?.name ?? l.teacherName,
        reason: l.reason ?? '',
        leaveRequestId: String(l._id),
        groupId: l.groupId ? String(l.groupId) : null,
        present: presentIds.has(String(l.teacherId)),
      })),
      supervisors: supervisors
        ? {
            teacherIds: (supervisors as any).teacherIds.map(String),
            teacherNames: (supervisors as any).teacherNames,
            notes: (supervisors as any).notes,
          }
        : null,
      stats: {
        needCover: uncovered.length + covered.length,
        covered: covered.length,
        uncovered: uncovered.length,
      },
      uncovered,
      covered,
    };
  }

  /**
   * Who can take one slot, best fit first: free teachers (specialists ahead),
   * then administrative assistants. A teacher is a lesson; an assistant is
   * supervision of the room, so they come after every free teacher.
   */
  private suggestSubstitutes(input: {
    teachers: any[];
    admins: any[];
    busyBySlot: Map<number, Set<string>>;
    slot: number;
    excludeId: string | null;
    needsCoverFrom: Set<string>;
    presentIds: Set<string>;
    checkInInUse: boolean;
    subjectName: string | null;
  }) {
    const busy = input.busyBySlot.get(input.slot) ?? new Set<string>();

    const teachers = input.teachers
      .filter((teacher: any) => {
        const id = String(teacher._id);
        if (id === input.excludeId) return false;
        // Somebody off today cannot cover for somebody else off today.
        if (input.needsCoverFrom.has(id)) return false;
        if (input.checkInInUse && !input.presentIds.has(id)) return false;
        return !busy.has(id);
      })
      .map((teacher: any) => {
        // A specialist in the subject is a real cover; anyone else is
        // supervision. Both are offered, the better one first.
        const specialised =
          input.subjectName != null &&
          typeof teacher.specialization === 'string' &&
          teacher.specialization.trim() !== '' &&
          (teacher.specialization.includes(input.subjectName) ||
            input.subjectName.includes(teacher.specialization));

        return {
          teacherId: String(teacher._id),
          name: teacher.name,
          specialization: teacher.specialization ?? null,
          sameSubject: specialised,
          type: 'Teacher' as SubstituteType,
          role: 'TEACHER',
        };
      })
      .sort((a, b) => {
        if (a.sameSubject !== b.sameSubject) return a.sameSubject ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'ar');
      });

    const admins = input.admins
      .filter((admin: any) => !busy.has(String(admin._id)))
      .map((admin: any) => ({
        // Same key as a teacher's, so a client posts it back unchanged as
        // substituteTeacherId.
        teacherId: String(admin._id),
        name: adminName(admin),
        specialization: null,
        sameSubject: false,
        type: 'Admin' as SubstituteType,
        role: admin.role,
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));

    return [...teachers, ...admins];
  }
}
