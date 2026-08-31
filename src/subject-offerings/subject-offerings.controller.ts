import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Patch,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { SubjectOfferingsService } from './subject-offerings.service';
import { CreateSubjectOfferingDto } from './dto/create-subject-offering.dto';
import { UpdateSubjectOfferingDto } from './dto/update-subject-offering.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('subject-offerings')
@Controller('subject-offerings')
export class SubjectOfferingsController {
  constructor(private readonly subjectOfferingsService: SubjectOfferingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new subject offering' })
  @ApiResponse({ status: 201, description: 'Subject offering created successfully' })
  @ApiResponse({ status: 409, description: 'Offering already exists for term and grade level' })
  async create(@Body() dto: CreateSubjectOfferingDto) {
    return await this.subjectOfferingsService.create(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all subject offerings, optionally filtered' })
  @ApiQuery({ name: 'termId', required: false, type: String })
  @ApiQuery({ name: 'gradeLevelId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Subject offerings fetched successfully' })
  async findAll(
    @Query('termId') termId?: string,
    @Query('gradeLevelId') gradeLevelId?: string,
  ) {
    return await this.subjectOfferingsService.findAll({ termId, gradeLevelId });
  }

  @Get('by-term/:termId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get subject offerings for a term' })
  @ApiQuery({ name: 'gradeLevelId', required: false })
  async findByTerm(
    @Param('termId') termId: string,
    @Query('gradeLevelId') gradeLevelId?: string,
  ) {
    return await this.subjectOfferingsService.findByTerm(termId, gradeLevelId);
  }

  @Post('copy-from/:targetYearId/:sourceYearId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Copy subject offerings from a previous year (Wizard Step 6)' })
  async copyFromYear(
    @Param('targetYearId') targetYearId: string,
    @Param('sourceYearId') sourceYearId: string,
  ) {
    return await this.subjectOfferingsService.copyFromYear(targetYearId, sourceYearId);
  }

  @Patch('plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save a whole teaching plan in one write',
    description:
      'Sets periodsPerWeek across many offerings at once — the plan is entered ' +
      'as a grid, so it is saved as one. All ids are checked before anything ' +
      'is written.',
  })
  @ApiResponse({ status: 200, description: 'Plan saved' })
  @ApiResponse({ status: 404, description: 'One or more offerings not found' })
  async updatePlan(@Body() dto: UpdatePlanDto) {
    return await this.subjectOfferingsService.updatePlan(dto);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get subject offering by ID' })
  async findOne(@Param('id') id: string) {
    return await this.subjectOfferingsService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a subject offering (periods per week)' })
  @ApiResponse({ status: 404, description: 'Subject offering not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSubjectOfferingDto,
  ) {
    return await this.subjectOfferingsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete subject offering' })
  async remove(@Param('id') id: string) {
    return await this.subjectOfferingsService.remove(id);
  }
}
