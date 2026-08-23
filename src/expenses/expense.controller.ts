import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ExpenseService } from './expense.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Expenses')
@ApiBearerAuth()
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an expense' })
  async create(@Body() dto: CreateExpenseDto, @CurrentUser() user: any) {
    return this.expenseService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all expenses with filters and pagination' })
  @ApiQuery({ name: 'name', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'academicYearId', required: false })
  @ApiQuery({ name: 'academicYear', required: false, deprecated: true, description: 'Year name; use academicYearId' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async find(@Query() query: any) {
    const { page, limit, name, categoryId, academicYearId, academicYear, dateFrom, dateTo } =
      query;
    return this.expenseService.find(
      { name, categoryId, academicYearId, academicYear, dateFrom, dateTo },
      { page, limit },
    );
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get expense by ID' })
  async findOne(@Param('id') id: string) {
    return this.expenseService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an expense' })
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenseService.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an expense' })
  async delete(@Param('id') id: string) {
    return this.expenseService.delete(id);
  }
}
