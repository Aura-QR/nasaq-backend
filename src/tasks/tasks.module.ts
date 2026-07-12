import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksService } from './tasks.service';
import { Preparation, PreparationSchema } from '../preparation/schemas/preparation.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Preparation.name, schema: PreparationSchema },
      { name: Lecture.name, schema: LectureSchema },
    ]),
  ],
  providers: [TasksService],
})
export class TasksModule {}
