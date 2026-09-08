import { Module, forwardRef } from '@nestjs/common';
import {
  GradeLevel,
  GradeLevelSchema,
} from '../grade-levels/schemas/grade-level.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { PreparationController } from './preparation.controller';
import { PreparationService } from './preparation.service';
import { LessonContentService } from './lesson-content.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import { LecturesModule } from '../lectures/lectures.module';
import { CaslModule } from '../casl/casl.module';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { PreparationContentModule } from './preparation-content.module';

@Module({
  imports: [
    PreparationContentModule,
    MongooseModule.forFeature([
      { name: Preparation.name, schema: PreparationSchema },
      { name: Teacher.name, schema: TeacherSchema },
      // The weekly view populates a lecture's offering down to its grade, so
      // the model has to exist on the connection. It does today only because
      // other modules happen to register it; registering it here says so.
      { name: GradeLevel.name, schema: GradeLevelSchema },
    ]),
    forwardRef(() => LecturesModule),
    CaslModule,
  ],
  controllers: [PreparationController],
  providers: [PreparationService, LessonContentService],
  exports: [PreparationService, LessonContentService, MongooseModule],
})
export class PreparationModule {}
