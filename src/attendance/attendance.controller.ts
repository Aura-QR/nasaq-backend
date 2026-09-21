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
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { multerExcuseConfig } from './config/multer-excuse.config';
import {
  ListAbsenceExcusesDto,
  ReviewAbsenceExcuseDto,
  SubmitAbsenceExcuseDto,
} from './dto/absence-excuse.dto';

// NO class-level @UseGuards(AbilitiesGuard) here, deliberately.
//
// AbilitiesGuard is an APP_GUARD (app.module.ts), so @CheckAbilities below is
// already enforced. Declaring it locally as well is not merely redundant — it
// makes Nest construct the guard inside THIS module's injector, and
// AttendanceModule does not import CaslModule, so CaslAbilityFactory cannot be
// resolved and the whole app fails to boot with UnknownDependenciesException.
//
// The other sixteen controllers get away with the local @UseGuards only
// because their modules do import CaslModule.
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

  // ───────────────────────────────── absence excuses
  //
  // Declared above `:id` on purpose: 'excuses' would otherwise be read as an
  // attendance id and every one of these would 404 on a cast error.

  @ApiOperation({
    summary: "Absences the signed-in student's family has not explained yet",
    description:
      'Two weeks back, not today only: a child off sick for three days is ' +
      'answered once, and the other two days must still be there to answer.',
  })
  @Get('me/excuse/pending')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async pendingExcuses(@CurrentUser() user: any) {
    return await this.attendanceService.pendingExcuses(user);
  }

  @ApiOperation({
    summary: 'Attach a medical note, and get back the path to send with the excuse',
  })
  @Post('me/excuse/attachment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file', multerExcuseConfig))
  @HttpCode(HttpStatus.OK)
  async uploadExcuseAttachment(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('لم يُرفق ملف');
    return {
      status: true,
      message: 'تم رفع المرفق',
      data: { attachment: `/uploads/absence-excuses/${file.filename}` },
    };
  }

  @ApiOperation({
    summary: "The family's account of an absence",
    description:
      'Written once. An explanation a manager has already read and acted on ' +
      'cannot be quietly rewritten afterwards.',
  })
  @ApiResponse({ status: 403, description: 'The record belongs to another student' })
  @ApiResponse({ status: 409, description: 'An excuse was already sent for this day' })
  @Post('me/excuse')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async submitExcuse(@CurrentUser() user: any, @Body() dto: SubmitAbsenceExcuseDto) {
    return await this.attendanceService.submitExcuse(user, dto);
  }

  @ApiOperation({
    summary: "The school's queue of excuses, pending by default",
  })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'accepted', 'rejected', 'missing'] })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'classId', required: false, type: String })
  @Get('excuses')
  @CheckAbilities({ action: 'read', subject: 'Attendance' })
  @HttpCode(HttpStatus.OK)
  async listExcuses(@Query() query: any) {
    const { page, limit, ...filters } = query;
    return await this.attendanceService.listExcuses(
      filters as ListAbsenceExcusesDto,
      { page, limit } as PaginationDto,
    );
  }

  @ApiOperation({
    summary: 'Accept or refuse an excuse — the family is told either way',
  })
  @ApiResponse({ status: 409, description: 'Already reviewed' })
  @Patch('excuses/:id/review')
  @CheckAbilities({ action: 'update', subject: 'Attendance' })
  @HttpCode(HttpStatus.OK)
  async reviewExcuse(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ReviewAbsenceExcuseDto,
  ) {
    return await this.attendanceService.reviewExcuse(id, user, dto);
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
