import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { School, SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { TeacherAttendance, TeacherAttendanceSchema } from './schemas/teacher-attendance.schema';
import { TeacherAttendanceController } from './teacher-attendance.controller';
import { TeacherAttendanceService } from './teacher-attendance.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherAttendance.name, schema: TeacherAttendanceSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: School.name, schema: SchoolSchema },
    ]),
  ],
  controllers: [TeacherAttendanceController],
  providers: [TeacherAttendanceService],
  exports: [TeacherAttendanceService],
})
export class TeacherAttendanceModule {}
