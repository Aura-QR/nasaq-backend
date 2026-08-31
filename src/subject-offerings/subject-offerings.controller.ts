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
import { ImportPlanDto } from './dto/import-plan.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('subject-offerings')
@Controller('subject-offerings')
export class SubjectOfferingsController {
  constructor(private readonly subjectOfferingsService: SubjectOfferingsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
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

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('copy-from/:targetYearId/:sourceYearId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Copy subject offerings from a previous year (Wizard Step 6)' })
  async copyFromYear(
    @Param('targetYearId') targetYearId: string,
    @Param('sourceYearId') sourceYearId: string,
  ) {
    return await this.subjectOfferingsService.copyFromYear(targetYearId, sourceYearId);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('import-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Import a teaching plan pasted from a spreadsheet',
    description:
      'One subject per line, name then periods. Tab, comma, pipe, semicolon ' +
      'or plain spacing all work, so a paste straight out of Excel is taken ' +
      'as-is, and honorifics and alef spellings are folded before matching.\n\n' +
      'dryRun defaults to true: the report says what every line matched and ' +
      'nothing is written until you send dryRun: false.',
  })
  @ApiResponse({ status: 200, description: 'Parse report, and the writes if dryRun was false' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  async importPlan(@Body() dto: ImportPlanDto) {
    return await this.subjectOfferingsService.importPlan(dto);
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

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
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

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete subject offering' })
  async remove(@Param('id') id: string) {
    return await this.subjectOfferingsService.remove(id);
  }
}
