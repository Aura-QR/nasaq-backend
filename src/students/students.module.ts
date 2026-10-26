import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudentsController } from './students.controller';
import { NationalitiesController } from '../common/nationalities.controller';
import { StudentsService } from './students.service';
import { Student, StudentSchema } from './schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Counter, CounterSchema } from 'src/Counter/Schema/counter.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Stage, StageSchema } from '../stages/schemas/stage.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { StudentStatisticsService } from './student-statistics.service';
import { EmailModule } from 'src/email/email.module';
import { FinancialModule } from 'src/financial/financial.module';

import { StudentFinancialRecord, StudentFinancialRecordSchema } from '../financial/schemas/student-financial-record.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
      { name: StudentFinancialRecord.name, schema: StudentFinancialRecordSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Stage.name, schema: StageSchema },
      { name: AcademicYear.name, schema: AcademicYearSchema },
    ]),
    EmailModule,
    FinancialModule,
  ],
  controllers: [StudentsController, NationalitiesController],
  providers: [StudentsService, StudentStatisticsService],
  exports: [StudentsService, MongooseModule],
})
export class StudentsModule {}
