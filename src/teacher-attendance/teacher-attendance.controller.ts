import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { CheckInTeacherAttendanceDto } from './dto/check-in-teacher-attendance.dto';
import { CreateManualTeacherAttendanceDto } from './dto/create-manual-teacher-attendance.dto';
import { QueryTeacherAttendanceDto } from './dto/query-teacher-attendance.dto';
import { CheckOutTeacherAttendanceDto } from './dto/check-out-teacher-attendance.dto';
import { SummaryTeacherAttendanceDto } from './dto/summary-teacher-attendance.dto';
import { UpdateTeacherAttendanceDto } from './dto/update-teacher-attendance.dto';
import { extractClientIp, TeacherAttendanceService } from './teacher-attendance.service';

@Controller('teacher-attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiTags('Teacher Attendance')
@ApiBearerAuth()
export class TeacherAttendanceController {
  constructor(private readonly teacherAttendanceService: TeacherAttendanceService) {}

  @Get('detect-ip')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detect current client public IP for school network configuration (Admin only)' })
  async detectClientIp(@Req() req: any) {
    return { ip: extractClientIp(req) };
  }

  @Post('check-in')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Teacher self check-in via location & school network (TEACHER only)' })
  @ApiResponse({ status: 200, description: 'Attendance recorded successfully' })
  @ApiResponse({ status: 400, description: 'Check-in disabled or school location unconfigured' })
  @ApiResponse({ status: 403, description: 'Location and network verification both failed' })
  @ApiResponse({ status: 409, description: 'Already checked in today' })
  async checkIn(
    @CurrentUser() user: any,
    @Body() dto: CheckInTeacherAttendanceDto,
    @Req() req: any,
  ) {
    return this.teacherAttendanceService.checkIn(user, dto, req);
  }

  @Post('check-out')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Teacher self-service check-out' })
  async checkOut(
    @CurrentUser() user: any,
    @Body() dto: CheckOutTeacherAttendanceDto,
    @Req() req: any,
  ) {
    return this.teacherAttendanceService.checkOut(user, dto, req);
  }

  // MUST stay above @Get(':id')-style routes if any are ever added, and above
  // nothing else here — 'summary' is a literal path.
  @Get('summary')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Per-teacher attendance totals for a period' })
  async getSummary(@Query() query: SummaryTeacherAttendanceDto) {
    return this.teacherAttendanceService.getMonthlySummary(query);
  }

  @Get('me')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current teacher check-in history (TEACHER only)' })
  @ApiResponse({ status: 200, description: 'Attendance history retrieved successfully' })
  async getMyAttendance(
    @CurrentUser() user: any,
    @Query() query: QueryTeacherAttendanceDto,
  ) {
    return this.teacherAttendanceService.getMyAttendance(user, query);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record manual teacher attendance (Admin only)' })
  @ApiResponse({ status: 201, description: 'Manual attendance record created' })
  @ApiResponse({ status: 403, description: 'Forbidden for non-admins' })
  @ApiResponse({ status: 409, description: 'Already checked in today' })
  async createManual(
    @CurrentUser() user: any,
    @Body() dto: CreateManualTeacherAttendanceDto,
  ) {
    return this.teacherAttendanceService.createManual(user, dto);
  }

  @Get('absent')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get list of active teachers with no attendance record on a given date (Admin only)' })
  @ApiQuery({ name: 'date', required: false, description: 'Date to check (YYYY-MM-DD), defaults to today' })
  @ApiResponse({ status: 200, description: 'Absent teachers list retrieved successfully' })
  async findAbsent(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.teacherAttendanceService.findAbsent(date, user);
  }

  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all teacher attendance records with optional filters (Admin only)' })
  @ApiResponse({ status: 200, description: 'Attendance records retrieved successfully' })
  async findAll(@Query() query: QueryTeacherAttendanceDto) {
    return this.teacherAttendanceService.findAll(query);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an attendance record (Admin only)' })
  @ApiResponse({ status: 200, description: 'Attendance record updated successfully' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherAttendanceDto,
    @CurrentUser() user: any,
  ) {
    return this.teacherAttendanceService.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an attendance record (Admin only)' })
  @ApiResponse({ status: 200, description: 'Attendance record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Attendance record not found' })
  async delete(@Param('id') id: string) {
    return this.teacherAttendanceService.delete(id);
  }
}
