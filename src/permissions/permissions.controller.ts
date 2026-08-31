import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { EntityPermission } from './default-permissions';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

/**
 * OWNER and SUPERVISOR are absent on purpose: both authenticate with ['*'],
 * so a stored row for them is never read and editing one would change nothing.
 */
const EDITABLE_ROLES = ['MANAGER', 'TEACHER', 'STUDENT'];

@ApiTags('Permissions')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Get all permissions defaults for the school' })
  async findAll(@CurrentUser() user: any, @CurrentSchool() schoolId: string) {
    if (user.role !== 'OWNER' && user.role !== 'SUPERVISOR') {
      throw new ForbiddenException('صلاحيات غير كافية، هذه العملية خاصة بمالك أو مشرف المدرسة فقط');
    }
    
    // MANAGER was missing here, so the permissions screen had no row to show
    // for it — which is part of why every manager ended up with a hand-written
    // list instead.
    const manager = await this.permissionsService.getPermissionsByRole('MANAGER', schoolId);
    const teacher = await this.permissionsService.getPermissionsByRole('TEACHER', schoolId);
    const student = await this.permissionsService.getPermissionsByRole('STUDENT', schoolId);

    return {
      MANAGER: manager,
      TEACHER: teacher,
      STUDENT: student,
    };
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Patch(':role')
  @ApiOperation({ summary: 'Replace one role\'s permissions for this school (Owner/Supervisor only)' })
  async updateRole(
    @CurrentUser() user: any,
    @CurrentSchool() schoolId: string,
    @Param('role') role: string,
    @Body() body: { permissions: Record<string, EntityPermission> },
  ) {
    if (user.role !== 'OWNER' && user.role !== 'SUPERVISOR') {
      throw new ForbiddenException('صلاحيات غير كافية، هذه العملية خاصة بمالك أو مشرف المدرسة فقط');
    }

    const normalized = String(role).toUpperCase();
    if (!EDITABLE_ROLES.includes(normalized)) {
      throw new BadRequestException(
        `الأدوار القابلة للتعديل هي: ${EDITABLE_ROLES.join(', ')} — المالك والمشرف يملكان صلاحيات كاملة بحكم دورهما`,
      );
    }

    if (!body?.permissions || typeof body.permissions !== 'object') {
      throw new BadRequestException('permissions مطلوب ويجب أن يكون كائناً');
    }

    return this.permissionsService.updateRolePermissions(normalized, body.permissions, schoolId);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @Post('sync-financial')
  @ApiOperation({ summary: 'Sync financial permissions for all roles (Owner/Supervisor only)' })
  syncFinancialPermissions(@CurrentUser() user: any, @CurrentSchool() schoolId: string) {
    if (user.role !== 'OWNER' && user.role !== 'SUPERVISOR') {
      throw new ForbiddenException('صلاحيات غير كافية، هذه العملية خاصة بمالك أو مشرف المدرسة فقط');
    }
    return this.permissionsService.syncFinancialPermissions(schoolId);
  }
}
