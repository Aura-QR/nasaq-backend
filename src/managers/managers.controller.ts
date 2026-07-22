import { Controller, UseGuards, Post, Body, Param, Patch, Delete, Get, ForbiddenException, Req, Query } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { ManagersService } from './managers.service';
import { CreateManagerDto, UpdateManagerPermissionsDto } from './dto/managers.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('managers')
export class ManagersController {
  constructor(private readonly managersService: ManagersService) {}

  private checkOwner(req: any) {
    if (req.user?.role !== 'OWNER') {
      throw new ForbiddenException('صلاحيات إدارة المدراء خاصة بمالك المدرسة فقط');
    }
  }

  @Post()
  async create(@Req() req: any, @CurrentSchool() schoolId: string, @Body() dto: CreateManagerDto) {
    this.checkOwner(req);
    return this.managersService.createManagerAdmin(schoolId, dto);
  }

  @Patch('promote/:teacherId')
  async promote(
    @Req() req: any,
    @Param('teacherId') teacherId: string,
    @Body() dto: UpdateManagerPermissionsDto,
  ) {
    this.checkOwner(req);
    return this.managersService.promoteTeacher(teacherId, dto.permissions);
  }

  @Patch('demote/:teacherId')
  async demote(@Req() req: any, @Param('teacherId') teacherId: string) {
    this.checkOwner(req);
    return this.managersService.demoteTeacher(teacherId);
  }

  @Patch(':id/permissions')
  async updatePermissions(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateManagerPermissionsDto,
    @Query('type') type: 'admin' | 'teacher',
  ) {
    this.checkOwner(req);
    return this.managersService.updatePermissions(id, type, dto.permissions);
  }

  @Get()
  async findAll(@Req() req: any) {
    this.checkOwner(req);
    return this.managersService.findAllManagers();
  }

  @Delete(':id')
  async remove(
    @Req() req: any,
    @Param('id') id: string,
    @Query('type') type: 'admin' | 'teacher',
  ) {
    this.checkOwner(req);
    return this.managersService.removeManager(id, type);
  }
}
