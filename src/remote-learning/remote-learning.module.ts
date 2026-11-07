import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RemoteLearningController } from './remote-learning.controller';
import { RemoteLearningService } from './remote-learning.service';
import { RemoteDay, RemoteDaySchema } from './schemas/remote-day.schema';
import { RemoteLessonLink, RemoteLessonLinkSchema } from './schemas/remote-lesson-link.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { Stage, StageSchema } from '../stages/schemas/stage.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Student, StudentSchema } from '../students/schemas/student.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [
    NotificationsModule,
    CaslModule,
    MongooseModule.forFeature([
      { name: RemoteDay.name, schema: RemoteDaySchema },
      { name: RemoteLessonLink.name, schema: RemoteLessonLinkSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: Class.name, schema: ClassSchema },
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Stage.name, schema: StageSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Student.name, schema: StudentSchema },
    ]),
  ],
  controllers: [RemoteLearningController],
  providers: [RemoteLearningService],
  exports: [RemoteLearningService],
})
export class RemoteLearningModule {}
