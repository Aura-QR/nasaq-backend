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
} from '@nestjs/common';
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
  constructor(private readonly service: StaffAttendanceService) {}

  @Roles(Role.MANAGER, Role.SUPERVISOR)
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

  @Roles(Role.MANAGER, Role.SUPERVISOR)
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

  @Roles(Role.MANAGER, Role.SUPERVISOR)
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
  @Roles(Role.MANAGER, Role.SUPERVISOR)
  @Get('me/late-reason/pending')
  @ApiOperation({ summary: "Today's unexplained lateness, if there is one" })
  pendingLateReason(@CurrentUser() user: any) {
    return this.service.pendingLateReason(user);
  }

  @Roles(Role.MANAGER, Role.SUPERVISOR)
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

  @Roles(Role.MANAGER, Role.SUPERVISOR)
  @Post('leave-requests')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Ask to leave before the end of the day. A manager may file on behalf ' +
      'by sending staffId; a second request for the same day edits the first.',
  })
  createLeave(
    @CurrentUser() user: any,
    @Body() dto: CreateStaffLeaveRequestDto,
  ) {
    return this.service.createLeave(user, dto);
  }

  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR)
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
