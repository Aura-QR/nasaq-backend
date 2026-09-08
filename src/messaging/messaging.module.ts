import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CredentialsDeliveryService } from './credentials-delivery.service';
import { MessagingController } from './messaging.controller';
import { OutboundMessage, OutboundMessageSchema } from './schemas/outbound-message.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';

/**
 * Global because the services that issue credentials — students, teachers, and
 * whatever gets an account next — should not each have to wire an import for
 * it. There is one queue and one webhook for the whole process.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OutboundMessage.name, schema: OutboundMessageSchema },
      { name: School.name, schema: SchoolSchema },
    ]),
  ],
  controllers: [MessagingController],
  providers: [CredentialsDeliveryService],
  exports: [CredentialsDeliveryService],
})
export class MessagingModule {}
