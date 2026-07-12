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
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Create a new class' })
  @ApiResponse({ status: 201, description: 'Class created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Class already exists' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createClassDto: CreateClassDto) {
    return await this.classesService.create(createClassDto)
  }

  @ApiOperation({ summary: 'Get all classes or filter with query params' })
  @ApiResponse({ status: 200, description: 'Classes fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Classes not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams
    const pagination: PaginationDto = { page, limit }
    return await this.classesService.filtering(filters, pagination)
  }

  // @ApiOperation({ summary: 'Get only active classes' })
  // @ApiResponse({ status: 200, description: 'Active classes fetched successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Active classes not found' })
  // @Get('active')
  // @HttpCode(HttpStatus.OK)
  // async findActive() {

  //   return await this.classesService.findActive();
  // }

  // @ApiOperation({ summary: 'Get only inactive classes' })
  // @ApiResponse({ status: 200, description: 'Inactive classes fetched successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Inactive classes not found' })
  // @Get('inactive')
  // @HttpCode(HttpStatus.OK)
  // async findInactive() {

  //   return await this.classesService.findInactive();
  // }

  @ApiOperation({ summary: 'Get list for classes' })
  @ApiResponse({ status: 200, description: 'List of classes fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'List of classes not found' })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list() {

    return await this.classesService.list()
  }

  @ApiOperation({ summary: 'Get classes that the logged-in teacher teaches with subjects' })
  @ApiResponse({ status: 200, description: 'Teacher classes retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my-classes')
  @HttpCode(HttpStatus.OK)
  async getMyClasses(@CurrentUser() user: any) {
    return await this.classesService.getTeacherClasses(user.userId);
  }

  // @ApiOperation({ summary: 'Filter classes by Url parameters' })
  // @ApiResponse({ status: 200, description: 'Classes filtered successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Classes not found' })
  // @Get('filter')
  // @HttpCode(HttpStatus.OK)
  // async filter(
  //   @Query() allParams: any
  // ) {
  //   return await this.classesService.filtering(allParams)
  // }

  // @ApiOperation({ summary: 'Get classes teaching specific subject' })
  // @ApiResponse({ status: 200, description: 'Classes teaching specific subject fetched successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Classes not found' })
  // @Get('by-subject/:subjectId')
  // @HttpCode(HttpStatus.OK)
  // async findBySubject(
  //   @Param('subjectId') subjectId: string
  // ) {
  //   return await this.classesService.findBySubject(subjectId)
  // }

  @ApiOperation({ summary: 'Get the class of the authenticated student' })
  @ApiResponse({ status: 200, description: 'Student class fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('student/me')
  @HttpCode(HttpStatus.OK)
  async getMyClass(@CurrentUser() user: any) {
    return await this.classesService.getMyClass(user.userId);
  }

  @ApiOperation({ summary: 'Get classmates of the authenticated student' })
  @ApiResponse({ status: 200, description: 'Classmates fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('student/me/mates')
  @HttpCode(HttpStatus.OK)
  async getMyClassMates(@CurrentUser() user: any) {
    return await this.classesService.getMyClassMates(user.userId);
  }

  @ApiOperation({ summary: 'Get all students in a class' })
  @ApiResponse({ status: 200, description: 'All students in a class fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Students not found' })
  @Get(':id/students')
  @HttpCode(HttpStatus.OK)
  async getStudentsInClass(
    @Param('id') id: string
  ) {
    return await this.classesService.getStudentsInClass(id)
  }

  @ApiOperation({ summary: 'Get class by ID' })
  @ApiResponse({ status: 200, description: 'Class fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @Param('id') id: string)
     {
    return await this.classesService.findOne(id)
  }

  @ApiOperation({ summary: 'Update class (full update)' })
  @ApiResponse({ status: 200, description: 'Class updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateClassDto: UpdateClassDto,
  ) {
    return await this.classesService.update(id, updateClassDto);
  }

  // @ApiOperation({ summary: 'Add single subject to class' })
  // @ApiResponse({ status: 200, description: 'Single subject added to class successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subject not found' })
  // @Patch(':id/add-subject/:subjectId')
  // @HttpCode(HttpStatus.OK)
  // async addSubject(
  //   @Param('id') id: string,
  //   @Param('subjectId') subjectId: string,
  // ) {
  //   return await this.classesService.addSubject(id, subjectId);
  // }

  // @ApiOperation({ summary: 'Remove single subject from class' })
  // @ApiResponse({ status: 200, description: 'Single subject removed from class successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subject not found' })
  // @Patch(':id/remove-subject/:subjectId')
  // @HttpCode(HttpStatus.OK)
  // async removeSubject(
  //   @Param('id') id: string,
  //   @Param('subjectId') subjectId: string,
  // ) {
  //   return await this.classesService.removeSubject(id, subjectId);
  // }

  // @ApiOperation({ summary: 'Add multiple subjects to class' })
  // @ApiResponse({ status: 200, description: 'Multiple subjects added to class successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subjects not found' })
  // @Patch(':id/add-subjects')
  // @HttpCode(HttpStatus.OK)
  // async addSubjects(
  //   @Param('id') id: string,
  //   @Body() body: { subjectIds: string[] },
  // ) {
  //   return await this.classesService.addSubjects(id, body.subjectIds);
  // }

  // @ApiOperation({ summary: 'Remove multiple subjects from class' })
  // @ApiResponse({ status: 200, description: 'Multiple subjects removed from class successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subjects not found' })
  // @Patch(':id/remove-subjects')
  // @HttpCode(HttpStatus.OK)
  // async removeSubjects(
  //   @Param('id') id: string,
  //   @Body() body: { subjectIds: string[] },
  // ) {
  //   return await this.classesService.removeSubjects(id, body.subjectIds);
  // }

  // @ApiOperation({ summary: 'Replace all subjects (set exact list)' })
  // @ApiResponse({ status: 200, description: 'All subjects replaced successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subjects not found' })
  // @Patch(':id/set-subjects')
  // @HttpCode(HttpStatus.OK)
  // async setSubjects(
  //   @Param('id') id: string,
  //   @Body() body: { subjectIds: string[] },
  // ) {
  //   return await this.classesService.setSubjects(id, body.subjectIds);
  // }

  // @ApiOperation({ summary: 'Clear all subjects from class' })
  // @ApiResponse({ status: 200, description: 'All subjects cleared successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subjects not found' })
  // @Patch(':id/clear-subjects')
  // @HttpCode(HttpStatus.OK)
  // async clearSubjects(
  //   @Param('id') id: string
  // ) {
  //   return await this.classesService.clearSubjects(id);
  // }

  @ApiOperation({ summary: 'Add single student to class' })
  @ApiResponse({ status: 200, description: 'Single student added to class successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Patch(':id/add-student/:studentId')
  @HttpCode(HttpStatus.OK)
  async addStudent(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return await this.classesService.addStudent(id, studentId)
  }

  @ApiOperation({ summary: 'Remove single student from class' })
  @ApiResponse({ status: 200, description: 'Single student removed from class successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Patch(':id/remove-student/:studentId')
  @HttpCode(HttpStatus.OK)
  async removeStudent(
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return await this.classesService.removeStudent(id, studentId)
  }

  // @ApiOperation({ summary: 'Add multiple students to class' })
  // @ApiResponse({ status: 200, description: 'Multiple students added to class successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Students not found' })
  // @Patch(':id/add-students')
  // @HttpCode(HttpStatus.OK)
  // async addStudents(
  //   @Param('id') id: string,
  //   @Body() body: { studentIds: string[] },
  // ) {
  //   return await this.classesService.addStudents(id, body.studentIds);
  // }


  // @ApiOperation({ summary: 'Clear all students from class' })
  // @ApiResponse({ status: 200, description: 'All students cleared successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Students not found' })
  // @Patch(':id/clear-students')
  // @HttpCode(HttpStatus.OK)
  // async clearStudents(
  //   @Param('id') id: string) {
  //   return await this.classesService.clearStudents(id)
  // }

  @ApiOperation({ summary: 'Toggle active status' })
  @ApiResponse({ status: 200, description: 'Active status toggled successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  async toggleActive(
    @Param('id') id: string) {
    return await this.classesService.toggleActive(id)
  }

  @ApiOperation({ summary: 'Delete class' })
  @ApiResponse({ status: 200, description: 'Class deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string) {
    return await this.classesService.remove(id)
  }
}