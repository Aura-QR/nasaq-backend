import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PreparationController } from './preparation.controller';
import { PreparationService } from './preparation.service';
import { Preparation, PreparationSchema } from './schemas/preparation.schema';
import { LecturesModule } from '../lectures/lectures.module';
import { CaslModule } from '../casl/casl.module';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Preparation.name, schema: PreparationSchema },
      { name: Teacher.name, schema: TeacherSchema },
    ]),
    forwardRef(() => LecturesModule),
    CaslModule,
  ],
  controllers: [PreparationController],
  providers: [PreparationService],
  exports: [PreparationService, MongooseModule],
})
export class PreparationModule {}
