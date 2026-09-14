import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { AssignJobTitleDto, CreateJobTitleDto, UpdateJobTitleDto } from './job-title.dto';
import { JobTitlesService } from './job-titles.service';

/**
 * Job titles decide what each assistant can do, so only the people who can
 * already change the permissions screen may manage them: OWNER and SUPERVISOR.
 * SUPER_ADMIN passes @Roles to reach a school's routes but has no school of its
 * own here, and is refused like PermissionsController refuses it.
 */
@ApiTags('Job titles')
@ApiBearerAuth()
@Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
@Controller('job-titles')
export class JobTitlesController {
  constructor(private readonly service: JobTitlesService) {}

  private ownerOrSupervisor(user: any) {
    if (user?.role !== 'OWNER' && user?.role !== 'SUPERVISOR') {
      throw new ForbiddenException('المسميات الوظيفية خاصة بمالك المدرسة أو مديرها');
    }
  }

  @Get()
  @ApiOperation({ summary: "The school's job titles, with how many assistants carry each" })
  list(@CurrentUser() user: any, @CurrentSchool() schoolId: string) {
    this.ownerOrSupervisor(user);
    return this.service.list(schoolId);
  }

  @Get('templates')
  @ApiOperation({ summary: 'Starter templates (not stored): finance, student affairs, teacher affairs, academic' })
  templates(@CurrentUser() user: any) {
    this.ownerOrSupervisor(user);
    return this.service.templates();
  }

  @Post()
  @ApiOperation({ summary: 'Create a job title, from a template or blank' })
  create(@CurrentUser() user: any, @CurrentSchool() schoolId: string, @Body() dto: CreateJobTitleDto) {
    this.ownerOrSupervisor(user);
    return this.service.create(schoolId, dto, user?.userId);
  }

  @Patch('assignments/:accountId')
  @ApiOperation({ summary: "Give an assistant a job title, or clear it with jobTitleId: null" })
  assign(
    @CurrentUser() user: any,
    @CurrentSchool() schoolId: string,
    @Param('accountId') accountId: string,
    @Body() dto: AssignJobTitleDto,
  ) {
    this.ownerOrSupervisor(user);
    return this.service.assign(schoolId, accountId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a job title or replace its permissions' })
  update(
    @CurrentUser() user: any,
    @CurrentSchool() schoolId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobTitleDto,
  ) {
    this.ownerOrSupervisor(user);
    return this.service.update(schoolId, id, dto, user?.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a job title — refused while any assistant carries it' })
  remove(@CurrentUser() user: any, @CurrentSchool() schoolId: string, @Param('id') id: string) {
    this.ownerOrSupervisor(user);
    return this.service.remove(schoolId, id);
  }
}
