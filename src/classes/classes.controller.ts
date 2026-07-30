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
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';

@ApiTags('classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Create a new class' })
  @ApiResponse({ status: 201, description: 'Class created successfully' })
  @ApiResponse({ status: 409, description: 'Class name already exists in academic year' })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createClassDto: CreateClassDto) {
    return await this.classesService.create(createClassDto);
  }

  @ApiOperation({ summary: 'Get all classes, optionally filtered by academic year or grade level' })
  @ApiResponse({ status: 200, description: 'Classes fetched successfully' })
  @ApiQuery({ name: 'academicYearId', required: false })
  @ApiQuery({ name: 'gradeLevelId', required: false })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(
    @Query('academicYearId') academicYearId?: string,
    @Query('gradeLevelId') gradeLevelId?: string,
  ) {
    return await this.classesService.findAll(academicYearId, gradeLevelId);
  }

  @ApiOperation({ summary: 'Get summary list of classes' })
  @ApiResponse({ status: 200, description: 'List of classes fetched successfully' })
  @ApiQuery({ name: 'academicYearId', required: false })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list(@Query('academicYearId') academicYearId?: string) {
    return await this.classesService.list(academicYearId);
  }

  @ApiOperation({ summary: 'Copy classes from a previous academic year (Wizard Step 4)' })
  @ApiResponse({ status: 201, description: 'Classes copied successfully' })
  @ApiResponse({ status: 404, description: 'Source year has no classes' })
  @ApiResponse({ status: 409, description: 'Target year already has classes' })
  @Post('copy-from/:targetYearId/:sourceYearId')
  @HttpCode(HttpStatus.CREATED)
  async copyFromYear(
    @Param('targetYearId') targetYearId: string,
    @Param('sourceYearId') sourceYearId: string,
  ) {
    return await this.classesService.copyClassesFromYear(targetYearId, sourceYearId);
  }

  @ApiOperation({ summary: 'Get class by ID' })
  @ApiResponse({ status: 200, description: 'Class fetched successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.classesService.findOne(id);
  }

  @ApiOperation({ summary: 'Update class' })
  @ApiResponse({ status: 200, description: 'Class updated successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateClassDto: UpdateClassDto,
  ) {
    return await this.classesService.update(id, updateClassDto);
  }

  @ApiOperation({ summary: 'Toggle active status of class' })
  @ApiResponse({ status: 200, description: 'Active status toggled successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  async toggleActive(@Param('id') id: string) {
    return await this.classesService.toggleActive(id);
  }

  @ApiOperation({ summary: 'Delete class' })
  @ApiResponse({ status: 200, description: 'Class deleted successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.classesService.remove(id);
  }
}