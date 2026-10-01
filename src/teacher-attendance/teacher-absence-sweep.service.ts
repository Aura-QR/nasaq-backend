import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from '../platform/schools/schemas/school.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { TeacherAttendance } from './schemas/teacher-attendance.schema';
import { TeacherAbsenceExcuse } from './schemas/teacher-absence-excuse.schema';
import { TeacherAbsenceNotice } from './schemas/teacher-absence-notice.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveDaySchedule } from '../attendance/attendance.utils';
import { tenantLocalStorage } from '../tenancy/tenant-storage';
import { dayLabel, schoolDayHasEnded, schoolNow, worksOn } from './teacher-presence.util';

/**
 * After a school day ends, ask each teacher who did not record attendance
 * why she was away.
 *
 * Not during the day: until the day is over a teacher with no check-in is
 * not absent, she is not here yet, and a phone buzzing "you are absent" at
 * ten in the morning at somebody on her way in is the fastest way to make a
 * school switch notifications off.
 *
 * Each school is swept against its own day — its own end time, holidays,
 * timezone — half an hour after that day finishes. The rules for who counts
 * are the same ones the teacher's own list uses (teacher-presence.util), so
 * she is never notified about a day her list does not show.
 */
@Injectable()
export class TeacherAbsenceSweepService {
  private readonly logger = new Logger(TeacherAbsenceSweepService.name);

  /** Minutes after the school day ends before anyone is asked. */
  static readonly MARGIN_MINUTES = 30;

  private running = false;

  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(TeacherAttendance.name)
    private readonly attendanceModel: Model<TeacherAttendance>,
    @InjectModel(TeacherAbsenceExcuse.name)
    private readonly excuseModel: Model<TeacherAbsenceExcuse>,
    @InjectModel(TeacherAbsenceNotice.name)
    private readonly noticeModel: Model<TeacherAbsenceNotice>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/15 * * * *', { name: 'teacher-absence-sweep' })
  async sweep(now: Date = new Date()) {
    // A slow run must not overlap the next one and double the work.
    if (this.running) return;
    this.running = true;
    try {
      const schools: any[] = await this.schoolModel
        .find({ isActive: { $ne: false } })
        .select('_id settings')
        .setOptions({ skipTenantScope: true })
        .lean()
        .exec();

      for (const school of schools) {
        try {
          await this.sweepSchool(school, now);
        } catch (error: any) {
          // One school's bad data must not stop every other school's notices.
          this.logger.error(`Sweep failed for school ${school._id}: ${error?.message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Returns how many teachers were notified — for tests and logs. */
  async sweepSchool(school: any, now: Date = new Date()): Promise<number> {
    const settings = school?.settings ?? {};

    // With no check-ins every teacher reads as absent every day. A school
    // that does not use check-in must never receive these.
    if (settings.teacherCheckInEnabled !== true) return 0;

    const clock = schoolNow(settings.timezone, now);
    const day = resolveDaySchedule(settings, clock.date);
    if (!day.isWorkingDay) return 0;
    if (!schoolDayHasEnded(day.endTime, clock.minutes, TeacherAbsenceSweepService.MARGIN_MINUTES)) {
      return 0;
    }

    const schoolId = String(school._id);
    return tenantLocalStorage.run({ schoolId, isAdminContext: false }, () =>
      this.notifyAbsent(clock.date),
    );
  }

  private async notifyAbsent(date: Date): Promise<number> {
    const [teachers, present, explained, noticed] = await Promise.all([
      this.teacherModel.find({ isActive: true }).select('_id name workDays hireDate').lean().exec(),
      this.attendanceModel.find({ date }).select('teacherId').lean().exec(),
      this.excuseModel.find({ date }).select('teacherId').lean().exec(),
      this.noticeModel.find({ date }).select('teacherId').lean().exec(),
    ]);

    const skip = new Set<string>([
      ...present.map((r: any) => String(r.teacherId)),
      ...explained.map((r: any) => String(r.teacherId)),
      ...noticed.map((r: any) => String(r.teacherId)),
    ]);

    const candidates = (teachers as any[]).filter(
      (t) =>
        !skip.has(String(t._id)) &&
        worksOn(t.workDays, date) &&
        (!t.hireDate || new Date(t.hireDate) <= new Date(date.getTime() + 86_399_999)),
    );
    if (candidates.length === 0) return 0;

    // Someone who has never recorded attendance is not using check-in yet;
    // asking her daily would be the same mistake as asking about a holiday.
    const everRecorded = new Set(
      (
        await this.attendanceModel
          .distinct('teacherId', {
            teacherId: { $in: candidates.map((t) => new Types.ObjectId(String(t._id))) },
          })
          .exec()
      ).map(String),
    );

    let sent = 0;
    const label = dayLabel(date);

    for (const teacher of candidates) {
      if (!everRecorded.has(String(teacher._id))) continue;

      // Claim the day first. Only the attempt that wins the insert sends,
      // so a restart or an overlapping run cannot push twice.
      try {
        await this.noticeModel.create({ teacherId: teacher._id, date });
      } catch (error: any) {
        if (error?.code === 11000) continue;
        throw error;
      }

      try {
        await this.notifications.notify({
          recipientId: teacher._id,
          type: 'teacher_absence_excuse_required',
          title: 'لم يُسجَّل حضورك اليوم',
          body: `${label} — إن كنت غائبًا فبيّن السبب، وإن كنت حاضرًا فأبلغ الإدارة.`,
          data: { date: label },
        });
        sent++;
      } catch (error: any) {
        this.logger.error(`Could not notify ${teacher._id} for ${label}: ${error?.message}`);
      }
    }

    if (sent > 0) this.logger.log(`Asked ${sent} teacher(s) about ${label}`);
    return sent;
  }
}
