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
import { TeachersService } from './teachers.service';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from 'src/casl/guards/abilities.guard';
import { CheckAbilities } from 'src/casl/decorators/check-abilities.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@Controller('teachers')
@ApiTags('Teachers')
export class TeachersController {
  constructor(private readonly teachersService: TeachersService) { }

  @ApiOperation({ summary: 'Create a new teacher' })
  @ApiResponse({ status: 201, description: 'Teacher created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Teacher already exists' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createTeacherDto: CreateTeacherDto) {
    return await this.teachersService.create(createTeacherDto);
  }

  @ApiOperation({ summary: 'Get all teachers or filter with query params' })
  @ApiResponse({ status: 200, description: 'Teachers fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teachers not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.teachersService.filtering(filters, pagination);
  }

  // @ApiOperation({ summary: 'Get only active teachers' })
  // @ApiResponse({ status: 200, description: 'Active teachers fetched successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Active teachers not found' })
  // @Get('active')
  // @HttpCode(HttpStatus.OK)
  // async findActive() {
  //   return await this.teachersService.findActive();
  // }

  // @ApiOperation({ summary: 'Get only inactive teachers' })
  // @ApiResponse({ status: 200, description: 'Inactive teachers fetched successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Inactive teachers not found' })
  // @Get('inactive')
  // @HttpCode(HttpStatus.OK)
  // async findInactive() {
  //   return await this.teachersService.findInactive();
  // }

  @ApiOperation({ summary: 'Get current teacher profile' })
  @ApiResponse({ status: 200, description: 'Teacher profile fetched successfully' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AbilitiesGuard)
  @CheckAbilities({ action: 'read', subject: 'Teacher' })
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@CurrentUser() user: any) {
    return await this.teachersService.getMyProfile(user.userId);
  }

  @ApiOperation({ summary: 'Get simplified list for dropdowns' })
  @ApiResponse({ status: 200, description: 'List of teachers fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'List of teachers not found' })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list() {
    return await this.teachersService.list();
  }

  // @ApiOperation({ summary: 'Filter teachers by URL parameters' })
  // @ApiResponse({ status: 200, description: 'Teachers filtered successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Teachers not found' })
  // @Get('filter')
  // @HttpCode(HttpStatus.OK)
  // async filter(@Query() allParams: any) {
  //   return await this.teachersService.filtering(allParams);
  // }

  // @ApiOperation({ summary: 'Get teachers by subject' })
  // @Get('by-subject/:subjectId')
  // async findBySubject(@Param('subjectId') subjectId: string) {
  //   return await this.teachersService.findBySubject(subjectId);
  // }  

  @ApiOperation({ summary: 'Get teacher by ID' })
  @ApiResponse({ status: 200, description: 'Teacher fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.teachersService.findOne(id);
  }

  @ApiOperation({ summary: 'Update teacher' })
  @ApiResponse({ status: 200, description: 'Teacher updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateTeacherDto: UpdateTeacherDto,
  ) {
    return await this.teachersService.update(id, updateTeacherDto);
  }

  @ApiOperation({ summary: 'Toggle active status' })
  @ApiResponse({ status: 200, description: 'Teacher active status toggled successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  async toggleActive(@Param('id') id: string) {
    return await this.teachersService.toggleActive(id);
  }

  // @ApiOperation({ summary: 'Add a subject to teacher' })
  // @ApiResponse({ status: 200, description: 'Subject added to teacher successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subject not found' })
  // @Post(':teacherId/subjects/:subjectId')
  // @HttpCode(HttpStatus.OK)
  // async addSubject(
  //   @Param('teacherId') teacherId: string,
  //   @Param('subjectId') subjectId: string,
  // ) {
  //   return await this.teachersService.addSubject(teacherId, subjectId);
  // }

  // @ApiOperation({ summary: 'Remove a subject from teacher' })
  // @ApiResponse({ status: 200, description: 'Subject removed from teacher successfully' })
  // @ApiResponse({ status: 400, description: 'Bad request' })
  // @ApiResponse({ status: 404, description: 'Subject not found' })
  // @Delete(':teacherId/subjects/:subjectId')
  // @HttpCode(HttpStatus.OK)
  // async removeSubject(
  //   @Param('teacherId') teacherId: string,
  //   @Param('subjectId') subjectId: string,
  // ) {
  //   return await this.teachersService.removeSubject(teacherId, subjectId);
  // }

  @ApiOperation({ summary: 'Delete teacher' })
  @ApiResponse({ status: 200, description: 'Teacher deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.teachersService.remove(id);
  }
}