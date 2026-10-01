import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { School, SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { TeacherAttendance, TeacherAttendanceSchema } from './schemas/teacher-attendance.schema';
import {
  TeacherAbsenceExcuse,
  TeacherAbsenceExcuseSchema,
} from './schemas/teacher-absence-excuse.schema';
import { TeacherAbsenceExcuseService } from './teacher-absence-excuse.service';
import { TeacherAbsenceSweepService } from './teacher-absence-sweep.service';
import {
  TeacherAbsenceNotice,
  TeacherAbsenceNoticeSchema,
} from './schemas/teacher-absence-notice.schema';
import { TeacherAttendanceController } from './teacher-attendance.controller';
import { TeacherAttendanceService } from './teacher-attendance.service';
import { LeaveRequest, LeaveRequestSchema } from '../duty/schemas/leave-request.schema';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherAttendance.name, schema: TeacherAttendanceSchema },
      // A collection of its own: an absent teacher has no attendance row to
      // hang an excuse on — see the schema's own note.
      { name: TeacherAbsenceExcuse.name, schema: TeacherAbsenceExcuseSchema },
      // So the end-of-day notice goes out once per teacher per day.
      { name: TeacherAbsenceNotice.name, schema: TeacherAbsenceNoticeSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: School.name, schema: SchoolSchema },
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      // Who a lateness is reported to — owner, managers and supervisors.
      { name: Admin.name, schema: AdminSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [TeacherAttendanceController],
  providers: [TeacherAttendanceService, TeacherAbsenceExcuseService, TeacherAbsenceSweepService],
  exports: [TeacherAttendanceService, TeacherAbsenceExcuseService],
})
export class TeacherAttendanceModule {}
