import { Controller, UseGuards, Post, Body, Param, Patch, Delete, Get, ForbiddenException, BadRequestException, Req, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { ManagersService } from './managers.service';
import { CreateManagerDto, UpdateManagerPermissionsDto } from './dto/managers.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { AdminSetPasswordDto } from '../auth/dto/admin-set-password.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';


@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('managers')
export class ManagersController {
  constructor(private readonly managersService: ManagersService) {}

  private checkOwnerOrSupervisor(req: any) {
    if (req.user?.role !== 'OWNER' && req.user?.role !== 'SUPERVISOR') {
      throw new ForbiddenException('صلاحيات إدارة المدراء خاصة بمالك أو مشرف المدرسة فقط');
    }
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Post()
  async create(@Req() req: any, @CurrentSchool() schoolId: string, @Body() dto: CreateManagerDto) {
    this.checkOwnerOrSupervisor(req);
    if (dto.role === 'SUPERVISOR' && req.user?.role !== 'OWNER') {
      throw new ForbiddenException('إنشاء مشرف جديد متاح لمالك المدرسة فقط');
    }
    return this.managersService.createManagerAdmin(schoolId, dto);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Patch('promote/:teacherId')
  async promote(
    @Req() req: any,
    @Param('teacherId') teacherId: string,
    @Body() dto: UpdateManagerPermissionsDto,
  ) {
    this.checkOwnerOrSupervisor(req);
    return this.managersService.promoteTeacher(teacherId, dto.permissions);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Patch('demote/:teacherId')
  async demote(@Req() req: any, @Param('teacherId') teacherId: string) {
    this.checkOwnerOrSupervisor(req);
    return this.managersService.demoteTeacher(teacherId);
  }

  /**
   * Gone: a manager's rights are no longer per-account.
   *
   * This route used to write a list onto one admin or one teacher. Those lists
   * are not read at login any more, so leaving it in place would accept the
   * request, return 200, and change nothing anyone could observe — the exact
   * failure mode this refactor exists to remove. It fails loudly and names its
   * replacement instead.
   */
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Patch(':id/permissions')
  async updatePermissions(@Req() req: any) {
    this.checkOwnerOrSupervisor(req);
    throw new BadRequestException(
      'صلاحيات المدير أصبحت موحّدة على مستوى المدرسة ولم تعد تُضبط لكل حساب على حدة. ' +
        'استخدم PATCH /permissions/MANAGER لتعديلها لجميع المدراء.',
    );
  }

  @Get()
  async findAll(@Req() req: any) {
    this.checkOwnerOrSupervisor(req);
    return this.managersService.findAllManagers();
  }

  @ApiOperation({
    summary: 'تعيين أو إعادة تعيين كلمة مرور مدير / مشرف / مالك',
    description:
      'OWNER يمكنه تغيير كلمة مرور MANAGER أو SUPERVISOR. ' +
      'SUPERVISOR يمكنه تغيير كلمة مرور MANAGER فقط. ' +
      'SUPER_ADMIN يمكنه تغيير كلمة مرور أي مسؤول. ' +
      'إذا لم يُرسَل password يُولَّد تلقائياً ويُعاد في الاستجابة.',
  })
  @ApiResponse({ status: 200, description: 'تم تعيين كلمة المرور' })
  @ApiResponse({ status: 403, description: 'لا تملك صلاحية تغيير كلمة مرور هذا المسؤول' })
  @ApiResponse({ status: 404, description: 'المسؤول غير موجود' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Patch(':id/password')
  @HttpCode(HttpStatus.OK)
  async setAdminPassword(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AdminSetPasswordDto,
  ) {
    this.checkOwnerOrSupervisor(req);
    return this.managersService.setAdminPassword(id, req.user?.role, body.password);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Delete(':id')
  async remove(
    @Req() req: any,
    @Param('id') id: string,
    @Query('type') type: 'admin' | 'teacher',
  ) {
    this.checkOwnerOrSupervisor(req);
    return this.managersService.removeManager(id, type, req.user?.role);
  }
}
