import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GradeLevelsService } from './grade-levels.service';
import { GradeLevelsController } from './grade-levels.controller';
import { GradeLevel, GradeLevelSchema } from './schemas/grade-level.schema';
import { Stage, StageSchema } from '../stages/schemas/stage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GradeLevel.name, schema: GradeLevelSchema },
      { name: Stage.name, schema: StageSchema },
    ]),
  ],
  controllers: [GradeLevelsController],
  providers: [GradeLevelsService],
  exports: [GradeLevelsService],
})
export class GradeLevelsModule {}
