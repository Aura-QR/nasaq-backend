import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { School, SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { TeacherAttendance, TeacherAttendanceSchema } from './schemas/teacher-attendance.schema';
import { TeacherAttendanceController } from './teacher-attendance.controller';
import { TeacherAttendanceService } from './teacher-attendance.service';
import { LeaveRequest, LeaveRequestSchema } from '../duty/schemas/leave-request.schema';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherAttendance.name, schema: TeacherAttendanceSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: School.name, schema: SchoolSchema },
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      // Who a lateness is reported to — owner, managers and supervisors.
      { name: Admin.name, schema: AdminSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [TeacherAttendanceController],
  providers: [TeacherAttendanceService],
  exports: [TeacherAttendanceService],
})
export class TeacherAttendanceModule {}
