import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TripService } from './trip.service';
import { AddTripDto } from './dto/add-trip.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

@Controller('financial/records/:studentId/trips')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Trips')
@ApiBearerAuth()
export class TripController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a trip to a student financial record' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async create(
    @Param('studentId') studentId: string,
    @Body() dto: AddTripDto,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.tripService.create(studentId, dto, academicYearId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List all trips for a student" })
  @ApiQuery({ name: 'academicYearId', required: false })
  async find(
    @Param('studentId') studentId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.tripService.find(studentId, academicYearId);
  }

  @Get(':tripId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one trip by ID' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async findOne(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.tripService.findOne(studentId, tripId, academicYearId);
  }

  @Post(':tripId/pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a trip payment received at school (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async pay(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.tripService.pay(studentId, tripId, dto, user.userId);
  }

  @Post(':tripId/refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a trip refund / payment correction (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refund(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.tripService.refund(studentId, tripId, dto, user.userId);
  }

  @Post(':tripId/installments/:installmentNumber/refund')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a refund on a specific trip installment payment (Admin)' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async refundByNumber(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Param('installmentNumber') installmentNumber: number,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: any,
    @Query('academicYearId') academicYearId?: string,
  ) {
    dto.installmentNumber = Number(installmentNumber);
    if (academicYearId && !dto.academicYearId) {
      dto.academicYearId = academicYearId;
    }
    return this.tripService.refund(studentId, tripId, dto, user.userId);
  }

  @Delete(':tripId')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a trip from a student record' })
  @ApiQuery({ name: 'academicYearId', required: false })
  async delete(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    return this.tripService.delete(studentId, tripId, academicYearId);
  }
}
