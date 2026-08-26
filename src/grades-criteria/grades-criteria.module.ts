import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GradesCriteriaService } from './grades-criteria.service';
import { GradesCriteriaController } from './grades-criteria.controller';
import { GradesCriteria, GradesCriteriaSchema } from './schemas/grades-criteria.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { CaslModule } from '../casl/casl.module';
import { Lecture, LectureSchema } from 'src/lectures/schemas/lecture.schema';
import { Exam, ExamSchema } from '../exams/schemas/exam.schema';
import { ExamResult, ExamResultSchema } from '../exams/schemas/exam-result.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectSubmission, ProjectSubmissionSchema } from '../projects/schemas/project-submission.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { TenancyModule } from '../tenancy/tenancy.module';
import { StudentClassResolverModule } from '../enrollments/student-class-resolver.module';

@Module({
  imports: [
    StudentClassResolverModule,
    MongooseModule.forFeature([
      { name: GradesCriteria.name, schema: GradesCriteriaSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Exam.name, schema: ExamSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: ExamResult.name, schema: ExamResultSchema },
      { name: ProjectSubmission.name, schema: ProjectSubmissionSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: Term.name, schema: TermSchema },
      { name: School.name, schema: SchoolSchema },
    ]),
    CaslModule,
    TenancyModule,
  ],
  controllers: [GradesCriteriaController],
  providers: [GradesCriteriaService],
  exports: [GradesCriteriaService, MongooseModule],
})
export class GradesCriteriaModule {}

