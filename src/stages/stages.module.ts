import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StagesService } from './stages.service';
import { StagesController } from './stages.controller';
import { Stage, StageSchema } from './schemas/stage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Stage.name, schema: StageSchema }]),
  ],
  controllers: [StagesController],
  providers: [StagesService],
  exports: [StagesService],
})
export class StagesModule {}
