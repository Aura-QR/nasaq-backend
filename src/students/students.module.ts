import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StudentsController } from './students.controller';
import { NationalitiesController } from '../common/nationalities.controller';
import { StudentsService } from './students.service';
import { Student, StudentSchema } from './schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Counter, CounterSchema } from 'src/Counter/Schema/counter.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { EmailModule } from 'src/email/email.module';
import { FinancialModule } from 'src/financial/financial.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Student.name, schema: StudentSchema },
      { name: Class.name, schema: ClassSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: Enrollment.name, schema: EnrollmentSchema },
    ]),
    EmailModule,
    FinancialModule,
  ],
  controllers: [StudentsController, NationalitiesController],
  providers: [StudentsService],
  exports: [StudentsService, MongooseModule],
})
export class StudentsModule {}
