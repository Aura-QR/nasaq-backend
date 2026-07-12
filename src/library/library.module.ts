import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { Library, LibrarySchema } from './schemas/library.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Library.name, schema: LibrarySchema },
      { name: Subject.name, schema: SubjectSchema },
    ]),
    forwardRef(() => SubjectsModule),
  ],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService, MongooseModule], // Export for use in other modules
})
export class LibraryModule {}
