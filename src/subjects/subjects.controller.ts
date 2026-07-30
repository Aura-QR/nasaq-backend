import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
@Controller('subjects')
@ApiTags('Subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) { }

  @ApiOperation({ summary: 'Create a new subject' })
  @ApiResponse({ status: 201, description: 'Subject created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Subject already exists' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createSubjectDto: CreateSubjectDto) {
    return await this.subjectsService.create(createSubjectDto);
  }

  @ApiOperation({ summary: 'Get all subjects or filter with query params' })
  @ApiResponse({ status: 200, description: 'Subjects fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subjects not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async findAll(@CurrentUser() user: any, @Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.subjectsService.filtering(filters, pagination);
  }

  @ApiOperation({ summary: 'Get subjects for the authenticated student' })
  @ApiResponse({ status: 200, description: 'Subjects fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMySubjects(@CurrentUser() user: any) {
    return await this.subjectsService.getMySubjects(user.userId);
  }

  @ApiOperation({ summary: 'Get all subjects the authenticated teacher teaches' })
  @ApiResponse({ status: 200, description: 'Subjects fetched successfully' })
  @Get('teacher/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getTeacherSubjects(@CurrentUser() user: any) {
    return await this.subjectsService.getTeacherSubjects(user.userId);
  }

  @ApiOperation({ summary: 'Get simplified list for dropdowns' })
  @ApiResponse({ status: 200, description: 'List of subjects fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'List of subjects not found' })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list() {
    return await this.subjectsService.list();
  }


  @ApiOperation({ summary: 'Get a subject by ID' })
  @ApiResponse({ status: 200, description: 'Subject fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subject not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.subjectsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a subject' })
  @ApiResponse({ status: 200, description: 'Subject updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subject not found' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateSubjectDto: UpdateSubjectDto,
  ) {
    return await this.subjectsService.update(id, updateSubjectDto);
  }

  @ApiOperation({ summary: 'Delete a subject' })
  @ApiResponse({ status: 200, description: 'Subject deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subject not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.subjectsService.remove(id);
  }

  // @ApiOperation({ summary: 'Add a class to a subject' })
  // @ApiResponse({ status: 200, description: 'Class added to subject successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Class not found' })
  // @Post(':subjectId/classes/:classId')
  // @HttpCode(HttpStatus.OK)
  // async addClass(
  //   @Param('subjectId') subjectId: string,
  //   @Param('classId') classId: string,
  // ) {
  //   return await this.subjectsService.addClass(subjectId, classId);
  // }

  // @ApiOperation({ summary: 'Remove a class from a subject' })
  // @ApiResponse({ status: 200, description: 'Class removed from subject successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Class not found' })
  // @Delete(':subjectId/classes/:classId')
  // @HttpCode(HttpStatus.OK)
  // async removeClass(
  //   @Param('subjectId') subjectId: string,
  //   @Param('classId') classId: string,
  // ) {
  //   return await this.subjectsService.removeClass(subjectId, classId);
  // }
}