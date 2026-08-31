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
import { GradeLevelsService } from './grade-levels.service';
import { CreateGradeLevelDto } from './dto/create-grade-level.dto';
import { UpdateGradeLevelDto } from './dto/update-grade-level.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('grade-levels')
@Controller('grade-levels')
export class GradeLevelsController {
  constructor(private readonly gradeLevelsService: GradeLevelsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new grade level' })
  @ApiResponse({ status: 201, description: 'Grade level created successfully' })
  @ApiResponse({ status: 404, description: 'Stage not found' })
  @ApiResponse({ status: 409, description: 'Grade level name already exists' })
  async create(@Body() createGradeLevelDto: CreateGradeLevelDto) {
    return await this.gradeLevelsService.create(createGradeLevelDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all grade levels, optionally filtered by stage' })
  @ApiResponse({ status: 200, description: 'Grade levels fetched successfully' })
  @ApiQuery({ name: 'stageId', required: false, description: 'Filter by stage ID' })
  async findAll(@Query('stageId') stageId?: string) {
    return await this.gradeLevelsService.findAll(stageId);
  }

  @Get('by-stage/:stageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get grade levels by stage' })
  @ApiResponse({ status: 200, description: 'Grade levels fetched successfully' })
  async findByStage(@Param('stageId') stageId: string) {
    return await this.gradeLevelsService.findByStage(stageId);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get grade level by ID' })
  @ApiResponse({ status: 200, description: 'Grade level fetched successfully' })
  @ApiResponse({ status: 404, description: 'Grade level not found' })
  async findOne(@Param('id') id: string) {
    return await this.gradeLevelsService.findOne(id);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update grade level' })
  @ApiResponse({ status: 200, description: 'Grade level updated successfully' })
  @ApiResponse({ status: 404, description: 'Grade level not found' })
  async update(
    @Param('id') id: string,
    @Body() updateGradeLevelDto: UpdateGradeLevelDto,
  ) {
    return await this.gradeLevelsService.update(id, updateGradeLevelDto);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete grade level' })
  @ApiResponse({ status: 200, description: 'Grade level deleted successfully' })
  @ApiResponse({ status: 404, description: 'Grade level not found' })
  async remove(@Param('id') id: string) {
    return await this.gradeLevelsService.remove(id);
  }
}
