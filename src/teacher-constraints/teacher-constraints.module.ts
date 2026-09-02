import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeacherConstraintsService } from './teacher-constraints.service';
import { TeacherConstraintsController } from './teacher-constraints.controller';
import {
  TeacherConstraint,
  TeacherConstraintSchema,
} from './schemas/teacher-constraint.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TeacherConstraint.name, schema: TeacherConstraintSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
  ],
  controllers: [TeacherConstraintsController],
  providers: [TeacherConstraintsService],
  exports: [TeacherConstraintsService, MongooseModule],
})
export class TeacherConstraintsModule {}
