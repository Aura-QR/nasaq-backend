import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { ImportAssignmentsDto } from './dto/import-assignments.dto';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('teacher-assignments')
@Controller('teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly teacherAssignmentsService: TeacherAssignmentsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a teacher to a subject offering' })
  @ApiResponse({ status: 201, description: 'Teacher assigned successfully' })
  @ApiResponse({ status: 409, description: 'Teacher already assigned to this offering' })
  async create(@Body() dto: CreateTeacherAssignmentDto) {
    return await this.teacherAssignmentsService.create(dto);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Import an assignment sheet pasted from a spreadsheet',
    description:
      'Rows of `teacher | subject | grade(s)`, which is the shape schools ' +
      'already keep this in. One row may name several grades with "+" or "/". ' +
      'Honorifics, alef spellings and spacing are folded before matching, so ' +
      '"أ/ فاطمة" and "فاطمة الدهاسي" find the same person — but a name that ' +
      'matches two people is reported rather than guessed.\n\n' +
      'dryRun defaults to true: nothing is written until you send dryRun: false.',
  })
  @ApiResponse({ status: 200, description: 'Parse report, and the writes if dryRun was false' })
  async importAssignments(@Body() dto: ImportAssignmentsDto) {
    return await this.teacherAssignmentsService.importAssignments(dto);
  }

  // Declared above the two by-* routes purely for readability; they are literal
  // paths so there is no wildcard here to shadow them.
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List teacher assignments, optionally filtered' })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'subjectOfferingId', required: false })
  @ApiQuery({ name: 'termId', required: false })
  @ApiQuery({
    name: 'classId',
    required: false,
    description: 'Only assignments pinned to this class',
  })
  @ApiResponse({ status: 200, description: 'Assignments fetched successfully' })
  async findAll(
    @Query('teacherId') teacherId?: string,
    @Query('subjectOfferingId') subjectOfferingId?: string,
    @Query('termId') termId?: string,
    @Query('classId') classId?: string,
  ) {
    return await this.teacherAssignmentsService.findAll({
      teacherId,
      subjectOfferingId,
      termId,
      classId,
    });
  }

  @Get('by-offering/:subjectOfferingId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get teacher assignments for a subject offering' })
  async findByOffering(@Param('subjectOfferingId') subjectOfferingId: string) {
    return await this.teacherAssignmentsService.findByOffering(subjectOfferingId);
  }

  @Get('by-teacher/:teacherId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get subject offerings assigned to a teacher' })
  async findByTeacher(@Param('teacherId') teacherId: string) {
    return await this.teacherAssignmentsService.findByTeacher(teacherId);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove teacher assignment' })
  async remove(@Param('id') id: string) {
    return await this.teacherAssignmentsService.remove(id);
  }
}
