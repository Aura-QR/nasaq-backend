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
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DutyService } from './duty.service';
import {
  CreateLeaveRequestDto,
  ReviewLeaveRequestDto,
} from './dto/leave-request.dto';
import { SetDutySupervisorsDto } from './dto/duty-supervisor.dto';
import { CreateSubstitutionDto } from './dto/substitution.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

const STAFF = [
  Role.OWNER,
  Role.SUPERVISOR,
  Role.MANAGER,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('Duty — cover, supervision and leave')
@ApiBearerAuth()
@Controller('duty')
export class DutyController {
  constructor(private readonly dutyService: DutyService) {}

  // ───────────────────────────────────────────────── the cover board

  @ApiOperation({
    summary: "Everything needing cover today, and who is free to take it",
    description:
      'Starts from the timetable, crosses off whoever is absent or on ' +
      'approved leave, and for each uncovered lecture lists the teachers who ' +
      'are at school and free in that exact slot — specialists in the subject ' +
      'first. Read only.',
  })
  @ApiResponse({ status: 200, description: 'Cover board for the day' })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'YYYY-MM-DD. Defaults to today.',
  })
  @Roles(...STAFF)
  @Get('coverage')
  @HttpCode(HttpStatus.OK)
  async coverage(@CurrentUser() user: any, @Query('date') date?: string) {
    return await this.dutyService.getCoverage(date, user);
  }

  // ────────────────────────────────────────────────── substitutions

  @ApiOperation({ summary: 'Assign a teacher to cover one lecture for one day' })
  @ApiResponse({ status: 201, description: 'Cover assigned' })
  @ApiResponse({
    status: 400,
    description: 'The substitute is busy in that slot, or the lecture is not on that weekday',
  })
  @Roles(...STAFF)
  @Post('substitutions')
  @HttpCode(HttpStatus.CREATED)
  async assignCover(
    @Body() dto: CreateSubstitutionDto,
    @CurrentUser() user: any,
  ) {
    return await this.dutyService.createSubstitution(dto, user);
  }

  @ApiOperation({
    summary: "Cover assignments for a day",
    description:
      'A TEACHER caller always gets their own, whatever teacherId they send — ' +
      'this is the "what am I covering today" screen.',
  })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @Get('substitutions')
  @HttpCode(HttpStatus.OK)
  async listCover(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return await this.dutyService.listSubstitutions({ date, teacherId }, user);
  }

  @ApiOperation({ summary: 'Remove a cover assignment' })
  @Roles(...STAFF)
  @Delete('substitutions/:id')
  @HttpCode(HttpStatus.OK)
  async removeCover(@Param('id') id: string) {
    return await this.dutyService.removeSubstitution(id);
  }

  // ─────────────────────────────────────────────── duty supervisors

  @ApiOperation({
    summary: "Set the day's supervisors",
    description:
      'Replaces the day entirely, so an empty array clears it. Most days have ' +
      'one supervisor, some have two.',
  })
  @Roles(...STAFF)
  @Put('supervisors')
  @HttpCode(HttpStatus.OK)
  async setSupervisors(
    @Body() dto: SetDutySupervisorsDto,
    @CurrentUser() user: any,
  ) {
    return await this.dutyService.setSupervisors(dto, user);
  }

  @ApiOperation({ summary: 'Supervisors on duty, for a day or a range' })
  @ApiQuery({ name: 'date', required: false, description: 'Defaults to today' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @Get('supervisors')
  @HttpCode(HttpStatus.OK)
  async getSupervisors(
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return await this.dutyService.getSupervisors({ date, from, to });
  }

  // ───────────────────────────────────────────────── leave requests

  @ApiOperation({
    summary: 'Ask to leave before the end of the day (استئذان)',
    description:
      'A teacher files for themselves. Staff may file on behalf by sending ' +
      'teacherId. A second request for the same day edits the first, because ' +
      'a day has one answer.',
  })
  @ApiResponse({ status: 201, description: 'Request filed' })
  @Post('leave-requests')
  @HttpCode(HttpStatus.CREATED)
  async createLeave(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() user: any,
  ) {
    return await this.dutyService.createLeaveRequest(dto, user);
  }

  @ApiOperation({
    summary: 'Leave requests',
    description: 'A TEACHER caller always gets only their own.',
  })
  @ApiQuery({ name: 'date', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'approved', 'rejected'],
  })
  @ApiQuery({ name: 'teacherId', required: false })
  @Get('leave-requests')
  @HttpCode(HttpStatus.OK)
  async listLeave(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return await this.dutyService.listLeaveRequests(
      { date, from, to, status, teacherId },
      user,
    );
  }

  @ApiOperation({ summary: 'Approve or reject a leave request' })
  @ApiResponse({ status: 403, description: 'A teacher cannot review their own' })
  @Roles(...STAFF)
  @Patch('leave-requests/:id/review')
  @HttpCode(HttpStatus.OK)
  async reviewLeave(
    @Param('id') id: string,
    @Body() dto: ReviewLeaveRequestDto,
    @CurrentUser() user: any,
  ) {
    return await this.dutyService.reviewLeaveRequest(id, dto, user);
  }

  @ApiOperation({
    summary: 'Cancel a leave request',
    description:
      'A teacher may cancel their own while it is still pending; staff may ' +
      'cancel any.',
  })
  @Delete('leave-requests/:id')
  @HttpCode(HttpStatus.OK)
  async cancelLeave(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.dutyService.cancelLeaveRequest(id, user);
  }
}
