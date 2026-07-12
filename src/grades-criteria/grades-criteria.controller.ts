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

  @Post()
  @ApiOperation({ summary: 'Create a grading criteria for a subject in a class' })
  @ApiResponse({ status: 201, description: 'Grading criteria created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  @ApiResponse({ status: 404, description: 'Class or subject not found' })
  @ApiResponse({ status: 409, description: 'Subject is not assigned to this class' })
  create(@Body() createGradesCriteriaDto: CreateGradesCriteriaDto) {
    return this.gradesCriteriaService.create(createGradesCriteriaDto);
  }

  @ApiOperation({ summary: 'Get grading criteria for the authenticated student' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Filter by subject ID' })
  @ApiQuery({ name: 'academicYear', required: false, type: String, description: 'Filter by academic year' })
  @ApiResponse({ status: 200, description: 'Grading criteria fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyGradesCriteria(@CurrentUser() user: any, @Query('subjectId') subjectId?: string, @Query('academicYear') academicYear?: string) {
    return await this.gradesCriteriaService.getMyGradesCriteria(user.userId, subjectId, academicYear);
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

  @ApiOperation({ summary: 'Get grades of the authenticated student for a subject' })
  @ApiQuery({ name: 'subjectId', required: true, type: String, description: 'Subject ID' })
  @ApiResponse({ status: 200, description: 'Grades fetched successfully' })
  @ApiResponse({ status: 400, description: 'Subject not in student class' })
  @ApiResponse({ status: 404, description: 'Student or grading criteria not found' })
  @Get('student/me/grades')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyGrades(@CurrentUser() user: any, @Query('subjectId') subjectId: string) {
    return await this.gradesCriteriaService.getMyGrades(user.userId, subjectId);
  }

  @ApiOperation({ summary: 'Get all grading criteria or filter with query params' })
  @ApiResponse({ status: 200, description: 'Grading criteria fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Grading criteria not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
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
  @ApiResponse({status: HttpStatus.OK, description: 'Grades criteria found successfully'})
  @ApiResponse({status: HttpStatus.NOT_FOUND,description: 'Grades criteria not found'})
  @ApiResponse({status: HttpStatus.BAD_REQUEST,description: 'Invalid ID format'})
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.gradesCriteriaService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a grading criteria by ID' })
  @ApiResponse({ status: 200, description: 'Grading criteria updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid ID or validation failed' })
  @ApiResponse({ status: 404, description: 'GradesCriteria not found' })
  @ApiResponse({ status: 409, description: 'Subject is not assigned to this class' })
  update(@Param('id') id: string, @Body() updateGradesCriteriaDto: UpdateGradesCriteriaDto) {
    return this.gradesCriteriaService.update(id, updateGradesCriteriaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a grading criteria by ID' })
  @ApiResponse({ status: 200, description: 'Grading criteria deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid ID format' })
  @ApiResponse({ status: 404, description: 'GradesCriteria not found' })
  remove(@Param('id') id: string) {
    return this.gradesCriteriaService.remove(id);
  }
}
