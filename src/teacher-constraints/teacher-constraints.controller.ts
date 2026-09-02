import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TeacherConstraintsService } from './teacher-constraints.service';
import { SetTeacherConstraintDto } from './dto/set-teacher-constraint.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@ApiTags('teacher-constraints')
@ApiBearerAuth()
@Controller('teacher-constraints')
export class TeacherConstraintsController {
  constructor(private readonly service: TeacherConstraintsService) {}

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set when a teacher may not be scheduled, for one term',
    description:
      'Replaces the whole set for that teacher and term — send everything, ' +
      'and an empty array to clear it. A day with no slots named is the whole ' +
      'day; naming slots is how "not the last period" is expressed.\n\n' +
      'The generator treats these as rules, not preferences: a blocked cell ' +
      'is never offered, however well it would otherwise score.',
  })
  set(@Body() dto: SetTeacherConstraintDto) {
    return this.service.set(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Every teacher's constraints for a term" })
  @ApiQuery({ name: 'termId', required: true })
  listByTerm(@Query('termId') termId: string) {
    return this.service.listByTerm(termId);
  }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':teacherId/:termId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear a teacher's constraints for a term" })
  remove(@Param('teacherId') teacherId: string, @Param('termId') termId: string) {
    return this.service.remove(teacherId, termId);
  }
}
