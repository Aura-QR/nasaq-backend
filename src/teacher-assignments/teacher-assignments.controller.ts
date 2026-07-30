import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('teacher-assignments')
@Controller('teacher-assignments')
export class TeacherAssignmentsController {
  constructor(private readonly teacherAssignmentsService: TeacherAssignmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a teacher to a subject offering' })
  @ApiResponse({ status: 201, description: 'Teacher assigned successfully' })
  @ApiResponse({ status: 409, description: 'Teacher already assigned to this offering' })
  async create(@Body() dto: CreateTeacherAssignmentDto) {
    return await this.teacherAssignmentsService.create(dto);
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

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove teacher assignment' })
  async remove(@Param('id') id: string) {
    return await this.teacherAssignmentsService.remove(id);
  }
}
