import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { School, SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { Student, StudentSchema } from 'src/students/schemas/student.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { Class, ClassSchema } from 'src/classes/schemas/class.schema';
import {
  AcademicYear,
  AcademicYearSchema,
} from 'src/academic-years/schemas/academic-year.schema';
import { Attendance, AttendanceSchema } from 'src/attendance/schemas/attendance.schema';
import { Expense, ExpenseSchema } from 'src/expenses/schemas/expense.schema';
import {
  StudentFinancialRecord,
  StudentFinancialRecordSchema,
} from 'src/financial/schemas/student-financial-record.schema';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: School.name, schema: SchoolSchema },
      { name: Student.name, schema: StudentSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Class.name, schema: ClassSchema },
      { name: AcademicYear.name, schema: AcademicYearSchema },
      { name: Attendance.name, schema: AttendanceSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: StudentFinancialRecord.name, schema: StudentFinancialRecordSchema },
    ]),
  ],
  controllers: [DashboardsController],
  providers: [DashboardsService],
  exports: [DashboardsService],
})
export class DashboardsModule {}
