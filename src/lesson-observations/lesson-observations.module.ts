import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LessonObservationsController } from './lesson-observations.controller';
import { LessonObservationsService } from './lesson-observations.service';
import {
  LessonObservation,
  LessonObservationSchema,
} from './schemas/lesson-observation.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import {
  Substitution,
  SubstitutionSchema,
} from '../duty/schemas/substitution.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    MongooseModule.forFeature([
      { name: LessonObservation.name, schema: LessonObservationSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Term.name, schema: TermSchema },
      { name: Substitution.name, schema: SubstitutionSchema },
      { name: Admin.name, schema: AdminSchema },
    ]),
  ],
  controllers: [LessonObservationsController],
  providers: [LessonObservationsService],
  exports: [LessonObservationsService, MongooseModule],
})
export class LessonObservationsModule {}
