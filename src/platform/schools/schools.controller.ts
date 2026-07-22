import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { RegisterSchoolDto } from './dto/register-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { PlatformOnly } from 'src/tenancy/decorators/platform-only.decorator';
import { Public } from 'src/auth/decorators/public.decorator';

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

  @Get('platform/schools/:id')
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
}
