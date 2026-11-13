import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { GradeRegisterModule } from '../grade-register/grade-register.module';
import { ClassRecordService } from './class-record.service';
import { ClassRecordController } from './class-record.controller';

@Module({
  imports: [
    GradeRegisterModule,
    MongooseModule.forFeature([
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Term.name, schema: TermSchema },
    ]),
  ],
  controllers: [ClassRecordController],
  providers: [ClassRecordService],
})
export class ClassRecordModule {}
