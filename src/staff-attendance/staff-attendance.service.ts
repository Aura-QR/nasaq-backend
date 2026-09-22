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
import { Role } from '../auth/enums/role.enum';
import { School } from '../platform/schools/schemas/school.schema';
import {
  calculateHaversineDistance,
  computeEarlyLeaveMinutes,
  computeLateMinutes,
  extractClientIp,
  normalizeDate,
  resolveDaySchedule,
  workingDatesBetween,
} from '../attendance/attendance.utils';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ListStaffLateReasonsDto,
  ReviewStaffLateReasonDto,
  SubmitStaffLateReasonDto,
} from './dto/staff-late-reason.dto';
import {
  ATTENDANCE_STAFF_ROLES,
  CreateManualStaffAttendanceDto,
  QueryStaffAttendanceDto,
  StaffAbsenceQueryDto,
  StaffDirectoryQueryDto,
  StaffLocationDto,
  SummaryStaffAttendanceDto,
  UpdateStaffAttendanceDto,
} from './dto/staff-attendance.dto';
import { StaffAttendance } from './schemas/staff-attendance.schema';
import { StaffLeaveRequest } from './schemas/staff-leave-request.schema';
import {
  CreateStaffLeaveRequestDto,
  ListStaffLeaveRequestsDto,
  ReviewStaffLeaveRequestDto,
} from './dto/staff-leave-request.dto';

/** A calendar date key in the school's timezone, including around UTC midnight. */
export function staffCalendarDate(
  instant: Date,
  timezone = 'Asia/Riyadh',
): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (name: string) => parts.find((p) => p.type === name)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    throw new BadRequestException('المنطقة الزمنية للمدرسة أو الوقت غير صالح');
  }
}

@Injectable()
export class StaffAttendanceService {
  constructor(
    @InjectModel(StaffAttendance.name)
    private readonly records: Model<StaffAttendance>,
    @InjectModel(Admin.name) private readonly admins: Model<Admin>,
    @InjectModel(School.name) private readonly schools: Model<School>,
    @InjectModel(StaffLeaveRequest.name)
    private readonly leaves: Model<StaffLeaveRequest>,
    private readonly notifications: NotificationsService,
  ) {}

  private readonly logger = new Logger(StaffAttendanceService.name);

  private objectId(value: string): Types.ObjectId {
    if (!/^[a-f\d]{24}$/i.test(String(value))) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }
    return new Types.ObjectId(String(value));
  }

  // Use both explicit server-derived scope and the tenant plugin. No request
  // DTO accepts schoolId, so a client cannot override this query boundary.
  private scope(user: any) {
    if (!user?.schoolId) throw new ForbiddenException('سياق المدرسة مطلوب');
    return { schoolId: this.objectId(user.schoolId) };
  }

  private date(value: string): Date {
    const result = normalizeDate(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(result.getTime()) ||
      result.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(
        'التاريخ يجب أن يكون يومًا صالحًا بصيغة YYYY-MM-DD',
      );
    }
    return result;
  }

  private async settings(user: any) {
    const school = await this.schools
      .findById(this.scope(user).schoolId, { settings: 1 })
      .setOptions({ skipTenantScope: true })
      .lean();
    if (!school?.settings)
      throw new NotFoundException('لم يتم العثور على إعدادات المدرسة');
    return school.settings;
  }

  private async staffMember(user: any, staffId: string, self = false) {
    if (self && !ATTENDANCE_STAFF_ROLES.includes(user.role)) {
      throw new ForbiddenException(
        'التسجيل الذاتي متاح للمدير والإداري والمشرف فقط',
      );
    }
    const staff = await this.admins
      .findOne({
        ...this.scope(user),
        _id: this.objectId(staffId),
        role: self ? user.role : { $in: ATTENDANCE_STAFF_ROLES },
      })
      .select('username email role')
      .lean();
    if (!staff)
      throw new NotFoundException('المدير أو المشرف غير موجود في هذه المدرسة');
    return staff;
  }

  private verifyLocation(settings: any, dto: StaffLocationDto, req: any) {
    if (!settings.staffCheckInEnabled) {
      throw new BadRequestException(
        'التسجيل الذاتي للإداريين والمشرفين غير مفعّل',
      );
    }
    if (
      !settings.location ||
      !Number.isFinite(settings.location.lat) ||
      !Number.isFinite(settings.location.lng)
    ) {
      throw new BadRequestException('لم يتم تحديد موقع المدرسة بعد');
    }
    const distanceMeters = calculateHaversineDistance(dto, settings.location);
    const verification = {
      gps: distanceMeters <= (settings.checkInRadiusMeters || 150),
      network:
        Array.isArray(settings.schoolNetworkIps) &&
        settings.schoolNetworkIps.includes(extractClientIp(req)),
    };
    if (!verification.gps && !verification.network) {
      throw new ForbiddenException(
        `الموقع الشبكي والإحداثيات خارج نطاق المدرسة (المسافة: ${distanceMeters} متر)`,
      );
    }
    return { distanceMeters, verification };
  }

  private duplicate(record: any, checkout = false): never {
    throw new ConflictException({
      message: checkout
        ? 'تم تسجيل الانصراف لهذا اليوم بالفعل'
        : 'تم تسجيل الحضور لهذا اليوم بالفعل',
      data: {
        [checkout ? 'alreadyCheckedOut' : 'alreadyCheckedIn']: true,
        record,
      },
    });
  }

  private async createRecord(payload: any) {
    try {
      return await this.records.create(payload);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existing = await this.records
        .findOne({
          schoolId: payload.schoolId,
          staffId: payload.staffId,
          date: payload.date,
        })
        .lean();
      this.duplicate(existing);
    }
  }

  private workMinutes(checkInAt: Date, checkOutAt: Date): number {
    if (checkOutAt.getTime() < checkInAt.getTime()) {
      throw new BadRequestException('وقت الانصراف لا يمكن أن يسبق وقت الحضور');
    }
    return Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
  }

  private manualTime(value: string, date: Date, settings: any): Date {
    if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      throw new BadRequestException('أرسل الوقت بصيغة ISO مع المنطقة الزمنية');
    }
    const instant = new Date(value);
    if (!Number.isFinite(instant.getTime()) || instant.getTime() > Date.now()) {
      throw new BadRequestException(
        'وقت الحضور أو الانصراف غير صالح أو في المستقبل',
      );
    }
    if (
      staffCalendarDate(instant, settings.timezone) !==
      date.toISOString().slice(0, 10)
    ) {
      throw new BadRequestException(
        'الوقت يجب أن يقع في تاريخ السجل حسب المنطقة الزمنية للمدرسة',
      );
    }
    return instant;
  }

  async checkIn(user: any, dto: StaffLocationDto, req: any) {
    const staff = await this.staffMember(user, user.userId, true);
    const settings = await this.settings(user);
    const verified = this.verifyLocation(settings, dto, req);
    const checkInAt = new Date();
    const date = this.date(staffCalendarDate(checkInAt, settings.timezone));
    const key = { ...this.scope(user), staffId: staff._id, date };
    const existing = await this.records.findOne(key).lean();
    if (existing) this.duplicate(existing);
    const schedule = resolveDaySchedule(settings, date);
    const record = await this.createRecord({
      ...key,
      name: staff.username,
      role: staff.role,
      checkInAt,
      method: 'location',
      coordinates: { lat: dto.lat, lng: dto.lng },
      ...verified,
      mockLocationSuspected: dto.mockLocationSuspected ?? false,
      lateMinutes: computeLateMinutes(
        checkInAt,
        schedule.startTime,
        settings.timezone,
      ),
      expectedWorkMinutes: schedule.expectedWorkMinutes,
      isWorkingDay: schedule.isWorkingDay,
    });
    return {
      status: true,
      message: 'تم تسجيل حضورك',
      data: {
        ...(record as any),
        /*
         * Ask now, while they are still holding the phone.
         *
         * A poller would get there up to a minute later, after they have
         * walked into the building and put it away — and a question asked
         * then is a question answered tomorrow, if at all.
         */
        lateReasonRequired: ((record as any)?.lateMinutes ?? 0) > 0,
      },
    };
  }

  async checkOut(user: any, dto: StaffLocationDto, req: any) {
    const staff = await this.staffMember(user, user.userId, true);
    const settings = await this.settings(user);
    const verified = this.verifyLocation(settings, dto, req);
    const checkOutAt = new Date();
    const date = this.date(staffCalendarDate(checkOutAt, settings.timezone));
    const key = { ...this.scope(user), staffId: staff._id, date };
    const record = await this.records.findOne(key).lean();
    if (!record) throw new BadRequestException('لا يوجد تسجيل حضور لك اليوم');
    if (record.checkOutAt) this.duplicate(record, true);
    const schedule = resolveDaySchedule(settings, date);

    /*
     * An approved استئذان, if there is one.
     *
     * The minutes are still recorded truthfully; this is what says the school
     * agreed to them. Without it somebody who asked permission and got it
     * reads in the monthly report exactly like somebody who walked out.
     */
    const approvedLeave = await this.leaves
      .findOne({ ...this.scope(user), staffId: staff._id, date, status: 'approved' })
      .lean();

    // Only one of two concurrent check-outs may close the open record.
    const updated = await this.records
      .findOneAndUpdate(
        { ...key, _id: record._id, checkOutAt: null },
        {
          $set: {
            checkOutAt,
            checkOutMethod: 'location',
            checkOutCoordinates: { lat: dto.lat, lng: dto.lng },
            checkOutDistanceMeters: verified.distanceMeters,
            checkOutVerification: verified.verification,
            checkOutMockLocationSuspected: dto.mockLocationSuspected ?? false,
            workMinutes: this.workMinutes(record.checkInAt, checkOutAt),
            earlyLeaveMinutes: computeEarlyLeaveMinutes(
              checkOutAt,
              schedule.endTime,
              settings.timezone,
            ),
            earlyLeaveApproved: approvedLeave != null,
            approvedLeaveAt: (approvedLeave as any)?.leaveAt ?? null,
          },
        },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) {
      const current = await this.records.findOne(key).lean();
      if (!current) throw new NotFoundException('سجل الحضور غير موجود');
      this.duplicate(current, true);
    }
    return { status: true, message: 'تم تسجيل انصرافك', data: updated };
  }

  async createManual(user: any, dto: CreateManualStaffAttendanceDto) {
    // Resolve the target first: the owner is not staff, so a record for them is
    // "not found" whoever asks. Only a real staff member can be one's own.
    const staff = await this.staffMember(user, dto.staffId);
    this.assertNotOwnRecord(user, staff._id);
    const settings = await this.settings(user);
    const date = this.date(dto.date);
    const checkInAt = this.manualTime(dto.checkInAt, date, settings);
    const checkOutAt =
      dto.checkOutAt !== undefined
        ? this.manualTime(dto.checkOutAt, date, settings)
        : null;
    const schedule = resolveDaySchedule(settings, date);
    const record = await this.createRecord({
      ...this.scope(user),
      staffId: staff._id,
      name: staff.username,
      role: staff.role,
      date,
      checkInAt,
      checkOutAt,
      method: 'manual',
      checkOutMethod: checkOutAt ? 'manual' : null,
      checkOutVerification: checkOutAt ? { gps: false, network: false } : null,
      recordedBy: this.objectId(user.userId),
      notes: dto.notes ?? '',
      lateMinutes: computeLateMinutes(
        checkInAt,
        schedule.startTime,
        settings.timezone,
      ),
      earlyLeaveMinutes: checkOutAt
        ? computeEarlyLeaveMinutes(
            checkOutAt,
            schedule.endTime,
            settings.timezone,
          )
        : null,
      workMinutes: checkOutAt ? this.workMinutes(checkInAt, checkOutAt) : null,
      expectedWorkMinutes: schedule.expectedWorkMinutes,
      isWorkingDay: schedule.isWorkingDay,
    });
    return { status: true, message: 'تم تسجيل الحضور يدويًا', data: record };
  }

  private filter(
    user: any,
    query: QueryStaffAttendanceDto | SummaryStaffAttendanceDto,
  ): any {
    const filter: any = this.scope(user);
    if (query.staffId) filter.staffId = this.objectId(query.staffId);
    if (query.role) filter.role = query.role;
    if (
      query.dateFrom &&
      query.dateTo &&
      this.date(query.dateFrom) > this.date(query.dateTo)
    ) {
      throw new BadRequestException('بداية الفترة يجب ألا تكون بعد نهايتها');
    }
    const exactDate = (query as QueryStaffAttendanceDto).date;
    if (exactDate) {
      filter.date = this.date(exactDate);
    } else if (query.dateFrom || query.dateTo) {
      filter.date = {};
      if (query.dateFrom) filter.date.$gte = this.date(query.dateFrom);
      if (query.dateTo) filter.date.$lte = this.date(query.dateTo);
    }
    if ((query as QueryStaffAttendanceDto).method)
      filter.method = (query as QueryStaffAttendanceDto).method;
    return filter;
  }

  async getMyAttendance(user: any, query: QueryStaffAttendanceDto) {
    await this.staffMember(user, user.userId, true);
    return this.findAll(user, {
      ...query,
      staffId: String(user.userId),
      role: undefined,
    });
  }

  async findAll(user: any, query: QueryStaffAttendanceDto) {
    const filter = this.filter(user, query);
    const page = query.page || 1;
    const limit = query.limit || 10;
    const [data, total] = await Promise.all([
      this.records
        .find(filter)
        .sort({ date: -1, checkInAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.records.countDocuments(filter),
    ]);
    // status prevents ResponseInterceptor from discarding sibling metadata.
    return {
      status: true,
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async listStaff(user: any, query: StaffDirectoryQueryDto) {
    const staff = await this.admins
      .find({
        ...this.scope(user),
        role: query.role || { $in: ATTENDANCE_STAFF_ROLES },
      })
      .select('username email role')
      .sort({ username: 1, _id: 1 })
      .lean();
    return {
      status: true,
      data: staff.map((s) => ({
        staffId: s._id,
        name: s.username,
        email: s.email,
        role: s.role,
      })),
    };
  }

  async findAbsent(user: any, query: StaffAbsenceQueryDto) {
    const settings = await this.settings(user);
    const day = query.date || staffCalendarDate(new Date(), settings.timezone);
    const date = this.date(day);
    if (day > staffCalendarDate(new Date(), settings.timezone)) {
      throw new BadRequestException('لا يمكن حساب الغياب لتاريخ مستقبلي');
    }
    const schedule = resolveDaySchedule(settings, date);
    if (!schedule.isWorkingDay) {
      return {
        status: true,
        date: day,
        isWorkingDay: false,
        holidayName: schedule.holidayName ?? null,
        totalAbsent: 0,
        absentStaff: [],
      };
    }
    const [staff, present] = await Promise.all([
      this.listStaff(user, query),
      this.records
        .find({ ...this.scope(user), date })
        .select('staffId')
        .lean(),
    ]);
    const presentIds = new Set(present.map((r) => String(r.staffId)));
    const absentStaff = staff.data.filter(
      (s) => !presentIds.has(String(s.staffId)),
    );
    return {
      status: true,
      date: day,
      isWorkingDay: true,
      totalAbsent: absentStaff.length,
      absentStaff,
    };
  }

  // ──────────────────────────────────── the lateness, and its account

  /**
   * Everyone the school's rulings go to.
   *
   * The same recipients the teacher queue notifies. A supervisor explaining
   * their own lateness is excluded, so they are not told about themselves.
   */
  private async adminIds(schoolId: any, exclude?: any): Promise<string[]> {
    if (!schoolId) return [];

    const admins = await this.admins
      .find({
        schoolId: this.objectId(String(schoolId)),
        role: { $in: ['OWNER', 'MANAGER'] },
      })
      .select('_id')
      .setOptions({ skipTenantScope: true })
      .lean()
      .exec();

    const skip = exclude ? String(exclude) : null;
    return admins
      .map((admin: any) => String(admin._id))
      .filter((id) => id !== skip);
  }

  /** Today's lateness, if this person has one nobody has explained. */
  async pendingLateReason(user: any) {
    const settings = await this.settings(user);
    const today = this.date(staffCalendarDate(new Date(), settings.timezone));

    const record = await this.records
      .findOne({
        ...this.scope(user),
        staffId: this.objectId(String(user.userId)),
        date: today,
        lateMinutes: { $gt: 0 },
        lateReason: null,
      })
      .lean()
      .exec();

    if (!record) return { status: true, data: { pending: false } };

    return {
      status: true,
      data: {
        pending: true,
        attendanceId: String((record as any)._id),
        date: today.toISOString().slice(0, 10),
        lateMinutes: (record as any).lateMinutes,
        checkInAt: (record as any).checkInAt,
      },
    };
  }

  /** Written once. A second account of the same day rewrites history. */
  async submitLateReason(user: any, dto: SubmitStaffLateReasonDto) {
    const settings = await this.settings(user);
    const date = dto.date
      ? this.date(dto.date)
      : this.date(staffCalendarDate(new Date(), settings.timezone));

    const record = await this.records.findOne({
      ...this.scope(user),
      staffId: this.objectId(String(user.userId)),
      date,
    });

    if (!record) {
      throw new NotFoundException('لا يوجد سجل حضور لك في هذا التاريخ');
    }
    if (!record.lateMinutes || record.lateMinutes <= 0) {
      throw new BadRequestException('لا يوجد تأخير مسجل في هذا اليوم');
    }
    if (record.lateReason) {
      throw new ConflictException('تم إرسال سبب التأخير لهذا اليوم بالفعل');
    }

    const reason = dto.reason.trim();
    record.lateReason = reason;
    record.lateReasonAt = new Date();
    // Waiting on the school from the moment it is written, so it lands in the
    // review list rather than in a field nobody rules on.
    record.lateReasonStatus = 'pending';
    await record.save();

    const dateLabel = date.toISOString().slice(0, 10);
    const personName = record.name || 'الموظف';

    // Never let a failed notice undo a saved explanation.
    try {
      const admins = await this.adminIds(user.schoolId, user.userId);
      await Promise.all(
        admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'staff_late_reason_submitted',
            title: `سبب تأخير ${personName}`,
            body: `${dateLabel} · تأخر ${record.lateMinutes} دقيقة — ${reason}`,
            data: {
              attendanceId: String(record._id),
              staffId: String(record.staffId),
              staffName: personName,
              role: record.role,
              date: dateLabel,
              lateMinutes: record.lateMinutes,
              reason,
              hasReason: true,
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Could not announce staff late reason ${record._id}: ${error?.message}`,
      );
    }

    return {
      status: true,
      message: 'تم إرسال سبب التأخير إلى إدارة المدرسة',
      data: {
        attendanceId: String(record._id),
        date: dateLabel,
        lateMinutes: record.lateMinutes,
        lateReason: record.lateReason,
        lateReasonAt: record.lateReasonAt,
      },
    };
  }

  /**
   * The review queue.
   *
   * Four states, not three. A lateness nobody has explained matches none of
   * the verdicts, so without `missing` the ones that need a nudge are exactly
   * the ones no filter can show.
   */
  async listLateReasons(
    user: any,
    filters: ListStaffLateReasonsDto,
    page = 1,
    limit = 20,
  ) {
    const filter: any = { ...this.scope(user), lateMinutes: { $gt: 0 } };

    switch (filters.status ?? 'pending') {
      case 'missing':
        filter.lateReason = null;
        break;
      case 'accepted':
      case 'rejected':
        filter.lateReasonStatus = filters.status;
        break;
      default:
        filter.lateReason = { $ne: null };
        filter.lateReasonStatus = 'pending';
    }

    if (filters.staffId) filter.staffId = this.objectId(filters.staffId);
    if (filters.dateFrom || filters.dateTo) {
      filter.date = {};
      if (filters.dateFrom) filter.date.$gte = this.date(filters.dateFrom);
      if (filters.dateTo) filter.date.$lte = this.date(filters.dateTo);
    }

    const skip = (Math.max(page, 1) - 1) * limit;

    const [rows, total] = await Promise.all([
      this.records
        .find(filter)
        .sort({ date: -1, lateMinutes: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.records.countDocuments(filter).exec(),
    ]);

    return {
      status: true,
      data: {
        page,
        limit,
        total,
        items: rows.map((row: any) => ({
          attendanceId: String(row._id),
          staffId: String(row.staffId),
          staffName: row.name ?? '',
          role: row.role ?? '',
          date: new Date(row.date).toISOString().slice(0, 10),
          checkInAt: row.checkInAt,
          lateMinutes: row.lateMinutes,
          lateReason: row.lateReason,
          lateReasonAt: row.lateReasonAt,
          lateReasonStatus: row.lateReasonStatus,
          lateReasonReviewedByName: row.lateReasonReviewedByName ?? '',
          lateReasonReviewedAt: row.lateReasonReviewedAt,
          lateReasonReviewNote: row.lateReasonReviewNote ?? '',
        })),
      },
    };
  }

  /** The school's answer. The person is told either way. */
  async reviewLateReason(
    user: any,
    id: string,
    dto: ReviewStaffLateReasonDto,
  ) {
    const record = await this.records.findOne({
      ...this.scope(user),
      _id: this.objectId(id),
    });

    if (!record) throw new NotFoundException('سجل الحضور غير موجود');
    if (!record.lateReason) {
      throw new BadRequestException('لا يوجد سبب تأخير لمراجعته');
    }
    if (record.lateReasonStatus && record.lateReasonStatus !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا السبب بالفعل');
    }

    // Nobody rules on their own lateness, for the same reason nobody edits
    // their own attendance record here.
    this.assertNotOwnRecord(user, record.staffId);

    const note = (dto.note ?? '').trim();
    if (dto.verdict === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض العذر');
    }

    record.lateReasonStatus = dto.verdict;
    record.lateReasonReviewedBy = this.objectId(String(user.userId));
    record.lateReasonReviewedByName = user.name ?? user.username ?? '';
    record.lateReasonReviewedAt = new Date();
    record.lateReasonReviewNote = note;
    await record.save();

    const dateLabel = new Date(record.date).toISOString().slice(0, 10);
    const accepted = dto.verdict === 'accepted';

    // Never let a failed notice undo a saved ruling.
    try {
      await this.notifications.notify({
        recipientId: record.staffId,
        type: 'staff_late_reason_reviewed',
        title: accepted ? 'تم قبول عذر التأخير' : 'لم يُقبل عذر التأخير',
        body: [`تأخير ${dateLabel} · ${record.lateMinutes} دقيقة`, note]
          .filter(Boolean)
          .join(' — '),
        data: {
          attendanceId: String(record._id),
          date: dateLabel,
          lateMinutes: record.lateMinutes,
          lateReasonStatus: record.lateReasonStatus,
          note,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Could not announce staff late verdict on ${record._id}: ${error?.message}`,
      );
    }

    return {
      status: true,
      message: accepted ? 'تم قبول العذر' : 'تم رفض العذر',
      data: {
        attendanceId: String(record._id),
        lateReasonStatus: record.lateReasonStatus,
        lateReasonReviewNote: record.lateReasonReviewNote,
        lateReasonReviewedAt: record.lateReasonReviewedAt,
      },
    };
  }

  // ──────────────────────────────────────────────── الاستئذان

  /**
   * Ask to leave before the end of the day.
   *
   * A second request for the same day edits the first rather than adding one:
   * a day has one answer, and two open asks make "is this person excused
   * today?" unanswerable.
   */
  async createLeave(user: any, dto: CreateStaffLeaveRequestDto) {
    // A supervisor files only for themselves. A manager or owner may file on
    // behalf, which is how somebody phoning in at seven in the morning gets
    // recorded at all.
    const onBehalf = dto.staffId && String(dto.staffId) !== String(user.userId);
    if (onBehalf && user?.role === Role.SUPERVISOR) {
      throw new ForbiddenException('لا يمكنك تقديم استئذان نيابة عن غيرك');
    }

    const targetId = onBehalf ? String(dto.staffId) : String(user.userId);
    const person = await this.staffMember(user, targetId, !onBehalf);
    const date = this.date(dto.date);

    const existing = await this.leaves.findOne({
      ...this.scope(user),
      staffId: person._id,
      date,
    });

    if (existing) {
      if (existing.status !== 'pending') {
        throw new ConflictException(
          `تمت مراجعة استئذان هذا اليوم بالفعل (${existing.status}).`,
        );
      }
      existing.leaveAt = dto.leaveAt;
      existing.reason = dto.reason ?? '';
      await existing.save();
      return {
        status: true,
        message: 'تم تحديث طلب الاستئذان',
        data: existing,
      };
    }

    const created = await new this.leaves({
      ...this.scope(user),
      staffId: person._id,
      staffName: person.username,
      role: person.role,
      date,
      leaveAt: dto.leaveAt,
      reason: dto.reason ?? '',
      status: 'pending',
    }).save();

    /*
     * Tell the people who decide.
     *
     * A request nobody is told about waits in a list nobody opened, and the
     * person who asked at eight in the morning is still waiting at noon.
     */
    try {
      const admins = await this.adminIds(user.schoolId, user.userId);
      const dateLabel = date.toISOString().slice(0, 10);
      await Promise.all(
        admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'staff_leave_requested',
            title: `طلب استئذان — ${person.username}`,
            body: [`${dateLabel} · انصراف ${dto.leaveAt}`, dto.reason]
              .filter(Boolean)
              .join(' — '),
            data: {
              leaveRequestId: String(created._id),
              staffId: String(person._id),
              staffName: person.username,
              date: dateLabel,
              leaveAt: dto.leaveAt,
            },
          }),
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Could not announce staff leave ${created._id}: ${error?.message}`,
      );
    }

    return {
      status: true,
      message: 'تم إرسال طلب الاستئذان',
      data: created,
    };
  }

  /** A supervisor caller always gets only their own. */
  async listLeaves(user: any, query: ListStaffLeaveRequestsDto) {
    const filter: any = { ...this.scope(user) };

    if (user?.role === Role.SUPERVISOR) {
      filter.staffId = this.objectId(String(user.userId));
    } else if (query.staffId) {
      filter.staffId = this.objectId(query.staffId);
    }

    if (query.status) filter.status = query.status;

    if (query.date) {
      filter.date = this.date(query.date);
    } else if (query.from || query.to) {
      filter.date = {};
      if (query.from) filter.date.$gte = this.date(query.from);
      if (query.to) filter.date.$lte = this.date(query.to);
    }

    const rows = await this.leaves
      .find(filter)
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();

    return {
      status: true,
      total: rows.length,
      data: rows.map((row: any) => ({
        ...row,
        date: new Date(row.date).toISOString().slice(0, 10),
      })),
    };
  }

  /** The decision. The person is told either way. */
  async reviewLeave(user: any, id: string, dto: ReviewStaffLeaveRequestDto) {
    const request = await this.leaves.findOne({
      ...this.scope(user),
      _id: this.objectId(id),
    });

    if (!request) throw new NotFoundException('طلب الاستئذان غير موجود');

    // Nobody approves their own leave, for the same reason nobody edits their
    // own attendance record here.
    if (String(request.staffId) === String(user.userId)) {
      throw new ForbiddenException('لا يمكنك مراجعة استئذانك بنفسك');
    }

    if (request.status !== 'pending') {
      throw new ConflictException('تمت مراجعة هذا الطلب بالفعل');
    }

    const note = (dto.reviewNote ?? '').trim();
    if (dto.status === 'rejected' && !note) {
      throw new BadRequestException('اذكر سبب رفض الاستئذان');
    }

    request.status = dto.status;
    request.reviewNote = note;
    request.reviewedBy = this.objectId(String(user.userId));
    request.reviewedByName = user?.name ?? user?.username ?? '';
    request.reviewedAt = new Date();
    await request.save();

    const dateLabel = new Date(request.date).toISOString().slice(0, 10);
    const approved = dto.status === 'approved';

    // Never let a failed notice undo a saved decision.
    try {
      await this.notifications.notify({
        recipientId: request.staffId,
        type: approved ? 'staff_leave_approved' : 'staff_leave_rejected',
        title: approved
            ? 'تمت الموافقة على استئذانك'
            : 'تم رفض طلب الاستئذان',
        body: [dateLabel, `انصراف ${request.leaveAt}`, note]
          .filter(Boolean)
          .join(' · '),
        data: {
          leaveRequestId: String(request._id),
          date: dateLabel,
          leaveAt: request.leaveAt,
          status: dto.status,
          note,
        },
      });
    } catch (error: any) {
      this.logger.error(
        `Could not announce staff leave verdict ${request._id}: ${error?.message}`,
      );
    }

    return {
      status: true,
      message: approved ? 'تمت الموافقة على الاستئذان' : 'تم رفض الاستئذان',
      data: request,
    };
  }

  /**
   * Withdrawing a request.
   *
   * Only while it is still pending: a decision already taken was acted on —
   * the day may already be covered around it — and deleting it silently
   * leaves the office believing something it no longer sees.
   */
  async cancelLeave(user: any, id: string) {
    const request = await this.leaves.findOne({
      ...this.scope(user),
      _id: this.objectId(id),
    });

    if (!request) throw new NotFoundException('طلب الاستئذان غير موجود');

    const own = String(request.staffId) === String(user.userId);
    if (!own && user?.role === Role.SUPERVISOR) {
      throw new ForbiddenException('لا يمكنك حذف استئذان غيرك');
    }
    if (request.status !== 'pending') {
      throw new ConflictException(
        'تمت مراجعة الطلب بالفعل — راجع الإدارة لتعديله.',
      );
    }

    await this.leaves.deleteOne({ _id: request._id }).exec();
    return { status: true, message: 'تم حذف طلب الاستئذان' };
  }

  async getSummary(user: any, query: SummaryStaffAttendanceDto) {
    const data = await this.records.aggregate([
      { $match: this.filter(user, query) },
      { $sort: { date: -1, _id: -1 } },
      {
        $group: {
          _id: '$staffId',
          name: { $first: '$name' },
          role: { $first: '$role' },
          daysPresent: { $sum: 1 },
          daysLate: { $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] } },
          totalLateMinutes: { $sum: { $ifNull: ['$lateMinutes', 0] } },
          daysLeftEarly: {
            $sum: { $cond: [{ $gt: ['$earlyLeaveMinutes', 0] }, 1, 0] },
          },
          totalEarlyLeaveMinutes: {
            $sum: { $ifNull: ['$earlyLeaveMinutes', 0] },
          },
          totalWorkMinutes: { $sum: { $ifNull: ['$workMinutes', 0] } },
          totalExpectedWorkMinutes: {
            $sum: { $ifNull: ['$expectedWorkMinutes', 0] },
          },
          daysMissingCheckOut: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ['$checkOutAt', null] }, null] },
                1,
                0,
              ],
            },
          },
          daysLatenessNotTracked: {
            $sum: {
              $cond: [
                { $eq: [{ $ifNull: ['$lateMinutes', null] }, null] },
                1,
                0,
              ],
            },
          },
          daysEarlyLeaveNotTracked: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: [{ $ifNull: ['$checkOutAt', null] }, null] },
                    { $eq: [{ $ifNull: ['$earlyLeaveMinutes', null] }, null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          daysOnDayOff: {
            $sum: { $cond: [{ $eq: ['$isWorkingDay', false] }, 1, 0] },
          },
          // Only these count against the school's working days. Somebody who
          // came in on a Friday has not thereby covered a Tuesday.
          daysPresentOnWorkingDays: {
            $sum: { $cond: [{ $eq: ['$isWorkingDay', false] }, 0, 1] },
          },
        },
      },
      { $set: { staffId: '$_id' } },
      { $project: { _id: 0 } },
      { $sort: { name: 1, staffId: 1 } },
    ]);

    /*
     * Absence, which nothing above can express.
     *
     * Every figure so far comes from a record that exists. Absence is the
     * days with no record at all, so somebody who never came in all month has
     * no records and was simply not listed — the one person a monthly review
     * looks for was the one person missing from it. The same hole the teacher
     * report had.
     */
    const settings = await this.settings(user);
    const workingDays = workingDatesBetween(
      settings,
      normalizeDate(query.dateFrom),
      normalizeDate(query.dateTo),
    ).length;

    const directory = await this.listStaff(user, {
      role: (query as any).role,
    } as StaffDirectoryQueryDto);

    const byStaff = new Map(
      data.map((row: any) => [String(row.staffId), row]),
    );

    const wanted = (query as any).staffId
      ? String((query as any).staffId)
      : null;

    for (const person of directory.data) {
      const id = String(person.staffId);
      if (wanted && id !== wanted) continue;
      if (byStaff.has(id)) continue;

      const blank = {
        staffId: person.staffId,
        name: person.name,
        role: person.role,
        daysPresent: 0,
        daysLate: 0,
        totalLateMinutes: 0,
        daysLeftEarly: 0,
        totalEarlyLeaveMinutes: 0,
        totalWorkMinutes: 0,
        totalExpectedWorkMinutes: 0,
        daysMissingCheckOut: 0,
        daysLatenessNotTracked: 0,
        daysEarlyLeaveNotTracked: 0,
        daysOnDayOff: 0,
        daysPresentOnWorkingDays: 0,
      };
      data.push(blank);
      byStaff.set(id, blank);
    }

    for (const row of data as any[]) {
      // Never negative: a school that shortened its week mid-period can leave
      // more attended days on file than the schedule now has working days,
      // and "-2 days absent" is a number nobody can act on.
      row.workingDays = workingDays;
      row.daysAbsent = Math.max(
        0,
        workingDays - (row.daysPresentOnWorkingDays ?? 0),
      );
    }

    data.sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ar'),
    );

    return {
      status: true,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      // What absence is measured against. Without it the column is a number
      // with no denominator.
      workingDays,
      totalStaff: data.length,
      data,
    };
  }

  async update(user: any, id: string, dto: UpdateStaffAttendanceDto) {
    const record = await this.records.findOne({
      ...this.scope(user),
      _id: this.objectId(id),
    });
    if (!record) throw new NotFoundException('سجل الحضور غير موجود');
    this.assertNotOwnRecord(user, record.staffId);
    if (dto.checkInAt !== undefined || dto.checkOutAt !== undefined) {
      const settings = await this.settings(user);
      const schedule = resolveDaySchedule(settings, record.date);
      const checkInAt = dto.checkInAt !== undefined
        ? this.manualTime(dto.checkInAt, record.date, settings) : record.checkInAt;
      const checkOutAt = dto.checkOutAt !== undefined
        ? this.manualTime(dto.checkOutAt, record.date, settings) : record.checkOutAt;
      const checkInChanged = checkInAt.getTime() !== record.checkInAt.getTime();
      const checkOutChanged = checkOutAt?.getTime() !== record.checkOutAt?.getTime();
      if (checkInChanged) {
        record.checkInAt = checkInAt;
        record.method = 'manual';
        record.coordinates = null;
        record.distanceMeters = null;
        record.verification = { gps: false, network: false };
        record.mockLocationSuspected = false;
        record.lateMinutes = computeLateMinutes(
          record.checkInAt,
          schedule.startTime,
          settings.timezone,
        );
        record.expectedWorkMinutes = schedule.expectedWorkMinutes;
        record.isWorkingDay = schedule.isWorkingDay;
      }
      if (checkOutChanged) {
        record.checkOutAt = checkOutAt;
        record.checkOutMethod = 'manual';
        record.checkOutCoordinates = null;
        record.checkOutDistanceMeters = null;
        record.checkOutVerification = { gps: false, network: false };
        record.checkOutMockLocationSuspected = false;
        record.earlyLeaveMinutes = computeEarlyLeaveMinutes(
          record.checkOutAt,
          schedule.endTime,
          settings.timezone,
        );
      }
      if ((checkInChanged || checkOutChanged) && record.checkOutAt)
        record.workMinutes = this.workMinutes(
          record.checkInAt,
          record.checkOutAt,
        );
    }
    if (dto.notes !== undefined) record.notes = dto.notes ?? '';
    record.recordedBy = this.objectId(user.userId);
    await record.save();
    return { status: true, message: 'تم تعديل سجل الحضور', data: record };
  }

  async delete(user: any, id: string) {
    const filter = {
      ...this.scope(user),
      _id: this.objectId(id),
    };
    const record = await this.records.findOne(filter).select('staffId').lean();
    if (!record) throw new NotFoundException('سجل الحضور غير موجود');
    this.assertNotOwnRecord(user, record.staffId);
    const removed = await this.records.findOneAndDelete({ ...filter, staffId: record.staffId });
    if (!removed) throw new NotFoundException('سجل الحضور غير موجود');
    return { status: true, message: 'تم حذف سجل الحضور بنجاح' };
  }

  private assertNotOwnRecord(user: any, staffId: unknown) {
    if (String(staffId) === String(user.userId)) {
      throw new ForbiddenException('لا يمكن تسجيل أو تعديل أو حذف حضورك بنفسك. اطلب ذلك من مالك المدرسة.');
    }
  }
}
