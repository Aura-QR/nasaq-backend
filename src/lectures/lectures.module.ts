import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LecturesController } from './lectures.controller';
import { LecturesService } from './lectures.service';
import { Lecture, LectureSchema } from './schemas/lecture.schema';
import { ClassesModule } from '../classes/classes.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { TeachersModule } from '../teachers/teachers.module';
import { StudentsModule } from 'src/students/students.module';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Lecture.name, schema: LectureSchema }]),
    forwardRef(() => ClassesModule),
    forwardRef(() => SubjectsModule),
    forwardRef(() => TeachersModule),
    forwardRef(() => StudentsModule),
    CaslModule,
  ],
  controllers: [LecturesController],
  providers: [LecturesService],
  exports: [LecturesService, MongooseModule],
})
export class LecturesModule {}
