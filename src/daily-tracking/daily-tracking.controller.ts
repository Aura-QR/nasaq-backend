import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DailyTrackingService } from './daily-tracking.service';
import { BulkDailyTrackingDto } from './dto/bulk-daily-tracking.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';

// No class-level @UseGuards(AbilitiesGuard), deliberately.
//
// AbilitiesGuard is an APP_GUARD (app.module.ts), so @CheckAbilities below is
// already enforced. Declaring it locally as well makes Nest construct the
// guard inside THIS module's injector, and this module does not import
// CaslModule — the whole app then fails to boot with
// UnknownDependenciesException. Same reasoning as attendance.controller.ts.
@Controller('daily-tracking')
@ApiTags('Daily Tracking')
export class DailyTrackingController {
  constructor(private readonly dailyTrackingService: DailyTrackingService) {}

  @Post('bulk')
  @CheckAbilities({ action: 'create', subject: 'DailyTracking' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'حفظ سجل المتابعة لحصة كاملة',
    description:
      'المشاركة والواجب والاختبار تُحفظ في dailyTracking، والغياب يُوجَّه إلى ' +
      'وحدة attendance حتى يصل الإشعار لولي الأمر ويُفتح باب العذر. ' +
      'الحفظ قابل للتكرار: إعادة الإرسال تُحدِّث ولا تُضاعف.',
  })
  @ApiResponse({ status: 200, description: 'تم حفظ سجل المتابعة' })
  @ApiResponse({ status: 400, description: 'طالبة من خارج الفصل، أو تاريخ غير صالح' })
  @ApiResponse({ status: 403, description: 'هذه ليست حصتك' })
  @ApiResponse({ status: 404, description: 'الحصة غير موجودة' })
  @HttpCode(HttpStatus.OK)
  async bulk(@Body() dto: BulkDailyTrackingDto, @CurrentUser() user: any) {
    return this.dailyTrackingService.bulkUpsert(dto, user);
  }
}
