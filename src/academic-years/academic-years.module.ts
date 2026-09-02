import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AcademicYearsService } from './academic-years.service';
import { AcademicYearsController } from './academic-years.controller';
import { AcademicYear, AcademicYearSchema } from './schemas/academic-year.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AcademicYear.name, schema: AcademicYearSchema },
      // Read to decide whether the year may go, and cleaned up when it does.
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Term.name, schema: TermSchema },
      { name: Lecture.name, schema: LectureSchema },
    ]),
  ],
  controllers: [AcademicYearsController],
  providers: [AcademicYearsService],
  exports: [AcademicYearsService],
})
export class AcademicYearsModule {}
