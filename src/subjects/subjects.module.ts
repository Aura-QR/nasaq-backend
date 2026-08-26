import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { Subject, SubjectSchema } from './schemas/subject.schema';
import { TeachersModule } from '../teachers/teachers.module';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { LecturesModule } from '../lectures/lectures.module';
import { GradesCriteriaModule } from '../grades-criteria/grades-criteria.module';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { TeacherAssignment, TeacherAssignmentSchema } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { StudentClassResolverModule } from '../enrollments/student-class-resolver.module';

@Module({
  imports: [
    StudentClassResolverModule,
    MongooseModule.forFeature([
      { name: Subject.name, schema: SubjectSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
    ]),
    forwardRef(() => TeachersModule),
    forwardRef(() => LecturesModule),
    forwardRef(() => GradesCriteriaModule),
  ],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService, MongooseModule], // Export for use in other modules
})
export class SubjectsModule {}
