import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';
import { Teacher, TeacherSchema } from './schemas/teacher.schema';
import { SubjectsModule } from '../subjects/subjects.module';
import { LecturesModule } from '../lectures/lectures.module';
import { CaslModule } from 'src/casl/casl.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Teacher.name, schema: TeacherSchema },
    ]),
    forwardRef(() => SubjectsModule), // access Subject model
    forwardRef(() => LecturesModule), // access Lecture model for deletion
    CaslModule
  ],
  controllers: [TeachersController],
  providers: [TeachersService],
  exports: [TeachersService, MongooseModule], 
})
export class TeachersModule {}