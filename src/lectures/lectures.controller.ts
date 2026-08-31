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
import { TimetableService } from './timetable.service';
import { GenerateTimetableDto } from './dto/generate-timetable.dto';
import { CreateLectureDto } from './dto/create-lecture.dto';
import { UpdateLectureDto } from './dto/update-lecture.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('Lectures')
@Controller('lectures')
export class LecturesController {
  constructor(
    private readonly lecturesService: LecturesService,
    private readonly timetableService: TimetableService,
  ) {}

  @ApiOperation({
    summary: 'Can a timetable exist for this term?',
    description:
      'Arithmetic only — nothing is generated and nothing is written. ' +
      'Compares each class\'s planned periods and each teacher\'s assigned ' +
      'load against the capacity of the school week, and names whatever does ' +
      'not fit. Run this before generating: an overloaded teacher is a ' +
      'subtraction, not a search failure.',
  })
  @ApiResponse({ status: 200, description: 'Feasibility report' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  @ApiQuery({ name: 'termId', required: true })
  @ApiQuery({
    name: 'classIds',
    required: false,
    description: 'Comma-separated. Defaults to every active class in the term.',
  })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Get('feasibility')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async feasibility(
    @CurrentUser() user: any,
    @Query('termId') termId: string,
    @Query('classIds') classIds?: string,
  ) {
    return await this.timetableService.getFeasibility(
      termId,
      user.schoolId,
      classIds ? classIds.split(',').map((id) => id.trim()).filter(Boolean) : undefined,
    );
  }

  @ApiOperation({
    summary: 'Build a timetable for the term',
    description:
      'Schedules every planned subject for every class, respecting the two ' +
      'things that cannot bend — a class cannot sit two lessons at once and a ' +
      'teacher cannot be in two rooms at once — and preferring not to stack a ' +
      "subject into one day or leave gaps in a teacher's day.\n\n" +
      'mode "preview" (the default) writes nothing and returns the proposed ' +
      'grid. onExisting "skip" (the default) leaves any class that already has ' +
      'a timetable exactly as it is.\n\n' +
      'Anything that could not be placed comes back in `problems` with the ' +
      'class, subject and teacher named. Run GET /lectures/feasibility first: ' +
      'an overloaded teacher is arithmetic, and no search can fix it.',
  })
  @ApiResponse({ status: 200, description: 'Timetable generated' })
  @ApiResponse({ status: 400, description: 'No working days, or no active classes' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('generate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async generate(
    @CurrentUser() user: any,
    @Body() dto: GenerateTimetableDto,
  ) {
    return await this.timetableService.generate(dto, user.schoolId);
  }

  @ApiOperation({ summary: 'Create a new lecture' })
  @ApiResponse({ status: 201, description: 'Lecture created successfully' })
  @ApiResponse({ status: 409, description: 'Scheduling conflict detected' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createLectureDto: CreateLectureDto) {
    return await this.lecturesService.create(createLectureDto);
  }

  @ApiOperation({ summary: 'Get all lectures or filter by termId, classId, teacherId' })
  @ApiQuery({ name: 'termId', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'dayOfWeek', required: false, description: "Lowercase, e.g. 'sunday'" })
  @ApiQuery({ name: 'slot', required: false, type: Number })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: any,
    @Query('termId') termId?: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('dayOfWeek') dayOfWeek?: string,
    @Query('slot') slot?: string,
  ) {
    // A teacher may only ever see their own timetable through this route —
    // whatever teacherId they pass is ignored.
    const effectiveTeacherId =
      user?.role === 'TEACHER' ? String(user.userId) : teacherId;
    return await this.lecturesService.findAll(
      termId,
      classId,
      effectiveTeacherId,
      dayOfWeek,
      slot,
    );
  }

  @ApiOperation({ summary: "Get the authenticated teacher's own weekly timetable" })
  @ApiQuery({ name: 'termId', required: false, description: 'Defaults to the active term' })
  @ApiResponse({ status: 200, description: 'Timetable fetched successfully' })
  @Get('teacher/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async findMyTeacherLectures(
    @CurrentUser() user: any,
    @Query('termId') termId?: string,
  ) {
    return await this.lecturesService.findMyTeacherLectures(user.userId, termId);
  }

  @ApiOperation({ summary: "Get the authenticated student's own weekly timetable" })
  @ApiQuery({ name: 'termId', required: false, description: 'Defaults to the active term' })
  @ApiResponse({ status: 200, description: 'Timetable fetched successfully' })
  @ApiResponse({ status: 400, description: 'Student is not enrolled in any class' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async findMyStudentLectures(
    @CurrentUser() user: any,
    @Query('termId') termId?: string,
  ) {
    return await this.lecturesService.findMyStudentLectures(user.userId, termId);
  }

  @ApiOperation({ summary: 'Copy schedule from a previous term/year (Wizard Step 7)' })
  @ApiResponse({ status: 201, description: 'Copy schedule preview and execution results' })
  @ApiResponse({ status: 400, description: 'Missing subject offerings or invalid request' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('copy-from/:targetYearId/:targetTermId/:sourceTermId')
  @HttpCode(HttpStatus.CREATED)
  async copySchedule(
    @Param('targetYearId') targetYearId: string,
    @Param('targetTermId') targetTermId: string,
    @Param('sourceTermId') sourceTermId: string,
  ) {
    return await this.lecturesService.copySchedule(targetYearId, targetTermId, sourceTermId);
  }

  @ApiOperation({ summary: 'Get a single lecture by ID' })
  @ApiResponse({ status: 200, description: 'Lecture retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.lecturesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update lecture' })
  @ApiResponse({ status: 200, description: 'Lecture updated successfully' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
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
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.lecturesService.remove(id);
  }
}
