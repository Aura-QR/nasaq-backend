import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TripService } from './trip.service';
import { AddTripDto } from './dto/add-trip.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

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
  async create(@Param('studentId') studentId: string, @Body() dto: AddTripDto) {
    return this.tripService.create(studentId, dto);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "List all trips for a student" })
  async find(@Param('studentId') studentId: string) {
    return this.tripService.find(studentId);
  }

  @Get(':tripId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one trip by ID' })
  async findOne(@Param('studentId') studentId: string, @Param('tripId') tripId: string) {
    return this.tripService.findOne(studentId, tripId);
  }

  @Post(':tripId/pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a trip payment received at school (Admin)' })
  async pay(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.tripService.pay(studentId, tripId, dto, user.userId);
  }

  @Delete(':tripId')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a trip from a student record' })
  async delete(@Param('studentId') studentId: string, @Param('tripId') tripId: string) {
    return this.tripService.delete(studentId, tripId);
  }
}
