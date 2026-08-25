import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusService } from './bus.service';
import { EnrollBusDto } from './dto/enroll-bus.dto';
import { SwitchBusPlanDto } from './dto/switch-bus-plan.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

@Controller('financial/bus')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Bus Module')
@ApiBearerAuth()
export class BusModuleController {
  constructor(private readonly busService: BusService) {}

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List students enrolled in bus service' })
  @ApiQuery({ name: 'academicYear', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(@Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.busService.findAll(filters, { page, limit });
  }

  @Get('candidates')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List students not enrolled in bus service (for new enrollments)' })
  @ApiQuery({ name: 'academicYear', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findCandidates(@Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.busService.findCandidates(filters, { page, limit });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Student views their own bus plan details' })
  async findMy(@CurrentUser() user: any) {
    return this.busService.findMyProfile(user.userId);
  }

  @Get(':studentId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get bus profile details for a specific student (Admin)' })
  async findProfile(@Param('studentId') studentId: string) {
    return this.busService.findProfile(studentId);
  }

  @Post(':studentId/enroll')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enroll student in bus service (Admin)' })
  async enroll(@Param('studentId') studentId: string, @Body() dto: EnrollBusDto) {
    return this.busService.enroll(studentId, dto);
  }

  @Patch(':studentId/switch-plan')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch student bus plan (Admin)' })
  async switchPlan(@Param('studentId') studentId: string, @Body() dto: SwitchBusPlanDto) {
    return this.busService.switchPlan(studentId, dto);
  }

  @Post(':studentId/pay')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record a bus payment received at school (Admin)' })
  async pay(
    @Param('studentId') studentId: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: any,
  ) {
    return this.busService.pay(studentId, dto, user.userId);
  }

  @Delete(':studentId/unenroll')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unenroll student from bus service (Admin)' })
  async unenroll(@Param('studentId') studentId: string) {
    return this.busService.unenroll(studentId);
  }
}
