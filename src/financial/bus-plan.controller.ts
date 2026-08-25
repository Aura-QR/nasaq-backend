import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { BusPlanService } from './bus-plan.service';
import { CreateBusPlanDto } from './dto/create-bus-plan.dto';
import { UpdateBusPlanDto } from './dto/update-bus-plan.dto';

@Controller('financial/bus-plans')
@ApiTags('Financial - Bus Plans')
@ApiBearerAuth()
export class BusPlanController {
  constructor(private readonly busPlanService: BusPlanService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a bus plan' })
  async create(@Body() dto: CreateBusPlanDto) {
    return this.busPlanService.create(dto);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List active bus plans' })
  async findAll() {
    return this.busPlanService.findAll();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get bus plan details' })
  async findOne(@Param('id') id: string) {
    return this.busPlanService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a bus plan' })
  async update(@Param('id') id: string, @Body() dto: UpdateBusPlanDto) {
    return this.busPlanService.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'FinancialSettings' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a bus plan (soft delete)' })
  async deactivate(@Param('id') id: string) {
    return this.busPlanService.deactivate(id);
  }
}
