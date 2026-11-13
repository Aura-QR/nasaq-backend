import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { ClassRecordService } from './class-record.service';

/**
 * سجل الحضور والغياب وملخص الفصل. Teachers see the classes they teach
 * (checked in the service); the permissions screen governs MANAGER through
 * the attendance subject.
 */
@Controller('class-record')
@ApiTags('Class record')
@ApiBearerAuth()
export class ClassRecordController {
  constructor(private readonly service: ClassRecordService) {}

  @Get('attendance')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'read', subject: 'Attendance', roles: ['MANAGER'] })
  @ApiOperation({ summary: 'Students × school days: ح / غ / ع, totals and attendance rate. Defaults to the current term up to today.' })
  @ApiQuery({ name: 'classId', required: true })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  attendance(@Query('classId') classId: string, @Query('from') from: string, @Query('to') to: string, @CurrentUser() user: any) {
    return this.service.attendanceRegister({ classId, from, to }, user);
  }

  @Get('summary')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'read', subject: 'Attendance', roles: ['MANAGER'] })
  @ApiOperation({ summary: 'ملخص الفصل for the current term: attendance rate, students over حد الغياب, grade average and pass rate' })
  @ApiQuery({ name: 'classId', required: true })
  summary(@Query('classId') classId: string, @CurrentUser() user: any) {
    return this.service.classSummary(classId, user);
  }
}
