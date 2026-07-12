import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FinancialRecordService } from './financial-record.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Controller('financial/records')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Records')
@ApiBearerAuth()
export class FinancialRecordController {
  constructor(private readonly financialRecordService: FinancialRecordService) {}

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all financial records (Admin)' })
  @ApiQuery({ name: 'academicYear', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'studentName', required: false })
  @ApiQuery({ name: 'tuitionStatus', required: false, enum: ['unpaid', 'partial', 'paid'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async find(@Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.financialRecordService.find(filters, { page, limit });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views their own financial record' })
  async findMyRecord(@CurrentUser() user: any) {
    return this.financialRecordService.findMyRecord(user.userId);
  }

  @Get('me/summary')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views their own installment summary (paid/pending/overdue counts)' })
  async getMySummary(@CurrentUser() user: any) {
    return this.financialRecordService.getSummary(user.userId);
  }

  @Get('me/trips')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views trips overview (all trips + enrolled trips financial details)' })
  async getMyTripsOverview(@CurrentUser() user: any) {
    return this.financialRecordService.getMyTripsOverview(user.userId);
  }

  @Get(':studentId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get full financial record for a specific student (Admin)' })
  async findOne(@Param('studentId') studentId: string) {
    return this.financialRecordService.findOne(studentId);
  }

  @Get(':studentId/summary')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get installment summary for a specific student (Admin)' })
  async getSummary(@Param('studentId') studentId: string) {
    return this.financialRecordService.getSummary(studentId);
  }

  @Post(':studentId/tuition/pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a tuition installment payment received at school (Admin)' })
  async payTuition(
    @Param('studentId') studentId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.financialRecordService.payTuition(studentId, dto, user.userId);
  }
}
