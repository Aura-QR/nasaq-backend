import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { GradeRegisterService } from './grade-register.service';
import { SaveRegisterMarksDto } from './dto/save-register-marks.dto';

/**
 * السجل السنوي — ministry grading template only.
 *
 * Teachers reach the classes they teach (checked in the service); the
 * permissions screen governs the assistant (MANAGER) through gradeRegister.
 */
@Controller('grade-register')
@ApiTags('Grade register')
@ApiBearerAuth()
export class GradeRegisterController {
  constructor(private readonly service: GradeRegisterService) {}

  @Get('options')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'read', subject: 'GradeRegister', roles: ['MANAGER'] })
  @ApiOperation({ summary: 'The classes and subjects the caller can open, for the pickers' })
  options(@CurrentUser() user: any) {
    return this.service.options(user);
  }

  @Get('sheet')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'read', subject: 'GradeRegister', roles: ['MANAGER'] })
  @ApiOperation({ summary: 'One class and subject: computed rows, typed marks, status' })
  getSheet(
    @Query('classId') classId: string,
    @Query('subjectOfferingId') subjectOfferingId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.getSheet(classId, subjectOfferingId, user);
  }

  @Put('sheet')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'update', subject: 'GradeRegister', roles: ['MANAGER'] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save paper final marks and extra written items' })
  saveMarks(@Body() dto: SaveRegisterMarksDto, @CurrentUser() user: any) {
    return this.service.saveMarks(dto, user);
  }

  @Post('sheet/approve')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'update', subject: 'GradeRegister', roles: ['MANAGER'] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve: freeze the rows and lock the subject tracking' })
  approve(
    @Body('classId') classId: string,
    @Body('subjectOfferingId') subjectOfferingId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.approve(classId, subjectOfferingId, user);
  }

  @Post('sheet/reopen')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Undo an approval' })
  reopen(
    @Body('classId') classId: string,
    @Body('subjectOfferingId') subjectOfferingId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.reopen(classId, subjectOfferingId, user);
  }

  @Get('class-report')
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @CheckAbilities({ action: 'read', subject: 'GradeRegister', roles: ['MANAGER'] })
  @ApiOperation({ summary: "Every subject's total for one class, one term" })
  classReport(
    @Query('classId') classId: string,
    @Query('termId') termId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.classReport(classId, termId, user);
  }

  @Get('me')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: "The student's own approved register, by subject" })
  mine(@Query('termId') termId: string | undefined, @CurrentUser() user: any) {
    return this.service.myRegister(user, termId);
  }
}
