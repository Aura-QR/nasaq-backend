import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerExcuseConfig } from '../attendance/config/multer-excuse.config';
import { StaffAbsenceExcuseService } from './staff-absence-excuse.service';
import {
  ListStaffAbsenceExcusesDto,
  MarkStaffPresentDto,
  RecordStaffAbsenceExcuseDto,
  ReviewStaffAbsenceExcuseDto,
  SubmitStaffAbsenceExcuseDto,
} from './dto/staff-absence-excuse.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { Role } from '../auth/enums/role.enum';
import {
  CreateManualStaffAttendanceDto,
  QueryStaffAttendanceDto,
  StaffAbsenceQueryDto,
  StaffDirectoryQueryDto,
  StaffLocationDto,
  SummaryStaffAttendanceDto,
  UpdateStaffAttendanceDto,
} from './dto/staff-attendance.dto';
import {
  ListStaffLateReasonsDto,
  ReviewStaffLateReasonDto,
  SubmitStaffLateReasonDto,
} from './dto/staff-late-reason.dto';
import {
  CreateStaffLeaveRequestDto,
  ListStaffLeaveRequestsDto,
  ReviewStaffLeaveRequestDto,
} from './dto/staff-leave-request.dto';
import { StaffAttendanceService } from './staff-attendance.service';
import { extractClientIp } from '../attendance/attendance.utils';

// Authentication, tenant isolation and RolesGuard are global APP_GUARDs.
@Controller('staff-attendance')
@Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
@ApiTags('Staff Attendance')
@ApiBearerAuth('school-jwt')
export class StaffAttendanceController {
  constructor(
    private readonly service: StaffAttendanceService,
    private readonly absenceExcuses: StaffAbsenceExcuseService,
  ) {}

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('check-in')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manager/supervisor self check-in' })
  checkIn(
    @CurrentUser() user: any,
    @Body() dto: StaffLocationDto,
    @Req() req: any,
  ) {
    return this.service.checkIn(user, dto, req);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('check-out')
  @HttpCode(200)
  @ApiOperation({ summary: 'Manager/supervisor self check-out' })
  checkOut(
    @CurrentUser() user: any,
    @Body() dto: StaffLocationDto,
    @Req() req: any,
  ) {
    return this.service.checkOut(user, dto, req);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Get('me')
  @ApiOperation({
    summary: 'Own attendance history; staffId and role filters are ignored',
  })
  getMine(@CurrentUser() user: any, @Query() query: QueryStaffAttendanceDto) {
    return this.service.getMyAttendance(user, query);
  }

  /*
   * The lateness a staff member has not explained yet.
   *
   * Minutes on their own are an accusation with no reply: the office saw a
   * number and the person had nowhere to say why, which the teacher side has
   * had an answer to since the lateness queue was built.
   */
  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Get('me/late-reason/pending')
  @ApiOperation({ summary: "Today's unexplained lateness, if there is one" })
  pendingLateReason(@CurrentUser() user: any) {
    return this.service.pendingLateReason(user);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('me/late-reason')
  @HttpCode(200)
  @ApiOperation({ summary: 'Explain your own lateness. Written once.' })
  submitLateReason(
    @CurrentUser() user: any,
    @Body() dto: SubmitStaffLateReasonDto,
  ) {
    return this.service.submitLateReason(user, dto);
  }

  /**
   * The review queue. `status=missing` is the fourth state: a lateness nobody
   * explained matches none of the verdicts, so without it the rows that need
   * a nudge are the ones no filter can show.
   */
  @Get('late-reasons')
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Staff latenesses by verdict, including missing' })
  listLateReasons(
    @CurrentUser() user: any,
    @Query() query: ListStaffLateReasonsDto,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listLateReasons(
      user,
      query,
      Number(page) || 1,
      Math.min(Number(limit) || 20, 100),
    );
  }

  @Patch('late-reasons/:id/review')
  @CheckAbilities({ action: 'update', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Accept or refuse it — the person is told either way' })
  reviewLateReason(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReviewStaffLateReasonDto,
  ) {
    return this.service.reviewLateReason(user, id, dto);
  }

  // ─────────────────────────────────────────────── الاستئذان
  //
  // Its own routes, not the duty module's: a supervisor has no lectures, so
  // none of the cover machinery applies and a notice about this must not send
  // a manager to a cover screen with nothing on it.

  // OWNER was missing here, so the owner filing for somebody who phoned in
  // got 403 «Forbidden resource» before the service could say anything.
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('leave-requests')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Ask to leave before the end of the day. The owner, or a manager with ' +
      'the staff-attendance permission, may file on behalf by sending staffId ' +
      '— that one is approved at once. A second request for the same day ' +
      'edits the first.',
  })
  createLeave(
    @CurrentUser() user: any,
    @Body() dto: CreateStaffLeaveRequestDto,
  ) {
    return this.service.createLeave(user, dto);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Get('leave-requests')
  @ApiOperation({ summary: 'A SUPERVISOR caller always gets only their own' })
  listLeaves(
    @CurrentUser() user: any,
    @Query() query: ListStaffLeaveRequestsDto,
  ) {
    return this.service.listLeaves(user, query);
  }

  @Patch('leave-requests/:id/review')
  @CheckAbilities({ action: 'update', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Approve or refuse — the person is told either way' })
  reviewLeave(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReviewStaffLeaveRequestDto,
  ) {
    return this.service.reviewLeave(user, id, dto);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
  @Delete('leave-requests/:id')
  @ApiOperation({ summary: 'Withdraw a request that has not been decided yet' })
  cancelLeave(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.cancelLeave(user, id);
  }

  // ──────────────────────────────────────── أعذار الغياب
  //
  // The teacher feature's staff twin. The person's own routes are role-based
  // (me/…); the school's are under the StaffAttendance permission, like the
  // late-reason queue. Declared above every ':id' route.

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Get('me/absence-excuse/pending')
  @ApiOperation({ summary: 'My absent days with no excuse yet (default 14 days back)' })
  myPendingAbsences(@CurrentUser() user: any, @Query('days') days?: string) {
    const parsed = Number(days);
    const window = Number.isInteger(parsed) && parsed >= 1 && parsed <= 60 ? parsed : 14;
    return this.absenceExcuses.pendingDays(user, window);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Get('me/absence-excuses')
  @ApiOperation({ summary: 'My excuses and what became of each, newest first' })
  myAbsenceExcuses(@CurrentUser() user: any) {
    return this.absenceExcuses.mine(user);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('me/absence-excuse')
  @HttpCode(200)
  @ApiOperation({ summary: 'Explain a day I was absent — goes to the school for review' })
  submitAbsenceExcuse(@CurrentUser() user: any, @Body() dto: SubmitStaffAbsenceExcuseDto) {
    return this.absenceExcuses.submit(user, dto);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.STAFF)
  @Post('absence-excuse/attachment')
  @UseInterceptors(FileInterceptor('file', multerExcuseConfig))
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload a medical note; returns the path to send with the excuse' })
  uploadAbsenceAttachment(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('لم يُرفق ملف');
    return {
      status: true,
      message: 'تم رفع المرفق',
      data: { attachment: `/uploads/absence-excuses/${file.filename}` },
    };
  }

  @Post('absence-excuses')
  @CheckAbilities({ action: 'create', subject: 'StaffAttendance' })
  @HttpCode(201)
  @ApiOperation({
    summary: 'Enter an excuse on somebody\'s behalf (e.g. a cleaner with no phone)',
    description: 'Recorded as accepted. Not for yourself.',
  })
  recordAbsenceExcuse(@CurrentUser() user: any, @Body() dto: RecordStaffAbsenceExcuseDto) {
    return this.absenceExcuses.record(user, dto);
  }

  @Get('absence-excuses')
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Staff absence excuses — pending by default' })
  listAbsenceExcuses(@CurrentUser() user: any, @Query() query: ListStaffAbsenceExcusesDto) {
    return this.absenceExcuses.list(user, query);
  }

  @Patch('absence-excuses/:id/review')
  @CheckAbilities({ action: 'update', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Accept or refuse — the person is told either way' })
  reviewAbsenceExcuse(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ReviewStaffAbsenceExcuseDto,
  ) {
    return this.absenceExcuses.review(user, id, dto);
  }

  @Patch('absence-excuses/:id/mark-present')
  @CheckAbilities({ action: 'update', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'They were not absent — record their attendance and close the excuse' })
  markAbsenceExcusePresent(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: MarkStaffPresentDto,
  ) {
    return this.absenceExcuses.markPresent(user, id, dto.checkInAt, dto.note);
  }

  @Get('staff')
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({
    summary: 'Eligible managers and supervisors for manual entry and filters',
  })
  staff(@CurrentUser() user: any, @Query() query: StaffDirectoryQueryDto) {
    return this.service.listStaff(user, query);
  }

  @Get('detect-ip')
  @ApiOperation({
    summary: 'Detect public client IP for school network settings',
  })
  detectIp(@Req() req: any) {
    return { status: true, data: { ip: extractClientIp(req) } };
  }

  @Get('absent')
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({
    summary: 'Managers/supervisors with no record on a school working day',
  })
  absent(@CurrentUser() user: any, @Query() query: StaffAbsenceQueryDto) {
    return this.service.findAbsent(user, query);
  }

  @Get('summary')
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({
    summary: 'Attendance totals per staff member for an inclusive period',
  })
  summary(@CurrentUser() user: any, @Query() query: SummaryStaffAttendanceDto) {
    return this.service.getSummary(user, query);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Paginated staff attendance records' })
  findAll(@CurrentUser() user: any, @Query() query: QueryStaffAttendanceDto) {
    return this.service.findAll(user, query);
  }

  @Post()
  @CheckAbilities({ action: 'create', subject: 'StaffAttendance' })
  @ApiOperation({
    summary: 'Record manual attendance for a manager or supervisor',
  })
  create(
    @CurrentUser() user: any,
    @Body() dto: CreateManualStaffAttendanceDto,
  ) {
    return this.service.createManual(user, dto);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Correct staff attendance times or notes' })
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateStaffAttendanceDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'StaffAttendance' })
  @ApiOperation({ summary: 'Delete a staff attendance record' })
  delete(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.delete(user, id);
  }
}
