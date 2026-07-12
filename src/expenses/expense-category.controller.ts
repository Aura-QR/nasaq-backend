import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseCategoryService } from './expense-category.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-expense-category.dto';

@Controller('expenses/categories')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Expenses - Categories')
@ApiBearerAuth()
export class ExpenseCategoryController {
  constructor(private readonly expenseCategoryService: ExpenseCategoryService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an expense category' })
  async create(@Body() dto: CreateExpenseCategoryDto, @CurrentUser() user: any) {
    return this.expenseCategoryService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all expense categories' })
  async find() {
    return this.expenseCategoryService.find();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get expense category by ID' })
  async findOne(@Param('id') id: string) {
    return this.expenseCategoryService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an expense category' })
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseCategoryDto) {
    return this.expenseCategoryService.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an expense category (blocked if has expenses)' })
  async delete(@Param('id') id: string) {
    return this.expenseCategoryService.delete(id);
  }
}
