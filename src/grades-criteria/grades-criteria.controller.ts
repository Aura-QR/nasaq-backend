import { Controller, Post, Body, Get, Query, HttpCode, HttpStatus, Patch, Delete, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';

import { GradesCriteriaService } from './grades-criteria.service';
import { CreateGradesCriteriaDto } from './dto/create-grades-criteria.dto';
import { UpdateGradesCriteriaDto } from './dto/update-grades-criteria.dto';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('gradesCriteria')
@Controller('gradesCriteria')
export class GradesCriteriaController {
  constructor(private readonly gradesCriteriaService: GradesCriteriaService) {}

  // The weight distribution is school policy, not a per-teacher choice: two
  // students in different classes of the same grade are compared against each
  // other at promotion time, so they have to be measured with the same ruler.
  // A teacher works INSIDE the distribution — ExamsService derives each exam's
  // mark from it — but must not change it.
  //
  // The permission table already said exactly this
  // (TEACHER gradesCriteria.add = false, STUDENT = none) and had no effect for
  // as long as these three handlers carried no @CheckAbilities: AbilitiesGuard
  // returns true when a handler asks for nothing. A student's token could
  // rewrite the weights, and the passing grade with them.
  //
  // Do NOT add @UseGuards(AbilitiesGuard) here. It is already global in
  // app.module.ts; a class-level @UseGuards constructs it in this module's
  // injector, which does not import CaslModule, and the app fails to boot.
  @Post()
  @CheckAbilities({ action: 'create', subject: 'GradesCriteria' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a grading criteria for a subject offering (school admins only)' })
  @ApiResponse({ status: 201, description: 'Grading criteria created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  @ApiResponse({ status: 403, description: 'Only school admins may set the weight distribution' })
  @ApiResponse({ status: 404, description: 'Subject offering not found' })
  @ApiResponse({ status: 409, description: 'Grading criteria already exists for this subject offering' })
  create(@Body() createGradesCriteriaDto: CreateGradesCriteriaDto) {
    return this.gradesCriteriaService.create(createGradesCriteriaDto);
  }

  @ApiOperation({ summary: 'Get grading criteria for the authenticated student' })
  @ApiQuery({ name: 'subjectOfferingId', required: false, type: String, description: 'Filter by SubjectOffering ID' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Filter by Subject ID' })
  @ApiResponse({ status: 200, description: 'Grading criteria fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyGradesCriteria(
    @CurrentUser() user: any,
    @Query('subjectOfferingId') subjectOfferingId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return await this.gradesCriteriaService.getMyGradesCriteria(user.userId, subjectOfferingId, subjectId);
  }

  @ApiOperation({ summary: 'Get subjects of the authenticated student' })
  @ApiResponse({ status: 200, description: 'Subjects fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me/subjects')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMySubjects(@CurrentUser() user: any) {
    return await this.gradesCriteriaService.getMySubjects(user.userId);
  }

  @ApiOperation({ summary: 'Get grades of the authenticated student for a subject offering' })
  @ApiQuery({ name: 'subjectOfferingId', required: false, type: String, description: 'SubjectOffering ID' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Subject ID' })
  @ApiQuery({ name: 'academicYearId', required: false, type: String, description: 'Academic Year ID' })
  @ApiQuery({ name: 'termId', required: false, type: String, description: 'Term ID' })
  @ApiResponse({ status: 200, description: 'Grades fetched successfully' })
  @ApiResponse({ status: 400, description: 'Subject offering missing' })
  @ApiResponse({ status: 404, description: 'Student or grading criteria not found' })
  @Get('student/me/grades')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyGrades(
    @CurrentUser() user: any,
    @Query('subjectOfferingId') subjectOfferingId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('termId') termId?: string,
  ) {
    return await this.gradesCriteriaService.getMyGrades(
      user.userId,
      subjectOfferingId,
      subjectId,
      academicYearId,
      termId,
    );
  }

  @ApiOperation({ summary: 'Get all grading criteria or filter with query params' })
  @ApiResponse({ status: 200, description: 'Grading criteria fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Grading criteria not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'subjectOfferingId', required: false, type: String, description: 'Filter by SubjectOffering ID' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Filter by Subject ID' })
  @ApiQuery({ name: 'academicYearId', required: false, type: String, description: 'Filter by Academic Year ID' })
  @Get()
  @UseGuards(JwtAuthGuard, AbilitiesGuard)
  @ApiBearerAuth()
  @CheckAbilities({ action: 'read', subject: 'GradesCriteria' })
  @HttpCode(HttpStatus.OK)
  async findAll(@CurrentUser() user: any, @Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.gradesCriteriaService.filtering(filters, pagination, user);
  }

  @ApiOperation({ summary: 'Get grades criteria by ID' })
  @ApiParam({ name: 'id', description: 'Grades criteria ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Grades criteria found successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Grades criteria not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid ID format' })
  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'GradesCriteria' })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.gradesCriteriaService.findOne(id);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'GradesCriteria' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a grading criteria by ID (school admins only)' })
  @ApiResponse({ status: 200, description: 'Grading criteria updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid ID or validation failed' })
  @ApiResponse({ status: 403, description: 'Only school admins may change the weight distribution' })
  @ApiResponse({ status: 404, description: 'GradesCriteria not found' })
  update(@Param('id') id: string, @Body() updateGradesCriteriaDto: UpdateGradesCriteriaDto) {
    return this.gradesCriteriaService.update(id, updateGradesCriteriaDto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'GradesCriteria' })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a grading criteria by ID (school admins only)' })
  @ApiResponse({ status: 200, description: 'Grading criteria deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid ID format' })
  @ApiResponse({ status: 403, description: 'Only school admins may delete the weight distribution' })
  @ApiResponse({ status: 404, description: 'GradesCriteria not found' })
  remove(@Param('id') id: string) {
    return this.gradesCriteriaService.remove(id);
  }
}
