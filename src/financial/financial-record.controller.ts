import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FinancialRecordService } from './financial-record.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { SwitchPlanDto } from './dto/switch-plan.dto';
import { VoidPaymentDto } from './dto/void-payment.dto';
import { PaymentVoidService } from './payment-void.service';

@Controller('financial/records')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Records')
@ApiBearerAuth()
export class FinancialRecordController {
  constructor(
    private readonly financialRecordService: FinancialRecordService,
    private readonly paymentVoidService: PaymentVoidService,
  ) {}

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all financial records (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
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
  @ApiQuery({ name: 'academicYearId', required: false })
  async findMyRecord(
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.financialRecordService.findMyRecord(user.userId, academicYearId);
  }

  @Get('me/summary')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views their own installment summary (paid/pending/overdue counts)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async getMySummary(
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.financialRecordService.getSummary(user.userId, academicYearId);
  }

  @Get('me/trips')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views trips overview (all trips + enrolled trips financial details)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async getMyTripsOverview(
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.financialRecordService.getMyTripsOverview(user.userId, academicYearId);
  }

  @Get(':studentId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get full financial record for a specific student (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async findOne(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.financialRecordService.findOne(studentId, academicYearId);
  }

  @Get(':studentId/summary')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get installment summary for a specific student (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async getSummary(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.financialRecordService.getSummary(studentId, academicYearId);
  }

  @Post(':studentId/tuition/pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a tuition installment payment received at school (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async payTuition(
    @Param('studentId') studentId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.financialRecordService.payTuition(studentId, dto, user.userId);
  }

  /**
   * Void a payment that was recorded by mistake — tuition, bus, trip or
   * additional fee. The entry stays in the record, marked with who voided it,
   * when and why, and its amount comes back out of what was paid. The owner
   * may void any payment; whoever recorded it may void it the same day.
   */
  @Post(':studentId/payments/void')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Void a payment recorded by mistake (owner, or the recorder on the same day)' })
  async voidPayment(
    @Param('studentId') studentId: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.paymentVoidService.voidPayment(studentId, dto, user);
  }

  @Post(':studentId/tuition/refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a refund / correction on a tuition installment payment (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refundTuition(
    @Param('studentId') studentId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.financialRecordService.refundTuition(studentId, dto, user.userId);
  }

  @Post(':studentId/tuition/installments/:installmentNumber/refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a refund / correction on a specific tuition installment payment (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refundTuitionByNumber(
    @Param('studentId') studentId: string,
    @Param('installmentNumber') installmentNumber: number,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    dto.installmentNumber = Number(installmentNumber);
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.financialRecordService.refundTuition(studentId, dto, user.userId);
  }

  @Patch(':studentId/tuition/switch-plan')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch student tuition installment plan (Admin)' })
  async switchTuitionInstallmentPlan(
    @Param('studentId') studentId: string,
    @Body() dto: SwitchPlanDto,
  ) {
    return this.financialRecordService.switchTuitionInstallmentPlan(
      studentId,
      dto.installmentPlanId,
      dto.academicYearId,
    );
  }
}
