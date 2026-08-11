import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { Attendance, AttendanceSchema } from './schemas/attendance.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Term.name, schema: TermSchema },
    ]),
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService, MongooseModule],
})
export class AttendanceModule {}
