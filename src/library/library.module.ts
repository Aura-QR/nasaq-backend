import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { Library, LibrarySchema } from './schemas/library.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Library.name, schema: LibrarySchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
    ]),
  ],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService, MongooseModule],
})
export class LibraryModule {}
