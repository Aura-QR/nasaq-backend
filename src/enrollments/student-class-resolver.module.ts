import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudentClassResolverService } from './student-class-resolver.service';
import { Enrollment, EnrollmentSchema } from './schemas/enrollment.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';

/**
 * Deliberately separate from EnrollmentsModule.
 *
 * EnrollmentsModule pulls in GradesCriteriaService and FinancialRecordService;
 * importing it from grades-criteria (one of this resolver's four consumers)
 * would close a dependency cycle. This module holds models only.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Student.name, schema: StudentSchema },
      { name: AcademicYear.name, schema: AcademicYearSchema },
    ]),
  ],
  providers: [StudentClassResolverService],
  exports: [StudentClassResolverService],
})
export class StudentClassResolverModule {}
