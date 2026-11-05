import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { FeeItemService } from './fee-item.service';
import { CreateFeeItemDto, SellFeeItemDto, UpdateFeeItemDto } from './dto/fee-item.dto';

@Controller('financial/fee-items')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Priced Items')
@ApiBearerAuth()
export class FeeItemController {
  constructor(private readonly service: FeeItemService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @ApiOperation({ summary: 'Add an item sold by the piece (e.g. uniform at 150)' })
  create(@Body() dto: CreateFeeItemDto, @CurrentUser() user: any) {
    return this.service.create(dto, user?.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @ApiOperation({ summary: 'List priced items' })
  find() {
    return this.service.find();
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @ApiOperation({ summary: 'Change an item (a new price applies to future sales only)' })
  update(@Param('id') id: string, @Body() dto: UpdateFeeItemDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @ApiOperation({ summary: 'Delete an item that was never sold' })
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/sell/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Charge a student quantity × unit price; with paidAt, record it paid too' })
  sell(@Param('id') id: string, @Param('studentId') studentId: string, @Body() dto: SellFeeItemDto, @CurrentUser() user: any) {
    return this.service.sell(id, studentId, dto, user?.userId);
  }

  @Delete('sales/:studentId/:saleId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @ApiOperation({ summary: 'Cancel an unpaid sale' })
  @ApiQuery({ name: 'academicYearId', required: false })
  cancelSale(@Param('studentId') studentId: string, @Param('saleId') saleId: string, @Query('academicYearId') academicYearId?: string) {
    return this.service.cancelSale(studentId, saleId, academicYearId);
  }
}
