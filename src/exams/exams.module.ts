import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { Exam, ExamSchema } from './schemas/exam.schema';
import { ExamResult, ExamResultSchema } from './schemas/exam-result.schema';
import { GradesCriteria, GradesCriteriaSchema } from '../grades-criteria/schemas/grades-criteria.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { CaslModule } from '../casl/casl.module';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Exam.name, schema: ExamSchema },
      { name: GradesCriteria.name, schema: GradesCriteriaSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Student.name, schema: StudentSchema },
      { name: ExamResult.name, schema: ExamResultSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
    CaslModule,
  ],
  providers: [ExamsService],
  controllers: [ExamsController],
  exports: [ExamsService],
})
export class ExamsModule {}

