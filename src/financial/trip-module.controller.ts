import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { TripService } from './trip.service';
import { CreateFinancialTripDto } from './dto/create-financial-trip.dto';
import { EnrollTripStudentDto } from './dto/enroll-trip-student.dto';

@Controller('financial/trips')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Financial - Trips Module')
@ApiBearerAuth()
export class TripModuleController {
  constructor(private readonly tripService: TripService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a trip template' })
  async createTemplate(@Body() dto: CreateFinancialTripDto) {
    return this.tripService.createTemplate(dto);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List trip templates' })
  async findTemplates() {
    return this.tripService.findTemplates();
  }

  @Get(':tripTemplateId')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get trip template details' })
  async findTemplate(@Param('tripTemplateId') tripTemplateId: string) {
    return this.tripService.findTemplate(tripTemplateId);
  }

  @Get(':tripTemplateId/students')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List students enrolled in a trip template' })
  @ApiQuery({ name: 'academicYear', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findTemplateStudents(@Param('tripTemplateId') tripTemplateId: string, @Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.tripService.findTemplateStudents(tripTemplateId, filters, { page, limit });
  }

  @Get(':tripTemplateId/candidates')
  @CheckAbilities({ action: 'read', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List students who can be added to a trip template' })
  @ApiQuery({ name: 'academicYear', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findTemplateCandidates(@Param('tripTemplateId') tripTemplateId: string, @Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.tripService.findTemplateCandidates(tripTemplateId, filters, { page, limit });
  }

  @Post(':tripTemplateId/enroll')
  @CheckAbilities({ action: 'create', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a student to a trip template' })
  async enrollStudent(@Param('tripTemplateId') tripTemplateId: string, @Body() dto: EnrollTripStudentDto) {
    return this.tripService.enrollStudent(tripTemplateId, dto);
  }

  @Delete(':tripTemplateId/students/:studentId')
  @CheckAbilities({ action: 'delete', subject: 'Financial' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a student from a trip template' })
  async removeStudent(
    @Param('tripTemplateId') tripTemplateId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.tripService.removeStudent(tripTemplateId, studentId);
  }
}
