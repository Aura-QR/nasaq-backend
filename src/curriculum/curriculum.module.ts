import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CurriculumUnit,
  CurriculumUnitSchema,
} from './schemas/curriculum-unit.schema';
import {
  CurriculumLesson,
  CurriculumLessonSchema,
} from './schemas/curriculum-lesson.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  GradeLevel,
  GradeLevelSchema,
} from '../grade-levels/schemas/grade-level.schema';
import {
  Preparation,
  PreparationSchema,
} from '../preparation/schemas/preparation.schema';
import { CatalogModule } from '../catalog/catalog.module';
import { CurriculumService } from './curriculum.service';
import { CurriculumController } from './curriculum.controller';
@Module({
  imports: [
    CatalogModule,
    MongooseModule.forFeature([
      { name: CurriculumUnit.name, schema: CurriculumUnitSchema },
      { name: CurriculumLesson.name, schema: CurriculumLessonSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Preparation.name, schema: PreparationSchema },
    ]),
  ],
  providers: [CurriculumService],
  controllers: [CurriculumController],
  exports: [MongooseModule],
})
export class CurriculumModule {}
