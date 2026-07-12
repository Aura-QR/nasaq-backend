import { Controller, Get, Post, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';

@ApiTags('Permissions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all permissions stored in the database' })
  findAll(@CurrentUser() user: any) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can perform this action');
    }
    return this.permissionsService.findAll();
  }

  @Post('sync-financial')
  @ApiOperation({ summary: 'Sync financial permissions for all roles (Admin only)' })
  syncFinancialPermissions(@CurrentUser() user: any) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can perform this action');
    }
    return this.permissionsService.syncFinancialPermissions();
  }
}
