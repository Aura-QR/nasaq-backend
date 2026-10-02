import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentSchool } from 'src/tenancy/decorators/current-school.decorator';
import { StaffMembersService } from './staff-members.service';
import { CreateStaffMemberDto, UpdateStaffMemberDto } from './dto/staff-member.dto';

// Authentication, tenant isolation and RolesGuard are global APP_GUARDs.
// The same people who manage administrators manage service staff.
@Controller('staff-members')
@Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
@ApiTags('Staff Members')
@ApiBearerAuth('school-jwt')
export class StaffMembersController {
  constructor(private readonly service: StaffMembersService) {}

  @Get()
  @ApiOperation({ summary: 'موظفو الخدمات — حراس وعمال وسائقون' })
  list() {
    return this.service.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'إضافة موظف خدمات — يدخل لتسجيل حضوره فقط' })
  create(@CurrentSchool() schoolId: string, @Body() dto: CreateStaffMemberDto) {
    return this.service.create(schoolId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'تعديل بيانات موظف خدمات أو تعيين كلمة مرور جديدة' })
  update(@Param('id') id: string, @Body() dto: UpdateStaffMemberDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'حذف موظف خدمات — سجلات حضوره السابقة تبقى' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
