import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: "The caller's own notices",
    description:
      'Always scoped to whoever is asking — there is no way to read another ' +
      "user's notices.",
  })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @Get()
  @HttpCode(HttpStatus.OK)
  async list(
    @CurrentUser() user: any,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.notificationsService.list(user.userId, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @ApiOperation({
    summary: 'Unread count, for a badge',
    description: 'Cheap enough to poll; the list endpoint returns it too.',
  })
  @Get('unread-count')
  @HttpCode(HttpStatus.OK)
  async unreadCount(@CurrentUser() user: any) {
    return await this.notificationsService.unreadCount(user.userId);
  }

  @ApiOperation({ summary: 'Mark one notice read' })
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.notificationsService.markRead(id, user.userId);
  }

  @ApiOperation({ summary: 'Mark everything read' })
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: any) {
    return await this.notificationsService.markAllRead(user.userId);
  }
}
