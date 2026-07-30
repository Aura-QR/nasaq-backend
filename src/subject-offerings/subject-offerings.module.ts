import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubjectOfferingsService } from './subject-offerings.service';
import { SubjectOfferingsController } from './subject-offerings.controller';
import { SubjectOffering, SubjectOfferingSchema } from './schemas/subject-offering.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      { name: Term.name, schema: TermSchema },
    ]),
  ],
  controllers: [SubjectOfferingsController],
  providers: [SubjectOfferingsService],
  exports: [SubjectOfferingsService, MongooseModule],
})
export class SubjectOfferingsModule {}
