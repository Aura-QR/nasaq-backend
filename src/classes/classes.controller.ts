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
import { ClassesService } from './classes.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('classes')
@Controller('classes')
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @ApiOperation({ summary: 'Create a new class' })
  @ApiResponse({ status: 201, description: 'Class created successfully' })
  @ApiResponse({ status: 409, description: 'Class name already exists in academic year' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
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
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post('copy-from/:targetYearId/:sourceYearId')
  @HttpCode(HttpStatus.CREATED)
  async copyFromYear(
    @Param('targetYearId') targetYearId: string,
    @Param('sourceYearId') sourceYearId: string,
  ) {
    return await this.classesService.copyClassesFromYear(targetYearId, sourceYearId);
  }

  // MUST stay above @Get(':id'). Nest matches in declaration order, so a literal
  // path declared after the wildcard is swallowed by it: the request becomes
  // findOne('teacher') and fails the ObjectId cast with
  // 400 "صيغة معرف class غير صحيحة" — a message that blames the caller for a
  // route that does not exist. GET /classes/my-classes hit exactly that.
  @ApiOperation({
    summary: "The classes the authenticated teacher teaches, derived from their timetable",
  })
  @ApiQuery({ name: 'termId', required: false, description: 'Defaults to the active term' })
  @ApiResponse({ status: 200, description: 'Classes fetched successfully' })
  @ApiBearerAuth()
  @Get('teacher/me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async findMyTeacherClasses(
    @CurrentUser() user: any,
    @Query('termId') termId?: string,
  ) {
    // The id comes from the token, never from the query, so one teacher cannot
    // enumerate another's classes.
    return await this.classesService.findMyTeacherClasses(user.userId, termId);
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
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
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
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  async toggleActive(@Param('id') id: string) {
    return await this.classesService.toggleActive(id);
  }

  @ApiOperation({ summary: 'Delete class' })
  @ApiResponse({ status: 200, description: 'Class deleted successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.classesService.remove(id);
  }
}