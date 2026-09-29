import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyTrackingController } from './daily-tracking.controller';
import { DailyTrackingService } from './daily-tracking.service';
import { DailyTracking, DailyTrackingSchema } from './schemas/daily-tracking.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { AttendanceModule } from '../attendance/attendance.module';

// AttendanceModule is imported rather than the Attendance model re-declared:
// recording an absence must go through AttendanceService so the family is
// notified and the excuse flow opens. That module exports both the service
// and its MongooseModule, which is where the Attendance model comes from.
@Module({
  imports: [
    forwardRef(() => AttendanceModule),
    MongooseModule.forFeature([
      { name: DailyTracking.name, schema: DailyTrackingSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Student.name, schema: StudentSchema },
    ]),
  ],
  controllers: [DailyTrackingController],
  providers: [DailyTrackingService],
  exports: [DailyTrackingService],
})
export class DailyTrackingModule {}
