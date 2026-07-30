import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TermsService } from './terms.service';
import { TermsController } from './terms.controller';
import { Term, TermSchema } from './schemas/term.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Term.name, schema: TermSchema }]),
  ],
  controllers: [TermsController],
  providers: [TermsService],
  exports: [TermsService],
})
export class TermsModule {}
