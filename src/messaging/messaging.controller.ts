import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CredentialsDeliveryService } from './credentials-delivery.service';
import { OutboundStatus, OUTBOUND_STATUSES } from './schemas/outbound-message.schema';
import { SendTestMessageDto } from './dto/send-test.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentSchool } from '../tenancy/decorators/current-school.decorator';

/**
 * What the school can see and do about its own WhatsApp messages.
 *
 * Reading this list is the answer to the question a school will actually ask —
 * "قلت للطالب إن الرسالة هتوصله، وهو بيقول ماوصلتش" — and without it the only
 * way to answer is to read the server log.
 *
 * Owner and manager only. A delivery row names a person, their login address
 * and their phone; nothing below it needs to see that.
 */
@ApiBearerAuth()
@ApiTags('Messaging')
@Controller('messaging')
export class MessagingController {
  constructor(private readonly delivery: CredentialsDeliveryService) {}

  @ApiOperation({ summary: 'Recent WhatsApp credential deliveries for this school' })
  @ApiQuery({ name: 'status', required: false, enum: OUTBOUND_STATUSES })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPER_ADMIN)
  @Get('deliveries')
  async list(
    @CurrentSchool() schoolId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (status && !OUTBOUND_STATUSES.includes(status as OutboundStatus)) {
      throw new BadRequestException(
        `status غير معروف. القيم المتاحة: ${OUTBOUND_STATUSES.join(', ')}`,
      );
    }
    return {
      message: 'قائمة الرسائل',
      data: await this.delivery.list(schoolId, {
        status: status as OutboundStatus | undefined,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  @ApiOperation({ summary: 'Queue a failed delivery again' })
  @ApiResponse({ status: 200, description: 'تمت إعادة الجدولة' })
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@CurrentSchool() schoolId: string, @Param('id') id: string) {
    return this.delivery.retry(schoolId, id);
  }

  @ApiOperation({ summary: 'Send a test event to the n8n webhook (carries no password)' })
  @Roles(Role.OWNER, Role.SUPER_ADMIN)
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async test(@CurrentSchool() schoolId: string, @Body() dto: SendTestMessageDto) {
    return this.delivery.sendTest(schoolId, dto.phone);
  }
}
