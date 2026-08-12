import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Query,
  Patch,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';

// AbilitiesGuard is now an APP_GUARD (see app.module.ts), so this is redundant
// — kept for consistency with the other sixteen controllers that declare it.
// It used to be required, and this controller was the one that forgot it,
// which left POST /attendance open to students despite @CheckAbilities.
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@Controller('attendance')
@ApiTags('Attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Attendance' })
  @ApiOperation({ summary: 'Create a new attendance record (mark student as absent)' })
  @ApiResponse({ status: 201, description: 'Attendance record created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Not allowed to record attendance' })
  @ApiResponse({ status: 404, description: 'Student or Class not found' })
  @ApiResponse({ status: 409, description: 'Attendance record already exists' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createAttendanceDto: CreateAttendanceDto,
    @CurrentUser() user: any,
  ) {
    return await this.attendanceService.create(createAttendanceDto, user);
  }

  @ApiOperation({
    summary: "Attendance sheet for one lecture — the lecture, its class roster, and today's absences",
  })
  @ApiParam({ name: 'lectureId', description: 'Lecture ID', type: String })
  @ApiQuery({ name: 'date', required: true, description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 200, description: 'Attendance sheet fetched successfully' })
  @ApiResponse({ status: 403, description: 'Not the teacher of this lecture' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Get('lecture/:lectureId/sheet')
  @CheckAbilities({ action: 'create', subject: 'Attendance' })
  @HttpCode(HttpStatus.OK)
  async getLectureSheet(
    @Param('lectureId') lectureId: string,
    @CurrentUser() user: any,
    @Query('date') date: string,
  ) {
    return await this.attendanceService.getLectureSheet(lectureId, date, user);
  }

  @ApiOperation({ summary: 'Get absence records for the authenticated student' })
  @ApiResponse({ status: 200, description: 'Absence records fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyAttendance(@CurrentUser() user: any) {
    return await this.attendanceService.getMyAttendance(user.userId);
  }

  @ApiOperation({
    summary: 'Get all attendance records or filter with query params (supports _id, studentId, classId, date, createdAt, updatedAt, page, limit)'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiResponse({ status: 200, description: 'Attendance records fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.attendanceService.filtering(filters, pagination);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Attendance' })
  @ApiOperation({ summary: 'Update an attendance record by ID' })
  @ApiParam({ name: 'id', description: 'Attendance record ID', type: String })
  @ApiResponse({ status: 200, description: 'Attendance record updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateAttendanceDto: UpdateAttendanceDto,
    @CurrentUser() user: any,
  ) {
    return await this.attendanceService.update(id, updateAttendanceDto, user);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Attendance' })
  @ApiOperation({ summary: 'Delete an attendance record by ID' })
  @ApiParam({ name: 'id', description: 'Attendance record ID', type: String })
  @ApiResponse({ status: 200, description: 'Attendance record deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.attendanceService.delete(id, user);
  }
}
