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
import { LecturesService } from './lectures.service';
import { CreateLectureDto } from './dto/create-lecture.dto';
import { UpdateLectureDto } from './dto/update-lecture.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';


@ApiTags('Lectures')
@Controller('lectures')
export class LecturesController {
  constructor(private readonly lecturesService: LecturesService) {}


  @ApiOperation({ summary: 'Create a new lecture' })
  @ApiResponse({ status: 201, description: 'Lecture created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Class, Subject, or Teacher not found' })
  @ApiResponse({ status: 409, description: 'Scheduling conflict detected' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createLectureDto: CreateLectureDto) {
    return await this.lecturesService.create(createLectureDto);
  }

  // @ApiOperation({ summary: 'Create multiple lectures in bulk' })
  // @ApiResponse({ status: 201, description: 'Lectures created successfully' })
  // @ApiResponse({ status: 400, description: 'Validation or conflict errors' })
  // @ApiResponse({ status: 404, description: 'Class, Subject, or Teacher not found' })
  // @ApiResponse({ status: 409, description: 'Scheduling conflict detected' })
  // @Post('bulk')
  // @HttpCode(HttpStatus.CREATED)
  // async createBulk(@Body() createLectureDtos: CreateLectureDto[]) {
  //   return await this.lecturesService.createBulk(createLectureDtos);
  // }

  @ApiOperation({
    summary: 'Get all lectures or filter with query params (supports _id, classId, subjectId, teacherId, dayOfWeek, slot, roomNumber, page, limit)'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiResponse({ status: 200, description: 'Lectures fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  @CheckAbilities({ action: 'read', subject: 'Lecture' })
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AbilitiesGuard)
  @ApiBearerAuth()
  async findAll(@CurrentUser() user: any, @Query() queryParams: any) {

    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.lecturesService.filtering(filters, pagination, user);
  }

  @ApiOperation({ summary: 'Get schedule for the authenticated student' })
  @ApiResponse({ status: 200, description: 'Student schedule retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMySchedule(@CurrentUser() user: any) {
    return await this.lecturesService.getMySchedule(user.userId);
  }

  @ApiOperation({ summary: 'Get classes the authenticated teacher teaches, grouped by subject. Pass subjectId to filter to one subject.' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Filter to a specific subject' })
  @ApiResponse({ status: 200, description: 'Classes retrieved successfully' })
  @Get('teacher/me/classes')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getTeacherClasses(@CurrentUser() user: any, @Query('subjectId') subjectId?: string) {
    return await this.lecturesService.getTeacherClasses(user.userId, subjectId);
  }

  @ApiOperation({ summary: 'Get all lectures for a specific student' })
  @ApiResponse({ status: 200, description: 'Student lectures retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid student ID format' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/:id')
  @HttpCode(HttpStatus.OK)
  async getStudentLectures(@Param('id') id: string) {
    return await this.lecturesService.getStudentLectures(id);
  }

  @ApiOperation({ summary: 'Get a single lecture by ID' })
  @ApiResponse({ status: 200, description: 'Lecture retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid lecture ID format' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.lecturesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update lecture' })
  @ApiResponse({ status: 200, description: 'Lecture updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @ApiResponse({ status: 409, description: 'Scheduling conflict detected' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateLectureDto: UpdateLectureDto,
  ) {
    return await this.lecturesService.update(id, updateLectureDto);
  }

  @ApiOperation({ summary: 'Delete lecture' })
  @ApiResponse({ status: 200, description: 'Lecture deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.lecturesService.remove(id);
  }
}
