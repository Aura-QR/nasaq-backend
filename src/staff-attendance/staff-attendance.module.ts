import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import {
  School,
  SchoolSchema,
} from '../platform/schools/schemas/school.schema';
import {
  StaffAttendance,
  StaffAttendanceSchema,
} from './schemas/staff-attendance.schema';
import {
  StaffLeaveRequest,
  StaffLeaveRequestSchema,
} from './schemas/staff-leave-request.schema';
import { StaffAttendanceController } from './staff-attendance.controller';
import { StaffAttendanceService } from './staff-attendance.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: StaffAttendance.name, schema: StaffAttendanceSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: School.name, schema: SchoolSchema },
      { name: StaffLeaveRequest.name, schema: StaffLeaveRequestSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [StaffAttendanceController],
  providers: [StaffAttendanceService],
})
export class StaffAttendanceModule {}
