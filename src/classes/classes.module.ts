import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { Class, ClassSchema } from './schemas/class.schema';
import { SubjectsModule } from '../subjects/subjects.module';
import { StudentsModule } from '../students/students.module';
import { LecturesModule } from '../lectures/lectures.module';
import { TeachersModule } from '../teachers/teachers.module';
import { GradesCriteriaModule } from '../grades-criteria/grades-criteria.module';
import { FinancialModule } from '../financial/financial.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Class.name, schema: ClassSchema }]),
    forwardRef(() => SubjectsModule),
    forwardRef(() => StudentsModule),
    forwardRef(() => LecturesModule),
    forwardRef(() => TeachersModule),
    forwardRef(() => GradesCriteriaModule),
    forwardRef(() => FinancialModule),
  ],
  controllers: [ClassesController],
  providers: [ClassesService],
  exports: [ClassesService, MongooseModule],
})
export class ClassesModule {}