import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DailyTrackingService } from './daily-tracking.service';
import { BulkDailyTrackingDto } from './dto/bulk-daily-tracking.dto';
import { TrackingSummaryQueryDto } from './dto/tracking-summary-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { Role } from '../auth/enums/role.enum';

// MANAGER is checked in the service instead: a manager without
// dailyTracking.add (the default) may still record the one period she was
// sent to cover. Every other role is checked here as before.
const BULK_GUARDED_ROLES = Object.values(Role).filter((role) => role !== Role.MANAGER);

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
  @CheckAbilities({ action: 'create', subject: 'DailyTracking', roles: BULK_GUARDED_ROLES })
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

  @Get('reports/summary')
  @CheckAbilities({ action: 'read', subject: 'DailyTracking' })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'تقرير المتابعة لفصل خلال مدة',
    description:
      'إجماليات لكل طالبة. النسب محسوبة من أيام حضورها لا من المدة كلها — ' +
      'الطالبة لا تشارك في يوم لم تحضره. ' +
      'رصد سلوكي لا يدخل في الدرجات.',
  })
  @ApiQuery({ name: 'startDate', required: true, example: '2026-09-01' })
  @ApiQuery({ name: 'endDate', required: true, example: '2026-09-30' })
  @ApiQuery({ name: 'classId', required: true })
  @ApiQuery({ name: 'subjectOfferingId', required: false })
  @ApiResponse({ status: 200, description: 'تم استرجاع تقرير المتابعة' })
  @ApiResponse({ status: 400, description: 'مدة غير صالحة' })
  @ApiResponse({
    status: 403,
    description: 'معلمة تطلب فصلًا لا تُدرّس له',
  })
  @HttpCode(HttpStatus.OK)
  async summary(
    @Query() query: TrackingSummaryQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.dailyTrackingService.summary(query, user);
  }
}
