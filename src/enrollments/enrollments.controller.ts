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
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';
import { BulkPromoteDto } from './dto/bulk-promote.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('enrollments')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly enrollmentsService: EnrollmentsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a student in a class for an academic year' })
  @ApiResponse({ status: 201, description: 'Student enrolled successfully' })
  @ApiResponse({ status: 400, description: 'Class full or bad request' })
  @ApiResponse({ status: 409, description: 'Student already enrolled in this academic year' })
  async enroll(@Body() createEnrollmentDto: CreateEnrollmentDto) {
    return await this.enrollmentsService.enroll(createEnrollmentDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Find enrollments by academic year and class' })
  @ApiQuery({ name: 'academicYearId', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async findByYearAndClass(
    @Query('academicYearId') academicYearId?: string,
    @Query('classId') classId?: string,
    @Query('status') status?: string,
  ) {
    return await this.enrollmentsService.findByYearAndClass(academicYearId, classId, status);
  }

  @Get('promotion-preview/:targetAcademicYearId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get promotion preview data for Wizard Step 5' })
  @ApiQuery({ name: 'previousAcademicYearId', required: false })
  async getPromotionPreview(
    @Param('targetAcademicYearId') targetAcademicYearId: string,
    @Query('previousAcademicYearId') previousAcademicYearId?: string,
  ) {
    return await this.enrollmentsService.getPromotionPreview(
      targetAcademicYearId,
      previousAcademicYearId,
    );
  }

  @Post('bulk-promote/:targetAcademicYearId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Execute bulk promotion for Wizard Step 5' })
  @ApiResponse({ status: 201, description: 'Bulk promotion completed' })
  async bulkPromote(
    @Param('targetAcademicYearId') targetAcademicYearId: string,
    @Body() dto: BulkPromoteDto,
  ) {
    return await this.enrollmentsService.bulkPromote(targetAcademicYearId, dto);
  }

  @Get('student/:studentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all enrollments for a specific student' })
  async findByStudent(@Param('studentId') studentId: string) {
    return await this.enrollmentsService.findByStudent(studentId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unenroll student (soft withdraw)' })
  @ApiQuery({ name: 'reason', required: false, enum: ['withdrawn', 'transferred', 'graduated'] })
  async unenroll(
    @Param('id') id: string,
    @Query('reason') reason?: string,
  ) {
    return await this.enrollmentsService.unenroll(id, reason);
  }
}
