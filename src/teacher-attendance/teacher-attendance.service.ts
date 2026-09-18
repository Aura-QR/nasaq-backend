import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from 'src/platform/schools/schemas/school.schema';
import { Admin } from 'src/admin/schemas/admin.schema';
import { NotificationsService } from 'src/notifications/notifications.service';
import { LeaveRequest } from '../duty/schemas/leave-request.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { CheckInTeacherAttendanceDto } from './dto/check-in-teacher-attendance.dto';
import { SubmitLateReasonDto } from './dto/submit-late-reason.dto';
import { CreateManualTeacherAttendanceDto } from './dto/create-manual-teacher-attendance.dto';
import { QueryTeacherAttendanceDto } from './dto/query-teacher-attendance.dto';
import { CheckOutTeacherAttendanceDto } from './dto/check-out-teacher-attendance.dto';
import { SummaryTeacherAttendanceDto } from './dto/summary-teacher-attendance.dto';
import { UpdateTeacherAttendanceDto } from './dto/update-teacher-attendance.dto';
import { TeacherAttendance } from './schemas/teacher-attendance.schema';

import {
  calculateHaversineDistance,
  normalizeDate,
  parseCheckInTime,
  computeLateMinutes,
  computeEarlyLeaveMinutes,
  resolveDaySchedule,
  extractClientIp,
} from '../attendance/attendance.utils';

// Preserve existing imports from this service for callers and tests.
export * from '../attendance/attendance.utils';

@Injectable()
export class TeacherAttendanceService {
  private readonly logger = new Logger(TeacherAttendanceService.name);

  constructor(
    @InjectModel(TeacherAttendance.name)
    private readonly teacherAttendanceModel: Model<TeacherAttendance>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(School.name)
    private readonly schoolModel: Model<School>,
    // The model rather than DutyService: this is one read, and injecting the
    // service would make attendance depend on a module that already reads
    // attendance.
    @InjectModel(LeaveRequest.name)
    private readonly leaveRequestModel: Model<LeaveRequest>,
    // Who a lateness is reported to. The owner, managers and supervisors of
    // this school all live on the Admin collection.
    @InjectModel(Admin.name)
    private readonly adminModel: Model<Admin>,
    private readonly notifications: NotificationsService,
  ) {}

  /** "HH:mm" in the school's timezone — what a person would have read on the clock. */
  private clockTime(at: Date, timezone?: string): string {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone || 'UTC',
      }).format(at);
    } catch {
      // An unknown timezone string must not cost the notice.
      return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      }).format(at);
    }
  }

  /**
   * The owner, managers and supervisors of a school.
   *
   * `exclude` drops whoever caused the event: an admin who records a lateness
   * by hand does not need to be told about it, and a notice they wrote to
   * themselves makes the bell look broken.
   */
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
    return admins
      .map((admin: any) => String(admin._id))
      .filter((id) => id !== skip);
  }

  /**
   * Tell the school a teacher was late, and ask the teacher why.
   *
   * Both halves matter and neither works alone. A director who sees "20
   * minutes" and nothing else is holding an accusation with no reply; a
   * teacher asked for a reason nobody reads is filling in a form. So the ask
   * goes out at the same moment as the report, and the answer
   * (`submitLateReason`) travels back to the same people.
   *
   * Never throws. A teacher whose check-in succeeded must not be told it
   * failed because a notice could not be written.
   */
  private async announceLateness(
    record: any,
    teacherName: string,
    schoolId: any,
    actorId?: any,
    timezone?: string,
  ): Promise<void> {
    const lateMinutes = Number(record?.lateMinutes ?? 0);
    if (!Number.isFinite(lateMinutes) || lateMinutes <= 0) return;

    const dateLabel = normalizeDate(record.date).toISOString().slice(0, 10);
    const arrivedAt = this.clockTime(record.checkInAt, timezone);
    const payload = {
      attendanceId: String(record._id),
      teacherId: String(record.teacherId),
      teacherName,
      date: dateLabel,
      lateMinutes,
    };

    try {
      const admins = await this.schoolAdminIds(schoolId, actorId);

      await Promise.all([
        ...admins.map((recipientId) =>
          this.notifications.notify({
            recipientId,
            type: 'teacher_late',
            title: `تأخر ${teacherName} عن موعد الحضور`,
            body: `تأخر ${lateMinutes} دقيقة — وصل الساعة ${arrivedAt} بتاريخ ${dateLabel}`,
            data: { ...payload, hasReason: false },
          }),
        ),
        this.notifications.notify({
          recipientId: record.teacherId,
          type: 'late_reason_required',
          title: 'يُرجى بيان سبب التأخير',
          body: `سُجّل تأخيرك اليوم ${lateMinutes} دقيقة. اذكر السبب ليصل إلى إدارة المدرسة.`,
          data: payload,
        }),
      ]);
    } catch (error: any) {
      this.logger.error(
        `Could not announce lateness on ${record._id}: ${error?.message}`,
      );
    }
  }

  /**
   * The lateness this teacher still owes an explanation for, if any.
   *
   * The dialog cannot depend on the check-in response alone: a teacher who
   * dismisses it, whose phone dies, or whose lateness was recorded for them by
   * an administrator would never be asked. This is what the client checks on
   * open, so the question survives all three.
   */
  async pendingLateReason(user: any) {
    const today = normalizeDate(new Date());

    const record = await this.teacherAttendanceModel
      .findOne({
        teacherId: new Types.ObjectId(String(user.userId)),
        date: today,
        lateMinutes: { $gt: 0 },
        lateReason: null,
      })
      .lean()
      .exec();

    if (!record) {
      return { status: true, data: { pending: false } };
    }

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

  /**
   * The teacher's own account of a lateness, sent on to the school.
   *
   * Written once: a reason that can be revised after the director has read it
   * is a reason the director cannot rely on. A correction is a conversation,
   * not an edit.
   */
  async submitLateReason(user: any, dto: SubmitLateReasonDto) {
    const date = normalizeDate(dto.date ?? new Date());

    const record = await this.teacherAttendanceModel.findOne({
      teacherId: new Types.ObjectId(String(user.userId)),
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
    await record.save();

    const dateLabel = date.toISOString().slice(0, 10);
    const teacherName = record.name || 'المعلم';
    const admins = await this.schoolAdminIds(user.schoolId);

    await Promise.all(
      admins.map((recipientId) =>
        this.notifications.notify({
          recipientId,
          type: 'late_reason_submitted',
          title: `سبب تأخير ${teacherName}`,
          body: `${dateLabel} · تأخر ${record.lateMinutes} دقيقة — ${reason}`,
          data: {
            attendanceId: String(record._id),
            teacherId: String(record.teacherId),
            teacherName,
            date: dateLabel,
            lateMinutes: record.lateMinutes,
            reason,
            hasReason: true,
          },
        }),
      ),
    );

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

  async checkIn(user: any, dto: CheckInTeacherAttendanceDto, req?: any) {
    const school = await this.schoolModel
      .findById(user.schoolId, { settings: 1 })
      .setOptions({ skipTenantScope: true })
      .lean();

    if (!school || !school.settings) {
      throw new BadRequestException('لم يتم العثور على إعدادات المدرسة');
    }

    if (!school.settings.teacherCheckInEnabled) {
      throw new BadRequestException('التسجيل الذاتي غير مفعّل');
    }

    if (
      !school.settings.location ||
      typeof school.settings.location.lat !== 'number' ||
      typeof school.settings.location.lng !== 'number'
    ) {
      throw new BadRequestException('لم يتم تحديد موقع المدرسة بعد');
    }

    const today = normalizeDate(new Date());

    // Check if teacher already checked in today
    const existing = await this.teacherAttendanceModel.findOne({
      teacherId: new Types.ObjectId(user.userId),
      date: today,
    });

    if (existing) {
      // 409, but carrying the existing record so a double tap can show
      // "you checked in at 07:52" without a second round trip. The global
      // exception filter forwards `data` when it is explicitly supplied.
      throw new HttpException(
        {
          status: false,
          message: 'تم تسجيل حضورك اليوم بالفعل',
          data: {
            alreadyCheckedIn: true,
            checkInAt: existing.checkInAt,
            distanceMeters: existing.distanceMeters,
            verification: existing.verification,
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const distanceMeters = calculateHaversineDistance(
      { lat: dto.lat, lng: dto.lng },
      school.settings.location,
    );
    const radius = school.settings.checkInRadiusMeters || 150;
    const gpsPassed = distanceMeters <= radius;

    const clientIp = extractClientIp(req);
    const networkPassed =
      Array.isArray(school.settings.schoolNetworkIps) &&
      school.settings.schoolNetworkIps.includes(clientIp);

    if (!gpsPassed && !networkPassed) {
      throw new ForbiddenException(
        `الموقع الشبكي والإحداثيات خارج نطاق المدرسة (المسافة: ${distanceMeters} متر)`,
      );
    }

    const teacher = await this.teacherModel
      .findById(user.userId)
      .setOptions({ skipTenantScope: true });

    if (!teacher) {
      throw new NotFoundException('المعلم غير موجود');
    }

    const checkInAt = new Date();
    const daySchedule = resolveDaySchedule(school.settings, today);

    const attendance = await this.teacherAttendanceModel.create({
      teacherId: new Types.ObjectId(user.userId),
      date: today,
      checkInAt,
      lateMinutes: computeLateMinutes(
        checkInAt,
        daySchedule.startTime,
        school.settings.timezone,
      ),
      expectedWorkMinutes: daySchedule.expectedWorkMinutes,
      isWorkingDay: daySchedule.isWorkingDay,
      method: 'location',
      coordinates: { lat: dto.lat, lng: dto.lng },
      distanceMeters,
      verification: { gps: gpsPassed, network: networkPassed },
      mockLocationSuspected: dto.mockLocationSuspected ?? false,
      recordedBy: null,
      notes: '',
      name: teacher.name,
    });

    await this.announceLateness(
      attendance,
      teacher.name,
      user.schoolId,
      // Nobody to exclude: the teacher's own copy is the request for a reason,
      // which is a different notice from the one the admins receive.
      null,
      school.settings.timezone,
    );

    return {
      status: true,
      message: 'تم تسجيل حضورك',
      data: {
        checkInAt: attendance.checkInAt,
        lateMinutes: attendance.lateMinutes,
        // What the client opens the "why were you late" dialog on. Sending it
        // with the check-in means the teacher is asked while they are still
        // holding the phone, not at the next poll.
        lateReasonRequired: (attendance.lateMinutes ?? 0) > 0,
        isWorkingDay: attendance.isWorkingDay,
        expectedWorkMinutes: attendance.expectedWorkMinutes,
        distanceMeters: attendance.distanceMeters,
        verification: attendance.verification,
      },
    };
  }

  async createManual(user: any, dto: CreateManualTeacherAttendanceDto) {
    const teacher = await this.teacherModel.findById(dto.teacherId);
    if (!teacher) {
      throw new NotFoundException('المعلم غير موجود');
    }

    const normDate = normalizeDate(dto.date);

    // Attendance is a record of what happened, not a plan. Without this an
    // admin can pre-fill next month and the "who was absent" report silently
    // counts people who have not come to work yet.
    if (normDate.getTime() > normalizeDate(new Date()).getTime()) {
      throw new BadRequestException('لا يمكن تسجيل حضور بتاريخ مستقبلي');
    }

    const existing = await this.teacherAttendanceModel.findOne({
      teacherId: new Types.ObjectId(dto.teacherId),
      date: normDate,
    });

    if (existing) {
      throw new ConflictException('تم تسجيل حضور هذا المعلم لهذا اليوم بالفعل');
    }

    const settings = await this.getSchoolSettings(user.schoolId);
    const checkInAtDate = parseCheckInTime(dto.date, dto.checkInAt, settings?.timezone);
    const daySchedule = resolveDaySchedule(settings, normDate);

    const attendance = await this.teacherAttendanceModel.create({
      teacherId: new Types.ObjectId(dto.teacherId),
      date: normDate,
      checkInAt: checkInAtDate,
      lateMinutes: computeLateMinutes(
        checkInAtDate,
        daySchedule.startTime,
        settings?.timezone,
      ),
      expectedWorkMinutes: daySchedule.expectedWorkMinutes,
      isWorkingDay: daySchedule.isWorkingDay,
      method: 'manual',
      coordinates: null,
      distanceMeters: null,
      verification: { gps: false, network: false },
      mockLocationSuspected: false,
      recordedBy: new Types.ObjectId(user.userId),
      notes: dto.notes || '',
      name: teacher.name,
    });

    // The teacher is asked for a reason here too. A lateness recorded by hand
    // is the same lateness, and the teacher whose name is on it has no other
    // way to answer it.
    await this.announceLateness(
      attendance,
      teacher.name,
      user.schoolId,
      user.userId,
      settings?.timezone,
    );

    return attendance;
  }

  async getMyAttendance(user: any, query: QueryTeacherAttendanceDto) {
    const filter: any = {
      teacherId: new Types.ObjectId(user.userId),
    };

    if (query.dateFrom || query.dateTo) {
      filter.date = {};
      if (query.dateFrom) {
        filter.date.$gte = normalizeDate(query.dateFrom);
      }
      if (query.dateTo) {
        filter.date.$lte = normalizeDate(query.dateTo);
      }
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.teacherAttendanceModel
        .find(filter)
        .sort({ date: -1, checkInAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.teacherAttendanceModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAll(query: QueryTeacherAttendanceDto) {
    const filter: any = {};

    if (query.teacherId) {
      filter.teacherId = new Types.ObjectId(query.teacherId);
    }

    if (query.date) {
      filter.date = normalizeDate(query.date);
    } else if (query.dateFrom || query.dateTo) {
      filter.date = {};
      if (query.dateFrom) {
        filter.date.$gte = normalizeDate(query.dateFrom);
      }
      if (query.dateTo) {
        filter.date.$lte = normalizeDate(query.dateTo);
      }
    }

    if (query.method) {
      filter.method = query.method;
    }

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.teacherAttendanceModel
        .find(filter)
        .populate('teacherId', 'name email phoneNumber qualification specialization')
        .populate('recordedBy', 'username email name')
        .sort({ date: -1, checkInAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.teacherAttendanceModel.countDocuments(filter),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAbsent(dateStr?: string, user?: any) {
    const targetDate = normalizeDate(dateStr || new Date());

    /*
     * Nobody is absent on a day the school does not work.
     *
     * This had no notion of a day off, so every Friday it reported every
     * teacher in the school as absent — a number an admin would either learn
     * to ignore or act on wrongly.
     */
    const settings = await this.getSchoolSettings(user?.schoolId);
    const daySchedule = resolveDaySchedule(settings, targetDate);

    if (!daySchedule.isWorkingDay) {
      return {
        date: targetDate,
        isWorkingDay: false,
        message: 'هذا اليوم إجازة رسمية للمدرسة',
        totalAbsent: 0,
        absentTeachers: [],
      };
    }

    const activeTeachers = await this.teacherModel
      .find({ isActive: true })
      .select('name email phoneNumber qualification specialization')
      .lean();

    const presentRecords = await this.teacherAttendanceModel
      .find({ date: targetDate })
      .select('teacherId')
      .lean();

    const presentTeacherIds = new Set(presentRecords.map((r) => r.teacherId.toString()));

    const absentTeachers = activeTeachers.filter(
      (t) => !presentTeacherIds.has(t._id.toString()),
    );

    return {
      date: targetDate,
      isWorkingDay: true,
      totalAbsent: absentTeachers.length,
      absentTeachers,
    };
  }

  /** The settings block, or null. Shared by every path that needs workStartTime. */
  private async getSchoolSettings(schoolId: any): Promise<any | null> {
    if (!schoolId) return null;
    const school = await this.schoolModel
      .findById(schoolId, { settings: 1 })
      .setOptions({ skipTenantScope: true })
      .lean();
    return (school as any)?.settings ?? null;
  }

  /**
   * Minutes between check-in and check-out.
   *
   * Both are real instants, so this needs no timezone handling — unlike
   * lateness, which compares an instant against a wall-clock string.
   */
  private computeWorkMinutes(checkInAt: Date, checkOutAt: Date): number {
    const minutes = Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000);
    if (minutes < 0) {
      throw new BadRequestException('وقت الانصراف لا يمكن أن يسبق وقت الحضور');
    }
    return minutes;
  }

  /**
   * Self-service check-out. Mirrors checkIn, and reuses the same radius and
   * network settings — a second checkOutRadius would be a setting nobody
   * would ever set differently.
   */
  async checkOut(user: any, dto: CheckOutTeacherAttendanceDto, req?: any) {
    const settings = await this.getSchoolSettings(user.schoolId);
    if (!settings) {
      throw new BadRequestException('لم يتم العثور على إعدادات المدرسة');
    }
    if (!settings.teacherCheckInEnabled) {
      throw new BadRequestException('التسجيل الذاتي غير مفعّل');
    }
    if (
      !settings.location ||
      typeof settings.location.lat !== 'number' ||
      typeof settings.location.lng !== 'number'
    ) {
      throw new BadRequestException('لم يتم تحديد موقع المدرسة بعد');
    }

    const today = normalizeDate(new Date());
    const record = await this.teacherAttendanceModel.findOne({
      teacherId: new Types.ObjectId(user.userId),
      date: today,
    });

    if (!record) {
      throw new BadRequestException('لا يوجد تسجيل حضور لك اليوم');
    }

    if (record.checkOutAt) {
      // Same shape as the double check-in case: carry the existing data so a
      // second tap can say "you left at 14:05" without another round trip.
      throw new HttpException(
        {
          status: false,
          message: 'تم تسجيل انصرافك اليوم بالفعل',
          data: {
            alreadyCheckedOut: true,
            checkOutAt: record.checkOutAt,
            workMinutes: record.workMinutes,
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const distanceMeters = calculateHaversineDistance(
      { lat: dto.lat, lng: dto.lng },
      settings.location,
    );
    const radius = settings.checkInRadiusMeters || 150;
    const gpsPassed = distanceMeters <= radius;

    const clientIp = extractClientIp(req);
    const networkPassed =
      Array.isArray(settings.schoolNetworkIps) && settings.schoolNetworkIps.includes(clientIp);

    if (!gpsPassed && !networkPassed) {
      throw new ForbiddenException(
        `الموقع الشبكي والإحداثيات خارج نطاق المدرسة (المسافة: ${distanceMeters} متر)`,
      );
    }

    const checkOutAt = new Date();
    const daySchedule = resolveDaySchedule(settings, record.date);

    record.checkOutAt = checkOutAt;
    record.earlyLeaveMinutes = computeEarlyLeaveMinutes(
      checkOutAt,
      daySchedule.endTime,
      settings.timezone,
    );

    // An approved استئذان does not erase the minutes — the clock is the clock —
    // it records that leaving early was sanctioned. A report that hid the
    // number could not tell a permitted departure from a day that was never
    // measured, and one without the flag makes every approved leave look like
    // a fault.
    const approvedLeave = await this.leaveRequestModel
      .findOne({
        teacherId: record.teacherId,
        date: record.date,
        status: 'approved',
      })
      .lean()
      .exec();

    record.earlyLeaveApproved = approvedLeave != null;
    record.approvedLeaveAt = (approvedLeave as any)?.leaveAt ?? null;
    record.checkOutMethod = 'location';
    record.checkOutCoordinates = { lat: dto.lat, lng: dto.lng };
    record.checkOutDistanceMeters = distanceMeters;
    record.checkOutVerification = { gps: gpsPassed, network: networkPassed };
    record.checkOutMockLocationSuspected = dto.mockLocationSuspected ?? false;
    record.workMinutes = this.computeWorkMinutes(record.checkInAt, checkOutAt);

    await record.save();

    return {
      status: true,
      message: 'تم تسجيل انصرافك',
      data: {
        checkInAt: record.checkInAt,
        checkOutAt: record.checkOutAt,
        workMinutes: record.workMinutes,
        expectedWorkMinutes: record.expectedWorkMinutes,
        earlyLeaveMinutes: record.earlyLeaveMinutes,
        earlyLeaveApproved: record.earlyLeaveApproved,
        approvedLeaveAt: record.approvedLeaveAt,
        distanceMeters: record.checkOutDistanceMeters,
        verification: record.checkOutVerification,
      },
    };
  }

  /**
   * Per-teacher totals over a period.
   *
   * Reads the snapshotted lateMinutes / workMinutes rather than recomputing —
   * so the report says what was true on each day, not what today's settings
   * would make of it.
   */
  async getMonthlySummary(query: SummaryTeacherAttendanceDto) {
    const match: any = {
      date: {
        $gte: normalizeDate(query.dateFrom),
        $lte: normalizeDate(query.dateTo),
      },
    };
    if (query.teacherId) {
      match.teacherId = new Types.ObjectId(query.teacherId);
    }

    const rows = await this.teacherAttendanceModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$teacherId',
          daysPresent: { $sum: 1 },
          daysLate: { $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] } },
          totalLateMinutes: { $sum: { $ifNull: ['$lateMinutes', 0] } },
          daysLeftEarly: { $sum: { $cond: [{ $gt: ['$earlyLeaveMinutes', 0] }, 1, 0] } },
          totalEarlyLeaveMinutes: { $sum: { $ifNull: ['$earlyLeaveMinutes', 0] } },
          totalWorkMinutes: { $sum: { $ifNull: ['$workMinutes', 0] } },
          // What the school's schedule says those days should have been. Gives
          // totalWorkMinutes something to be read against — on its own it is a
          // number nobody can tell is good or bad.
          totalExpectedWorkMinutes: { $sum: { $ifNull: ['$expectedWorkMinutes', 0] } },
          // Attendance on a day off is real and recorded, but counting it in
          // the same averages as a normal day would distort them.
          daysOnDayOff: {
            $sum: { $cond: [{ $eq: ['$isWorkingDay', false] }, 1, 0] },
          },
          // The honest count. Treating a missing check-out as zero work time
          // would quietly understate someone's hours and read as fact.
          daysMissingCheckOut: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$checkOutAt', null] }, null] }, 1, 0] },
          },
          // null means the school had no workStartTime that day. Counting
          // those separately keeps "not tracked" from looking like "on time".
          daysLatenessNotTracked: {
            $sum: { $cond: [{ $eq: [{ $ifNull: ['$lateMinutes', null] }, null] }, 1, 0] },
          },
          // Same distinction on the way out: a day with no end time configured
          // is not a day somebody left exactly on time.
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
          fallbackName: { $first: '$name' },
        },
      },
      { $lookup: { from: 'teachers', localField: '_id', foreignField: '_id', as: 'teacher' } },
      // preserveNullAndEmptyArrays, because a deleted teacher must not make
      // their days vanish from the totals — that is silent under-reporting.
      { $unwind: { path: '$teacher', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          teacherId: '$_id',
          teacherName: { $ifNull: ['$teacher.name', '$fallbackName'] },
          teacherDeleted: { $cond: [{ $ifNull: ['$teacher', false] }, false, true] },
          daysPresent: 1,
          daysLate: 1,
          totalLateMinutes: 1,
          daysLeftEarly: 1,
          totalEarlyLeaveMinutes: 1,
          totalWorkMinutes: 1,
          totalExpectedWorkMinutes: 1,
          daysMissingCheckOut: 1,
          daysLatenessNotTracked: 1,
          daysEarlyLeaveNotTracked: 1,
          daysOnDayOff: 1,
        },
      },
      { $sort: { teacherName: 1 } },
    ]);

    return {
      status: true,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      totalTeachers: rows.length,
      data: rows,
    };
  }

  async update(id: string, dto: UpdateTeacherAttendanceDto, user: any) {
    const record = await this.teacherAttendanceModel.findById(id);
    if (!record) {
      throw new NotFoundException('سجل الحضور غير موجود');
    }

    // Every derived figure is measured against the school's hours for that
    // weekday, so the schedule is resolved once and reused below.
    const settings =
      dto.checkInAt !== undefined || dto.checkOutAt !== undefined
        ? await this.getSchoolSettings(user.schoolId)
        : null;
    const daySchedule = settings ? resolveDaySchedule(settings, record.date) : null;

    const checkInAt = dto.checkInAt !== undefined
      ? parseCheckInTime(record.date, dto.checkInAt, settings?.timezone) : record.checkInAt;
    const checkOutAt = dto.checkOutAt !== undefined
      ? parseCheckInTime(record.date, dto.checkOutAt, settings?.timezone) : record.checkOutAt;
    const checkInChanged = checkInAt.getTime() !== record.checkInAt.getTime();
    const checkOutChanged = checkOutAt?.getTime() !== record.checkOutAt?.getTime();

    if (checkInChanged) {
      record.checkInAt = checkInAt;
      record.method = 'manual';
      record.coordinates = null;
      record.distanceMeters = null;
      record.verification = { gps: false, network: false };
      record.mockLocationSuspected = false;

      // Lateness is derived from checkInAt, so correcting the time has to
      // correct the figure with it — otherwise a stale value survives the fix.
      record.lateMinutes = computeLateMinutes(
        record.checkInAt,
        daySchedule?.startTime,
        settings?.timezone,
      );
      record.expectedWorkMinutes = daySchedule?.expectedWorkMinutes ?? null;
      record.isWorkingDay = daySchedule?.isWorkingDay ?? true;

      // Correcting the clock to show the teacher was on time leaves behind an
      // explanation for a lateness that no longer exists — which reads to a
      // director as an admission of something the record denies.
      if (!record.lateMinutes || record.lateMinutes <= 0) {
        record.lateReason = null;
        record.lateReasonAt = null;
      }
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
        daySchedule?.endTime,
        settings?.timezone,
      );
    }

    // Either timestamp moving changes the duration, so this runs after both.
    if ((checkInChanged || checkOutChanged) && record.checkOutAt) {
      record.workMinutes = this.computeWorkMinutes(record.checkInAt, record.checkOutAt);
    }

    if (dto.notes !== undefined) {
      record.notes = dto.notes;
    }

    record.recordedBy = new Types.ObjectId(user.userId);

    await record.save();
    return record;
  }

  async delete(id: string) {
    const record = await this.teacherAttendanceModel.findByIdAndDelete(id);
    if (!record) {
      throw new NotFoundException('سجل الحضور غير موجود');
    }

    return {
      status: true,
      message: 'تم حذف سجل الحضور بنجاح',
    };
  }
}
