import { Controller, Get, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TenantGuard } from 'src/tenancy/guards/tenant.guard';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { PlatformOnly } from 'src/tenancy/decorators/platform-only.decorator';
import { DashboardsService } from './dashboards.service';

@ApiTags('Dashboards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboardsService: DashboardsService) {}

  @Get('owner')
  @ApiOperation({ summary: 'Get single-school metrics for School Owner' })
  async getOwnerDashboard(@Req() req: any, @CurrentSchool() schoolId: string) {
    if (req.user?.role !== 'OWNER' && req.user?.role !== 'SUPERVISOR') {
      throw new ForbiddenException('صلاحيات لوحة تحكم المالك خاصة بمالك أو مشرف المدرسة فقط');
    }
    return this.dashboardsService.getOwnerDashboard(schoolId);
  }

  @Get('manager')
  @ApiOperation({ summary: 'Get permission-filtered metrics for Manager' })
  async getManagerDashboard(@Req() req: any) {
    const userPermissions = req.user?.permissions || [];
    return this.dashboardsService.getManagerDashboard(userPermissions);
  }

  @Get('super-admin')
  @PlatformOnly()
  @ApiOperation({ summary: 'Get cross-tenant platform analytics for Super Admin' })
  async getSuperAdminDashboard() {
    return this.dashboardsService.getSuperAdminDashboard();
  }
}
