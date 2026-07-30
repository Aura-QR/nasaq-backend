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
} from '@nestjs/common';
import { LecturesService } from './lectures.service';
import { CreateLectureDto } from './dto/create-lecture.dto';
import { UpdateLectureDto } from './dto/update-lecture.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';

@ApiTags('Lectures')
@Controller('lectures')
export class LecturesController {
  constructor(private readonly lecturesService: LecturesService) {}

  @ApiOperation({ summary: 'Create a new lecture' })
  @ApiResponse({ status: 201, description: 'Lecture created successfully' })
  @ApiResponse({ status: 409, description: 'Scheduling conflict detected' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createLectureDto: CreateLectureDto) {
    return await this.lecturesService.create(createLectureDto);
  }

  @ApiOperation({ summary: 'Get all lectures or filter by termId, classId, teacherId' })
  @ApiQuery({ name: 'termId', required: false })
  @ApiQuery({ name: 'classId', required: false })
  @ApiQuery({ name: 'teacherId', required: false })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query('termId') termId?: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
  ) {
    return await this.lecturesService.findAll(termId, classId, teacherId);
  }

  @ApiOperation({ summary: 'Copy schedule from a previous term/year (Wizard Step 7)' })
  @ApiResponse({ status: 201, description: 'Copy schedule preview and execution results' })
  @ApiResponse({ status: 400, description: 'Missing subject offerings or invalid request' })
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
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.lecturesService.remove(id);
  }
}
