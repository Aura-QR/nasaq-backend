import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus,
} from '@nestjs/common';
import { StagesService } from './stages.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('stages')
@Controller('stages')
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new stage' })
  @ApiResponse({ status: 201, description: 'Stage created successfully' })
  @ApiResponse({ status: 409, description: 'Stage name conflict' })
  create(@Body() createStageDto: CreateStageDto) {
    return this.stagesService.create(createStageDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all stages' })
  @ApiResponse({ status: 200, description: 'List of all stages' })
  findAll() {
    return this.stagesService.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get stage by id' })
  @ApiResponse({ status: 200, description: 'Stage details' })
  @ApiResponse({ status: 404, description: 'Stage not found' })
  findOne(@Param('id') id: string) {
    return this.stagesService.findOne(id);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a stage' })
  @ApiResponse({ status: 200, description: 'Stage updated successfully' })
  @ApiResponse({ status: 404, description: 'Stage not found' })
  update(@Param('id') id: string, @Body() updateStageDto: UpdateStageDto) {
    return this.stagesService.update(id, updateStageDto);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a stage' })
  @ApiResponse({ status: 200, description: 'Stage deleted successfully' })
  @ApiResponse({ status: 404, description: 'Stage not found' })
  remove(@Param('id') id: string) {
    return this.stagesService.remove(id);
  }
}
