import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeeConfigService } from './fee-config.service';
import { CreateFeeConfigDto } from './dto/create-fee-config.dto';
import { UpdateFeeConfigDto } from './dto/update-fee-config.dto';

@Controller('financial/fee-configs')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Fee Configs')
@ApiBearerAuth()
export class FeeConfigController {
  constructor(private readonly feeConfigService: FeeConfigService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create fee config for a grade level (Admin only)' })
  async create(@Body() dto: CreateFeeConfigDto, @CurrentUser() user: any) {
    return this.feeConfigService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all fee configs' })
  async find() {
    return this.feeConfigService.find();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get fee config by ID' })
  async findOne(@Param('id') id: string) {
    return this.feeConfigService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update fee config' })
  async update(@Param('id') id: string, @Body() dto: UpdateFeeConfigDto) {
    return this.feeConfigService.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete fee config (blocked if used by students)' })
  async delete(@Param('id') id: string) {
    return this.feeConfigService.delete(id);
  }
}
