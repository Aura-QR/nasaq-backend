import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusService } from './bus.service';
import { EnrollBusDto } from './dto/enroll-bus.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

@Controller('financial/records/:studentId/bus')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Bus')
@ApiBearerAuth()
export class BusController {
  constructor(private readonly busService: BusService) {}

  @Post('enroll')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enroll student in bus service' })
  async enroll(@Param('studentId') studentId: string, @Body() dto: EnrollBusDto) {
    return this.busService.enroll(studentId, dto);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get student's bus record" })
  @ApiQuery({ name: 'academicYearId', required: false })
  async findOne(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.busService.findOne(studentId);
  }

  @Post('pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a bus payment received at school (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async pay(
    @Param('studentId') studentId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.busService.pay(studentId, dto, user.userId);
  }

  @Post('refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a bus refund / payment correction (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refund(
    @Param('studentId') studentId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.busService.refund(studentId, dto, user.userId);
  }

  @Post('installments/:installmentNumber/refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a refund on a specific bus installment payment (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refundByNumber(
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
    return this.busService.refund(studentId, dto, user.userId);
  }

  @Delete('unenroll')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unenroll student from bus service' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async unenroll(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.busService.unenroll(studentId, academicYearId);
  }
}
