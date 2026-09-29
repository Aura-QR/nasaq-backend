import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { Attendance, AttendanceSchema } from './schemas/attendance.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { DailyTrackingModule } from '../daily-tracking/daily-tracking.module';

@Module({
  imports: [
    NotificationsModule,
    // See AttendanceService's constructor for why this is circular.
    forwardRef(() => DailyTrackingModule),
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Term.name, schema: TermSchema },
      { name: Admin.name, schema: AdminSchema },
    ]),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService, MongooseModule],
})
export class AttendanceModule {}
