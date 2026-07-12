import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { InstallmentPlanService } from './installment-plan.service';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { UpdateInstallmentPlanDto } from './dto/update-installment-plan.dto';

@Controller('financial/installment-plans')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Installment Plans')
@ApiBearerAuth()
export class InstallmentPlanController {
  constructor(private readonly installmentPlanService: InstallmentPlanService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an installment plan template' })
  async create(@Body() dto: CreateInstallmentPlanDto, @CurrentUser() user: any) {
    return this.installmentPlanService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all installment plans' })
  async find() {
    return this.installmentPlanService.find();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get installment plan by ID' })
  async findOne(@Param('id') id: string) {
    return this.installmentPlanService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update installment plan' })
  async update(@Param('id') id: string, @Body() dto: UpdateInstallmentPlanDto) {
    return this.installmentPlanService.update(id, dto);
  }

  @Patch(':id/set-default')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set this plan as the system default' })
  async setDefault(@Param('id') id: string) {
    return this.installmentPlanService.setDefault(id);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete installment plan (blocked if used by students)' })
  async delete(@Param('id') id: string) {
    return this.installmentPlanService.delete(id);
  }
}
