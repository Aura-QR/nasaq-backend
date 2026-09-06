import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CatalogSubject,
  CatalogSubjectSchema,
} from './schemas/catalog-subject.schema';
import { CatalogUnit, CatalogUnitSchema } from './schemas/catalog-unit.schema';
import {
  CatalogLesson,
  CatalogLessonSchema,
} from './schemas/catalog-lesson.schema';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CatalogSubject.name, schema: CatalogSubjectSchema },
      { name: CatalogUnit.name, schema: CatalogUnitSchema },
      { name: CatalogLesson.name, schema: CatalogLessonSchema },
    ]),
  ],
  providers: [CatalogService],
  controllers: [CatalogController],
  exports: [MongooseModule, CatalogService],
})
export class CatalogModule {}
