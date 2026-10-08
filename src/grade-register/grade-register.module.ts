import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GradeRegisterSheet, GradeRegisterSheetSchema } from './schemas/grade-register-sheet.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { DailyTracking, DailyTrackingSchema } from '../daily-tracking/schemas/daily-tracking.schema';
import { Attendance, AttendanceSchema } from '../attendance/schemas/attendance.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { ExamResult, ExamResultSchema } from '../exams/schemas/exam-result.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from '../projects/schemas/project-submission.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { StudentClassResolverModule } from '../enrollments/student-class-resolver.module';
import { GradeRegisterService } from './grade-register.service';
import { GradeRegisterController } from './grade-register.controller';

@Module({
  imports: [
    StudentClassResolverModule,
    MongooseModule.forFeature([
      { name: GradeRegisterSheet.name, schema: GradeRegisterSheetSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Student.name, schema: StudentSchema },
      { name: DailyTracking.name, schema: DailyTrackingSchema },
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Exam.name, schema: ExamSchema },
      { name: ExamResult.name, schema: ExamResultSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectSubmission.name, schema: ProjectSubmissionSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Term.name, schema: TermSchema },
    ]),
  ],
  controllers: [GradeRegisterController],
  providers: [GradeRegisterService],
  exports: [GradeRegisterService],
})
export class GradeRegisterModule {}
