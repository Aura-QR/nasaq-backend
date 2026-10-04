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
import { Admin } from '../admin/schemas/admin.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  normalizeDate,
  parseCheckInTime,
  resolveDaySchedule,
  workingDatesBetween,
} from '../attendance/attendance.utils';
import { schoolDayHasEnded, schoolNow } from '../teacher-attendance/teacher-presence.util';
import { ATTENDANCE_STAFF_ROLES } from './dto/staff-attendance.dto';
import {
  ListStaffAbsenceExcusesDto,
  RecordStaffAbsenceExcuseDto,
  ReviewStaffAbsenceExcuseDto,
  SubmitStaffAbsenceExcuseDto,
} from './dto/staff-absence-excuse.dto';
import { StaffAbsenceExcuse } from './schemas/staff-absence-excuse.schema';
import { StaffAttendance } from './schemas/staff-attendance.schema';
import { StaffAttendanceService } from './staff-attendance.service';

const displayNameOf = (person: any): string =>
  String(person?.fullName || '').trim() || person?.username || '';

const dateLabel = (d: Date): string => normalizeDate(d).toISOString().slice(0, 10);

/**
 * أعذار غياب الموظفين — supervisors, managers and service staff.
 *
 * The teacher feature (TeacherAbsenceExcuseService) carried over, with the
 * staff module's own rules: reviewed under the StaffAttendance permission,
 * and nobody rules on their own. One addition: the school can write an
 * excuse for somebody with no phone, and that one is accepted as written.
 *
 * Nothing here changes an absence count. An accepted excuse marks the day.
 */
@Injectable()
export class StaffAbsenceExcuseService {
  private readonly logger = new Logger(StaffAbsenceExcuseService.name);

  constructor(
    @InjectModel(StaffAbsenceExcuse.name)
    private readonly excuses: Model<StaffAbsenceExcuse>,
    @InjectModel(StaffAttendance.name)
    private readonly records: Model<StaffAttendance>,
    @InjectModel(Admin.name) private readonly admins: Model<Admin>,
    @InjectModel(School.name) private readonly schools: Model<School>,
    private readonly attendance: StaffAttendanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private static oid(value: unknown): Types.ObjectId | null {
    const raw = String(value ?? '');
    return /^[a-f\d]{24}$/i.test(raw) ? new Types.ObjectId(raw) : null;
  }

  private async settingsOf(schoolId: any): Promise<any> {
    const id = StaffAbsenceExcuseService.oid(schoolId);
    if (!id) throw new ForbiddenException('سياق المدرسة مطلوب');
    const school: any = await this.schools
      .findById(id, { settings: 1 })
      .setOptions({ skipTenantScope: true })
      .lean();
    if (!school?.settings) throw new NotFoundException('لم يتم العثور على إعدادات المدرسة');
    return school.settings;
  }

  /** A staff member of this school: MANAGER, SUPERVISOR or STAFF. */
  private async staffMember(schoolId: any, staffId: unknown) {
    const id = StaffAbsenceExcuseService.oid(staffId);
    if (!id) throw new BadRequestException('معرّف الموظف غير صالح');
    const person: any = await this.admins
      .findOne({
        schoolId: StaffAbsenceExcuseService.oid(schoolId),
        _id: id,
        role: { $in: ATTENDANCE_STAFF_ROLES },
      })
      .select('username fullName role createdAt')
      .lean();
    if (!person) throw new NotFoundException('الموظف غير موجود في هذه المدرسة');
    return person;
  }

  /** Owners, managers and supervisors, except the person themself. */
  private async reviewerIds(schoolId: any, exclude: unknown): Promise<string[]> {
    const admins = await this.admins
      .find({
        schoolId: StaffAbsenceExcuseService.oid(schoolId),
        role: { $in: ['OWNER', 'MANAGER', 'SUPERVISOR'] },
      })
      .select('_id')
      .lean();
    return admins.map((a: any) => String(a._id)).filter((id) => id !== String(exclude));
  }

  private assertNotOwn(user: any, staffId: unknown) {
    if (String(staffId) === String(user?.userId)) {
      throw new ForbiddenException('لا يمكنك مراجعة عذر غيابك أو تسجيله بنفسك');
    }
  }

  /**
   * The checks every excuse passes, whoever writes it: a past working day,
   * with no attendance record, and no excuse already on file.
   */
  private async assertExcusable(schoolId: any, staffId: Types.ObjectId, date: Date) {
    const settings = await this.settingsOf(schoolId);
    const today = schoolNow(settings?.timezone).date;
    if (date > today) {
      throw new BadRequestException(
        'لا يمكن تقديم عذر عن يوم لم يأتِ بعد — استخدم طلب الاستئذان',
      );
    }
    if (workingDatesBetween(settings, date, date).length === 0) {
      throw new BadRequestException('هذا اليوم ليس يوم عمل');
    }

    const attended = await this.records.exists({ staffId, date });
    if (attended) {
      throw new BadRequestException(
        'يوجد سجل حضور في هذا اليوم — عذر التأخير هو المناسب هنا',
      );
    }

    const existing = await this.excuses.exists({ staffId, date });
    if (existing) {
      throw new ConflictException('يوجد عذر عن هذا اليوم بالفعل — راجعه من قائمة الأعذار');
    }
    return settings;
  }

  /**
   * The days this person was away and has not explained. Same exclusions as
   * the teacher list: holidays, days before their account or first check-in,
   * and today until the day has ended. Staff have no per-person work days.
   */
  async pendingDays(user: any, days = 14, nowAt: Date = new Date()) {
    const staffId = StaffAbsenceExcuseService.oid(user?.userId);
    if (!staffId) throw new BadRequestException('حساب غير صالح');

    const settings = await this.settingsOf(user?.schoolId);
    if (settings?.staffCheckInEnabled !== true) {
      return { status: true, message: 'تسجيل حضور الموظفين غير مفعّل في المدرسة', data: [] };
    }

    const now = schoolNow(settings?.timezone, nowAt);
    const today = now.date;

    const [person, firstRecord]: any[] = await Promise.all([
      this.admins.findById(staffId).select('createdAt').lean(),
      this.records.findOne({ staffId }).sort({ date: 1 }).select('date').lean(),
    ]);
    if (!firstRecord) {
      return { status: true, message: 'لا توجد أيام غياب', data: [] };
    }

    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const floors = [from, normalizeDate(firstRecord.date)];
    if (person?.createdAt) floors.push(normalizeDate(person.createdAt));
    const start = new Date(Math.max(...floors.map((d) => d.getTime())));

    const todayEnded = schoolDayHasEnded(resolveDaySchedule(settings, today).endTime, now.minutes);
    const end = new Date(today);
    if (!todayEnded) end.setUTCDate(end.getUTCDate() - 1);
    if (start > end) return { status: true, message: 'لا توجد أيام غياب', data: [] };

    const workingDays = workingDatesBetween(settings, start, end);
    const range = { $gte: start, $lte: end };
    const [present, explained] = await Promise.all([
      this.records.find({ staffId, date: range }).select('date').lean(),
      this.excuses.find({ staffId, date: range }).select('date').lean(),
    ]);
    const seen = new Set<string>([
      ...present.map((r: any) => dateLabel(r.date)),
      ...explained.map((r: any) => dateLabel(r.date)),
    ]);

    const data = workingDays
      .map((d) => dateLabel(d))
      .filter((label) => !seen.has(label))
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date }));

    return { status: true, message: 'أيام غياب بلا عذر', data };
  }

  /** The person's own account. Goes to the school for review. */
  async submit(user: any, dto: SubmitStaffAbsenceExcuseDto) {
    const person = await this.staffMember(user?.schoolId, user?.userId);
    const date = normalizeDate(dto.date);
    await this.assertExcusable(user?.schoolId, person._id, date);

    const excuse = await this.excuses.create({
      staffId: person._id,
      staffName: displayNameOf(person),
      role: person.role,
      date,
      reason: dto.reason.trim(),
      attachment: dto.attachment ?? null,
      submittedAt: new Date(),
      status: 'pending',
    });

    await this.announce(excuse, user?.schoolId);

    return {
      status: true,
      message: 'تم إرسال عذر الغياب إلى إدارة المدرسة',
      data: { id: String(excuse._id), date: dateLabel(date), status: excuse.status },
    };
  }

  /**
   * The school writing the excuse for somebody — a cleaner with no phone
   * calls in, or tells the office the next morning. Accepted as written: the
   * person entering it is the one who would otherwise review it.
   */
  async record(user: any, dto: RecordStaffAbsenceExcuseDto) {
    this.assertNotOwn(user, dto.staffId);
    const person = await this.staffMember(user?.schoolId, dto.staffId);
    const date = normalizeDate(dto.date);
    await this.assertExcusable(user?.schoolId, person._id, date);

    const now = new Date();
    const byName = user?.name ?? user?.username ?? '';
    const excuse = await this.excuses.create({
      staffId: person._id,
      staffName: displayNameOf(person),
      role: person.role,
      date,
      reason: dto.reason.trim(),
      attachment: dto.attachment ?? null,
      submittedAt: now,
      status: 'accepted',
      recordedBy: StaffAbsenceExcuseService.oid(user?.userId),
      recordedByName: byName,
      reviewedBy: StaffAbsenceExcuseService.oid(user?.userId),
      reviewedByName: byName,
      reviewedAt: now,
      reviewNote: '',
    });

    // They may have a phone after all; if so, they learn it is on file.
    await this.tell(excuse, 'سُجِّل عذر غيابك', `غياب ${dateLabel(date)} — ${excuse.reason}`);

    return {
      status: true,
      message: 'تم تسجيل عذر الغياب واعتماده',
      data: this.view(excuse),
    };
  }

  /** The school's queue, pending by default. */
  async list(user: any, filters: ListStaffAbsenceExcusesDto) {
    const query: any = { status: filters.status ?? 'pending' };

    if (filters.staffId) {
      const id = StaffAbsenceExcuseService.oid(filters.staffId);
      if (!id) throw new BadRequestException('معرّف الموظف غير صالح');
      query.staffId = id;
    }
    if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = normalizeDate(filters.from);
      if (filters.to) query.date.$lte = normalizeDate(filters.to);
    }

    const rows = await this.excuses.find(query).sort({ submittedAt: -1 }).lean();
    return {
      status: true,
      message: 'تم استرجاع أعذار الغياب',
      data: rows.map((r: any) => this.view(r)),
    };
  }

  /** A person's own excuses, newest first — what became of each. */
  async mine(user: any) {
    const staffId = StaffAbsenceExcuseService.oid(user?.userId);
    if (!staffId) throw new BadRequestException('حساب غير صالح');
    const rows = await this.excuses.find({ staffId }).sort({ date: -1 }).limit(60).lean();
    return { status: true, message: 'أعذار غيابي', data: rows.map((r: any) => this.view(r)) };
  }

  async review(user: any, id: string, dto: ReviewStaffAbsenceExcuseDto) {
    const excuse = await this.findPending(id);
    this.assertNotOwn(user, excuse.staffId);

    const note = (dto.note ?? '').trim();
    if (dto.verdict === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض العذر');
    }

    excuse.status = dto.verdict;
    excuse.reviewedBy = StaffAbsenceExcuseService.oid(user?.userId);
    excuse.reviewedByName = user?.name ?? user?.username ?? '';
    excuse.reviewedAt = new Date();
    excuse.reviewNote = note;
    await excuse.save();

    const accepted = dto.verdict === 'accepted';
    await this.tell(
      excuse,
      accepted ? 'تم قبول عذر الغياب' : 'لم يُقبل عذر الغياب',
      [`غياب ${dateLabel(excuse.date)}`, note].filter(Boolean).join(' — '),
    );

    return {
      status: true,
      message: accepted ? 'تم قبول العذر' : 'تم رفض العذر',
      data: this.view(excuse),
    };
  }

  /**
   * They were not absent — out on school business, or in and forgot to check
   * in. Records their attendance for the day and closes the excuse, rather
   * than accepting an excuse for a day they worked.
   */
  async markPresent(user: any, id: string, checkInAt?: string, note?: string) {
    const excuse = await this.findPending(id);
    this.assertNotOwn(user, excuse.staffId);

    const day = dateLabel(excuse.date);
    const already = await this.records.exists({ staffId: excuse.staffId, date: excuse.date });
    if (!already) {
      const settings = await this.settingsOf(user?.schoolId);
      const time = checkInAt || resolveDaySchedule(settings, excuse.date).startTime || '07:00';
      const instant = parseCheckInTime(day, time, settings?.timezone);
      await this.attendance.createManual(user, {
        staffId: String(excuse.staffId),
        date: day,
        checkInAt: instant.toISOString(),
        notes: note ? `من مراجعة عذر الغياب: ${note}` : 'سُجّل من مراجعة عذر الغياب',
      } as any);
    }

    excuse.status = 'marked_present';
    excuse.reviewedBy = StaffAbsenceExcuseService.oid(user?.userId);
    excuse.reviewedByName = user?.name ?? user?.username ?? '';
    excuse.reviewedAt = new Date();
    excuse.reviewNote = (note ?? '').trim();
    await excuse.save();

    await this.tell(
      excuse,
      'سُجِّل حضورك',
      [`يوم ${day} مسجّل حضورًا لا غيابًا`, excuse.reviewNote].filter(Boolean).join(' — '),
    );

    return {
      status: true,
      message: 'سُجِّل حضور الموظف لهذا اليوم وأُغلق العذر',
      data: this.view(excuse),
    };
  }

  private async findPending(id: string) {
    const excuseId = StaffAbsenceExcuseService.oid(id);
    if (!excuseId) throw new BadRequestException('معرّف العذر غير صالح');
    const excuse = await this.excuses.findById(excuseId);
    if (!excuse) throw new NotFoundException('العذر غير موجود');
    if (excuse.status !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا العذر بالفعل');
    }
    return excuse;
  }

  private view(r: any) {
    return {
      id: String(r._id),
      staffId: String(r.staffId),
      staffName: r.staffName,
      role: r.role,
      date: dateLabel(r.date),
      reason: r.reason,
      attachment: r.attachment ?? null,
      status: r.status,
      submittedAt: r.submittedAt,
      recordedByName: r.recordedByName || null,
      enteredBySchool: Boolean(r.recordedBy),
      reviewedByName: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      reviewNote: r.reviewNote,
    };
  }

  /** Tell the school a new excuse is waiting. Never throws. */
  private async announce(excuse: any, schoolId: any) {
    try {
      const recipients = await this.reviewerIds(schoolId, excuse.staffId);
      const label = dateLabel(excuse.date);
      const name = excuse.staffName || 'الموظف';
      await Promise.all(
        recipients.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'staff_absence_excuse_submitted',
            title: `عذر غياب ${name}`,
            body: `${label} — ${excuse.reason}`,
            data: {
              excuseId: String(excuse._id),
              staffId: String(excuse.staffId),
              staffName: name,
              date: label,
              reason: excuse.reason,
              hasAttachment: Boolean(excuse.attachment),
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(`Could not announce staff absence excuse ${excuse?._id}: ${error?.message}`);
    }
  }

  /** Tell the person what became of it. Never throws. */
  private async tell(excuse: any, title: string, body: string) {
    try {
      await this.notifications.notify({
        recipientId: excuse.staffId,
        type: 'staff_absence_excuse_reviewed',
        title,
        body,
        data: {
          excuseId: String(excuse._id),
          date: dateLabel(excuse.date),
          status: excuse.status,
          note: excuse.reviewNote ?? '',
        },
      });
    } catch (error: any) {
      this.logger.error(`Could not notify on staff excuse ${excuse?._id}: ${error?.message}`);
    }
  }
}
