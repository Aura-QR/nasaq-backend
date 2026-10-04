import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Admin } from '../admin/schemas/admin.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveDaySchedule } from '../attendance/attendance.utils';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { dayLabel, schoolDayHasEnded, schoolNow } from '../teacher-attendance/teacher-presence.util';
import { ATTENDANCE_STAFF_ROLES } from './dto/staff-attendance.dto';
import { StaffAttendance } from './schemas/staff-attendance.schema';
import {
  StaffAbsenceExcuse,
  StaffAbsenceNotice,
} from './schemas/staff-absence-excuse.schema';

/**
 * After the school day ends, ask each staff member who did not check in why
 * they were away. The teacher sweep (TeacherAbsenceSweepService), for
 * supervisors, managers and service staff.
 *
 * Only for schools using staff check-in, only half an hour after that
 * school's own day ends, only for people who have checked in at least once,
 * and once per person per day.
 */
@Injectable()
export class StaffAbsenceSweepService {
  private readonly logger = new Logger(StaffAbsenceSweepService.name);

  static readonly MARGIN_MINUTES = 30;

  private running = false;

  constructor(
    @InjectModel(School.name) private readonly schools: Model<School>,
    @InjectModel(Admin.name) private readonly admins: Model<Admin>,
    @InjectModel(StaffAttendance.name) private readonly records: Model<StaffAttendance>,
    @InjectModel(StaffAbsenceExcuse.name) private readonly excuses: Model<StaffAbsenceExcuse>,
    @InjectModel(StaffAbsenceNotice.name) private readonly notices: Model<StaffAbsenceNotice>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'staff-absence-sweep' })
  async sweep(now: Date = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const schools: any[] = await this.schools
        .find({ isActive: { $ne: false } })
        .select('_id settings')
        .setOptions({ skipTenantScope: true })
        .lean()
        .exec();

      for (const school of schools) {
        try {
          await this.sweepSchool(school, now);
        } catch (error: any) {
          this.logger.error(`Staff sweep failed for school ${school._id}: ${error?.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Returns how many people were notified — for tests and logs. */
  async sweepSchool(school: any, now: Date = new Date()): Promise<number> {
    const settings = school?.settings ?? {};
    // Without check-in every staff member reads as absent every day.
    if (settings.staffCheckInEnabled !== true) return 0;

    const clock = schoolNow(settings.timezone, now);
    const day = resolveDaySchedule(settings, clock.date);
    if (!day.isWorkingDay) return 0;
    if (!schoolDayHasEnded(day.endTime, clock.minutes, StaffAbsenceSweepService.MARGIN_MINUTES)) {
      return 0;
    }

    const schoolId = String(school._id);
    return tenantLocalStorage.run({ schoolId, isAdminContext: false }, () =>
      this.notifyAbsent(schoolId, clock.date),
    );
  }

  private async notifyAbsent(schoolId: string, date: Date): Promise<number> {
    const [staff, present, explained, noticed]: any[] = await Promise.all([
      this.admins
        .find({ schoolId: new Types.ObjectId(schoolId), role: { $in: ATTENDANCE_STAFF_ROLES } })
        .select('_id createdAt')
        .lean(),
      this.records.find({ date }).select('staffId').lean(),
      this.excuses.find({ date }).select('staffId').lean(),
      this.notices.find({ date }).select('staffId').lean(),
    ]);

    const skip = new Set<string>([
      ...present.map((r: any) => String(r.staffId)),
      ...explained.map((r: any) => String(r.staffId)),
      ...noticed.map((r: any) => String(r.staffId)),
    ]);

    const endOfDay = new Date(date.getTime() + 86_399_999);
    const candidates = staff.filter(
      (s: any) => !skip.has(String(s._id)) && (!s.createdAt || new Date(s.createdAt) <= endOfDay),
    );
    if (candidates.length === 0) return 0;

    // Somebody who has never checked in is not using it yet.
    const everRecorded = new Set(
      (
        await this.records
          .distinct('staffId', { staffId: { $in: candidates.map((s: any) => s._id) } })
          .exec()
      ).map(String),
    );

    let sent = 0;
    const label = dayLabel(date);

    for (const person of candidates) {
      if (!everRecorded.has(String(person._id))) continue;

      // Claim the day first; only the winner of the insert sends.
      try {
        await this.notices.create({ staffId: person._id, date });
      } catch (error: any) {
        if (error?.code === 11000) continue;
        throw error;
      }

      try {
        await this.notifications.notify({
          recipientId: person._id,
          type: 'staff_absence_excuse_required',
          title: 'لم يُسجَّل حضورك اليوم',
          body: `${label} — إن كنت غائبًا فبيّن السبب، وإن كنت حاضرًا فأبلغ الإدارة.`,
          data: { date: label },
        });
        sent++;
      } catch (error: any) {
        this.logger.error(`Could not notify staff ${person._id} for ${label}: ${error?.message}`);
      }
    }

    if (sent > 0) this.logger.log(`Asked ${sent} staff member(s) about ${label}`);
    return sent;
  }
}
