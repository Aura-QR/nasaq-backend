import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from '../admin/schemas/admin.schema';
import { School } from '../platform/schools/schemas/school.schema';
import {
  calculateHaversineDistance,
  computeEarlyLeaveMinutes,
  computeLateMinutes,
  extractClientIp,
  normalizeDate,
  resolveDaySchedule,
} from '../attendance/attendance.utils';
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
  ) {}

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
    return { status: true, message: 'تم تسجيل حضورك', data: record };
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
    const staff = await this.staffMember(user, dto.staffId);
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
        },
      },
      { $set: { staffId: '$_id' } },
      { $project: { _id: 0 } },
      { $sort: { name: 1, staffId: 1 } },
    ]);
    return {
      status: true,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
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
    if (dto.checkInAt !== undefined || dto.checkOutAt !== undefined) {
      const settings = await this.settings(user);
      const schedule = resolveDaySchedule(settings, record.date);
      if (dto.checkInAt !== undefined) {
        record.checkInAt = this.manualTime(
          dto.checkInAt,
          record.date,
          settings,
        );
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
      if (dto.checkOutAt !== undefined) {
        record.checkOutAt = this.manualTime(
          dto.checkOutAt,
          record.date,
          settings,
        );
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
      if (record.checkOutAt)
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
    const record = await this.records.findOneAndDelete({
      ...this.scope(user),
      _id: this.objectId(id),
    });
    if (!record) throw new NotFoundException('سجل الحضور غير موجود');
    return { status: true, message: 'تم حذف سجل الحضور بنجاح' };
  }
}
