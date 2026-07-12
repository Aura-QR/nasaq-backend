import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BusService } from './bus.service';
import { EnrollBusDto } from './dto/enroll-bus.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';

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
  async findOne(@Param('studentId') studentId: string) {
    return this.busService.findOne(studentId);
  }

  @Post('pay')
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

  @Delete('unenroll')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unenroll student from bus service' })
  async unenroll(@Param('studentId') studentId: string) {
    return this.busService.unenroll(studentId);
  }
}
