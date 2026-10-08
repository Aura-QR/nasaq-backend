import { GradeRegisterSheet, GradeRegisterSheetSchema } from '../grade-register/schemas/grade-register-sheet.schema';
import { Substitution, SubstitutionSchema } from '../duty/schemas/substitution.schema';
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
      // Read to let a period's substitute act on it for the day.
      { name: Substitution.name, schema: SubstitutionSchema },
      // An approved annual register locks its subject's tracking.
      { name: GradeRegisterSheet.name, schema: GradeRegisterSheetSchema },
    ]),
  ],
  controllers: [DailyTrackingController],
  providers: [DailyTrackingService],
  exports: [DailyTrackingService],
})
export class DailyTrackingModule {}
