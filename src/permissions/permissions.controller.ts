import { Controller, Get, Post, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@ApiTags('Permissions')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all permissions defaults for the school' })
  async findAll(@CurrentUser() user: any, @CurrentSchool() schoolId: string) {
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('صلاحيات غير كافية، هذه العملية خاصة بمالك المدرسة فقط');
    }
    
    const teacher = await this.permissionsService.getPermissionsByRole('TEACHER', schoolId);
    const student = await this.permissionsService.getPermissionsByRole('STUDENT', schoolId);
    
    return {
      TEACHER: teacher,
      STUDENT: student,
    };
  }

  @Post('sync-financial')
  @ApiOperation({ summary: 'Sync financial permissions for all roles (Owner only)' })
  syncFinancialPermissions(@CurrentUser() user: any, @CurrentSchool() schoolId: string) {
    if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
      throw new ForbiddenException('صلاحيات غير كافية، هذه العملية خاصة بمالك المدرسة فقط');
    }
    return this.permissionsService.syncFinancialPermissions(schoolId);
  }
}
