import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { TeacherAssignmentsController } from './teacher-assignments.controller';
import { TeacherAssignment, TeacherAssignmentSchema } from './schemas/teacher-assignment.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
    ]),
  ],
  controllers: [TeacherAssignmentsController],
  providers: [TeacherAssignmentsService],
  exports: [TeacherAssignmentsService, MongooseModule],
})
export class TeacherAssignmentsModule {}
