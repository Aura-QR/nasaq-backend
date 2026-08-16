import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { RegisterSchoolDto } from './dto/register-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { UpdateSchoolSettingsDto } from './dto/update-school-settings.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { Role } from 'src/auth/enums/role.enum';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { PlatformOnly } from 'src/tenancy/decorators/platform-only.decorator';
import { Public } from 'src/auth/decorators/public.decorator';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';

@Controller()
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  @Public()
  @Post('schools/register')
  async register(@Body() registerDto: RegisterSchoolDto) {
    return this.schoolsService.register(registerDto);
  }

  @Get('platform/schools')
  @PlatformOnly()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async findAll() {
    return this.schoolsService.findAll();
  }

  @Get(['platform/schools/:id', 'schools/:id'])
  @PlatformOnly()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async findOne(@Param('id') id: string) {
    return this.schoolsService.findOne(id);
  }

  @Patch('platform/schools/:id')
  @PlatformOnly()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async update(@Param('id') id: string, @Body() updateDto: UpdateSchoolDto) {
    return this.schoolsService.update(id, updateDto);
  }

  @Patch('platform/schools/:id/suspend')
  @PlatformOnly()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async suspend(@Param('id') id: string) {
    return this.schoolsService.update(id, { isActive: false, subscriptionStatus: 'suspended' });
  }

  @Patch('platform/schools/:id/activate')
  @PlatformOnly()
  @UseGuards(JwtAuthGuard, TenantGuard)
  async activate(@Param('id') id: string) {
    return this.schoolsService.update(id, { isActive: true, subscriptionStatus: 'active' });
  }

  @Get('schools/me/settings')
  @UseGuards(JwtAuthGuard, TenantGuard)
  async getMySettings(@CurrentSchool() schoolId: string) {
    return this.schoolsService.getMySettings(schoolId);
  }

  // Admins only. This one PATCH reaches the passing grade every student in the
  // school is measured against, the active academic year, and the entire teacher
  // check-in security model — location, radius, trusted network IPs, and the
  // on/off switch. It previously carried no role check at all, so any
  // authenticated user in the tenant, a student included, could move all of it.
  //
  // RolesGuard depends only on Reflector, so attaching it here is safe. That is
  // what makes it different from AbilitiesGuard, which must never be attached
  // locally — see the note in grades-criteria.controller.ts.
  //
  // GET stays open on purpose: the teacher check-in screen reads it.
  @Patch('schools/me/settings')
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  async updateMySettings(
    @CurrentSchool() schoolId: string,
    @Body() updateSettingsDto: UpdateSchoolSettingsDto,
  ) {
    return this.schoolsService.updateMySettings(schoolId, updateSettingsDto);
  }
}
