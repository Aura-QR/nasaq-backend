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
