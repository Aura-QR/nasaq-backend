import { Controller, Get, Post, Body, Patch, Delete, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { CreateAcademicYearDto } from './dto/create-academic-year.dto';
import { UpdateAcademicYearDto } from './dto/update-academic-year.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('academic-years')
@Controller('academic-years')
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new academic year' })
  @ApiResponse({ status: 201, description: 'The academic year has been successfully created.' })
  @ApiResponse({ status: 409, description: 'Academic year with the same name already exists.' })
  create(@Body() createAcademicYearDto: CreateAcademicYearDto) {
    return this.academicYearsService.create(createAcademicYearDto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all academic years' })
  @ApiResponse({ status: 200, description: 'List of all academic years.' })
  findAll() {
    return this.academicYearsService.findAll();
  }

  @Get('active')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the active academic year' })
  @ApiResponse({ status: 200, description: 'The active academic year.' })
  @ApiResponse({ status: 404, description: 'Active academic year not found.' })
  findActive() {
    return this.academicYearsService.findActive();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get an academic year by id' })
  @ApiResponse({ status: 200, description: 'The found academic year.' })
  @ApiResponse({ status: 404, description: 'Academic year not found.' })
  findOne(@Param('id') id: string) {
    return this.academicYearsService.findOne(id);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update an academic year' })
  @ApiResponse({ status: 200, description: 'The academic year has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Academic year not found.' })
  update(@Param('id') id: string, @Body() updateAcademicYearDto: UpdateAcademicYearDto) {
    return this.academicYearsService.update(id, updateAcademicYearDto);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id/setup-step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update setup step for an academic year' })
  @ApiResponse({ status: 200, description: 'The setup step has been successfully updated.' })
  @ApiResponse({ status: 404, description: 'Academic year not found.' })
  updateSetupStep(@Param('id') id: string, @Body('step') step: number) {
    return this.academicYearsService.updateSetupStep(id, step);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete an academic year created by mistake',
    description:
      'Refuses while any student is enrolled in the year or in one of its ' +
      'classes, and refuses to remove the last year. Empty classes, their ' +
      'lectures and the terms go with it. Deleting the active year promotes ' +
      'the most recent remaining one so the school is never left without.',
  })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 409, description: 'Students are enrolled' })
  remove(@Param('id') id: string) {
    return this.academicYearsService.remove(id);
  }
}
