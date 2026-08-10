import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdditionalFeeService } from './additional-fee.service';
import { CreateAdditionalFeeDto } from './dto/create-additional-fee.dto';
import { PayAdditionalFeeDto } from './dto/pay-additional-fee.dto';

@Controller('financial/additional-fees')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Additional Fees')
@ApiBearerAuth()
export class AdditionalFeeController {
  constructor(private readonly additionalFeeService: AdditionalFeeService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an additional fee and auto-assign it to target students' })
  async create(@Body() dto: CreateAdditionalFeeDto, @CurrentUser() user: any) {
    return this.additionalFeeService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all additional fees' })
  async find() {
    return this.additionalFeeService.find();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get additional fee by ID' })
  async findOne(@Param('id') id: string) {
    return this.additionalFeeService.findOne(id);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete additional fee and remove it from all student records' })
  async delete(@Param('id') id: string) {
    return this.additionalFeeService.delete(id);
  }

  @Post(':feeId/pay/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record payment for an additional fee from a student' })
  async pay(
    @Param('studentId') studentId: string,
    @Param('feeId') feeId: string,
    @Body() dto: PayAdditionalFeeDto,
    @CurrentUser() user: any,
  ) {
    return this.additionalFeeService.pay(
      studentId,
      feeId,
      dto.amount,
      dto.paidAt,
      user.userId,
      dto.notes,
      dto.academicYearId,
    );
  }
}
