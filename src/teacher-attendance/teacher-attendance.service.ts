import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from 'src/platform/schools/schemas/school.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { CheckInTeacherAttendanceDto } from './dto/check-in-teacher-attendance.dto';
import { CreateManualTeacherAttendanceDto } from './dto/create-manual-teacher-attendance.dto';
import { QueryTeacherAttendanceDto } from './dto/query-teacher-attendance.dto';
import { UpdateTeacherAttendanceDto } from './dto/update-teacher-attendance.dto';
import { TeacherAttendance } from './schemas/teacher-attendance.schema';

export function calculateHaversineDistance(
  coords1: { lat: number; lng: number },
  coords2: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = (coords2.lat - coords1.lat) * (Math.PI / 180);
  const dLng = (coords2.lng - coords1.lng) * (Math.PI / 180);
  const lat1Rad = coords1.lat * (Math.PI / 180);
  const lat2Rad = coords2.lat * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function normalizeDate(dateInput?: string | Date): Date {
  const d = dateInput ? new Date(dateInput) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function parseCheckInTime(dateInput: string | Date, timeOrIsoStr: string): Date {
  if (timeOrIsoStr.includes('T') || timeOrIsoStr.includes('Z')) {
    return new Date(timeOrIsoStr);
  }
  if (/^\d{1,2}:\d{2}$/.test(timeOrIsoStr)) {
    const normDate = normalizeDate(dateInput);
    const [hours, minutes] = timeOrIsoStr.split(':').map(Number);
    return new Date(
      Date.UTC(
        normDate.getUTCFullYear(),
        normDate.getUTCMonth(),
        normDate.getUTCDate(),
        hours,
        minutes,
      ),
    );
  }
  return new Date(timeOrIsoStr);
}

export function extractClientIp(req: any): string {
  if (!req) return '';
  const xForwardedFor = req.headers?.['x-forwarded-for'];
  const rawIp =
    (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : null) ||
    req.ip ||
    req.socket?.remoteAddress ||
    '';
  return rawIp.replace(/^::ffff:/, '');
}

@Injectable()
export class TeacherAttendanceService {
  constructor(
    @InjectModel(TeacherAttendance.name)
    private readonly teacherAttendanceModel: Model<TeacherAttendance>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(School.name)
    private readonly schoolModel: Model<School>,
  ) {}

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
      throw new HttpException(
        {
          status: true,
          message: 'تم تسجيل حضورك اليوم بالفعل',
          data: {
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

    const attendance = await this.teacherAttendanceModel.create({
      teacherId: new Types.ObjectId(user.userId),
      date: today,
      checkInAt: new Date(),
      method: 'location',
      coordinates: { lat: dto.lat, lng: dto.lng },
      distanceMeters,
      verification: { gps: gpsPassed, network: networkPassed },
      mockLocationSuspected: dto.mockLocationSuspected ?? false,
      recordedBy: null,
      notes: '',
      name: teacher.name,
    });

    return {
      status: true,
      message: 'تم تسجيل حضورك',
      data: {
        checkInAt: attendance.checkInAt,
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
    const existing = await this.teacherAttendanceModel.findOne({
      teacherId: new Types.ObjectId(dto.teacherId),
      date: normDate,
    });

    if (existing) {
      throw new ConflictException('تم تسجيل حضور هذا المعلم لهذا اليوم بالفعل');
    }

    const checkInAtDate = parseCheckInTime(dto.date, dto.checkInAt);

    const attendance = await this.teacherAttendanceModel.create({
      teacherId: new Types.ObjectId(dto.teacherId),
      date: normDate,
      checkInAt: checkInAtDate,
      method: 'manual',
      coordinates: null,
      distanceMeters: null,
      verification: { gps: false, network: false },
      mockLocationSuspected: false,
      recordedBy: new Types.ObjectId(user.userId),
      notes: dto.notes || '',
      name: teacher.name,
    });

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

  async findAbsent(dateStr?: string) {
    const targetDate = normalizeDate(dateStr || new Date());

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
      totalAbsent: absentTeachers.length,
      absentTeachers,
    };
  }

  async update(id: string, dto: UpdateTeacherAttendanceDto, user: any) {
    const record = await this.teacherAttendanceModel.findById(id);
    if (!record) {
      throw new NotFoundException('سجل الحضور غير موجود');
    }

    if (dto.checkInAt) {
      record.checkInAt = parseCheckInTime(record.date, dto.checkInAt);
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
