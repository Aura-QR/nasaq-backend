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

@Controller('attendance')
@ApiTags('Attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new attendance record (mark student as absent)' })
  @ApiResponse({ status: 201, description: 'Attendance record created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student or Class not found' })
  @ApiResponse({ status: 409, description: 'Attendance record already exists' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createAttendanceDto: CreateAttendanceDto) {
    return await this.attendanceService.create(createAttendanceDto);
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
  @ApiOperation({ summary: 'Update an attendance record by ID' })
  @ApiParam({ name: 'id', description: 'Attendance record ID', type: String })
  @ApiResponse({ status: 200, description: 'Attendance record updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateAttendanceDto: UpdateAttendanceDto,
  ) {
    return await this.attendanceService.update(id, updateAttendanceDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an attendance record by ID' })
  @ApiParam({ name: 'id', description: 'Attendance record ID', type: String })
  @ApiResponse({ status: 200, description: 'Attendance record deleted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid ID format' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    return await this.attendanceService.delete(id);
  }
}
