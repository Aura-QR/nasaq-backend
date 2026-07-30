import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { TeacherAssignmentsController } from './teacher-assignments.controller';
import { TeacherAssignment, TeacherAssignmentSchema } from './schemas/teacher-assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
    ]),
  ],
  controllers: [TeacherAssignmentsController],
  providers: [TeacherAssignmentsService],
  exports: [TeacherAssignmentsService, MongooseModule],
})
export class TeacherAssignmentsModule {}
