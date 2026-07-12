import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DiscountService } from './discount.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';

@Controller('financial/discounts')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Discounts')
@ApiBearerAuth()
export class DiscountController {
  constructor(private readonly discountService: DiscountService) {}

  // ── Discount templates ────────────────────────────────────────────

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a discount template' })
  async create(@Body() dto: CreateDiscountDto, @CurrentUser() user: any) {
    return this.discountService.create(dto, user.userId);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all discount templates' })
  async find() {
    return this.discountService.find();
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get discount template by ID' })
  async findOne(@Param('id') id: string) {
    return this.discountService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update discount template' })
  async update(@Param('id') id: string, @Body() dto: UpdateDiscountDto) {
    return this.discountService.update(id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete discount template (blocked if used by students)' })
  async delete(@Param('id') id: string) {
    return this.discountService.delete(id);
  }

  // ── Apply / remove on student fees ───────────────────────────────

  @Post('apply/tuition/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a discount to a student tuition fee' })
  async applyToTuition(@Param('studentId') studentId: string, @Body() dto: ApplyDiscountDto) {
    return this.discountService.applyToTuition(studentId, dto);
  }

  @Delete('apply/tuition/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove discount from a student tuition fee' })
  async removeFromTuition(@Param('studentId') studentId: string) {
    return this.discountService.removeFromTuition(studentId);
  }

  @Post('apply/bus/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a discount to a student bus fee' })
  async applyToBus(@Param('studentId') studentId: string, @Body() dto: ApplyDiscountDto) {
    return this.discountService.applyToBus(studentId, dto);
  }

  @Delete('apply/bus/:studentId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove discount from a student bus fee' })
  async removeFromBus(@Param('studentId') studentId: string) {
    return this.discountService.removeFromBus(studentId);
  }

  @Post('apply/trips/:studentId/:tripId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a discount to a student trip fee' })
  async applyToTrip(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
    @Body() dto: ApplyDiscountDto,
  ) {
    return this.discountService.applyToTrip(studentId, tripId, dto);
  }

  @Delete('apply/trips/:studentId/:tripId')
  @CheckAbilities({ action: 'update', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove discount from a student trip fee' })
  async removeFromTrip(
    @Param('studentId') studentId: string,
    @Param('tripId') tripId: string,
  ) {
    return this.discountService.removeFromTrip(studentId, tripId);
  }
}
