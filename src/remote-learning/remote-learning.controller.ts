import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MongoIdPipe } from '../common/pipes/mongo-id.pipe';
import { RemoteLearningService } from './remote-learning.service';
import { CreateRemoteDayDto, LessonLinkDto, MeetingUrlDto } from './dto';


@Controller('remote-learning')
@ApiTags('Remote learning')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiBearerAuth()
export class RemoteLearningController {
  constructor(private readonly service: RemoteLearningService) {}

  @Get('days')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remote days declared by the school' })
  listDays() {
    return this.service.listDays();
  }

  @Post('days')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Declare remote days (whole school or some stages); notifies students and teachers' })
  createDay(@Body() dto: CreateRemoteDayDto, @CurrentUser() user: any) {
    return this.service.createDay(dto, user);
  }

  @Delete('days/:id')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Cancel remote days' })
  deleteDay(@Param('id', MongoIdPipe) id: string) {
    return this.service.deleteDay(id);
  }

  @Get('teachers')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: "Teachers' standing meeting links" })
  teacherLinks() {
    return this.service.teacherLinks();
  }

  @Put('teachers/:id/meeting-url')
  @Roles(Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: "Set a teacher's standing meeting link" })
  setTeacherLink(@Param('id', MongoIdPipe) id: string, @Body() dto: MeetingUrlDto) {
    return this.service.setTeacherMeetingUrl(id, dto.meetingUrl);
  }

  @Get('me/meeting-url')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: "The signed-in teacher's standing meeting link" })
  myLink(@CurrentUser() user: any) {
    return this.service.myMeetingUrl(user);
  }

  @Put('me/meeting-url')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'The signed-in teacher sets their standing meeting link' })
  setMyLink(@Body() dto: MeetingUrlDto, @CurrentUser() user: any) {
    return this.service.setMyMeetingUrl(user, dto.meetingUrl);
  }

  @Put('lessons/:lectureId/link')
  @Roles(Role.TEACHER, Role.OWNER, Role.MANAGER, Role.SUPERVISOR, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'A link for one lesson on one day (empty removes it)' })
  setLessonLink(@Param('lectureId', MongoIdPipe) lectureId: string, @Body() dto: LessonLinkDto, @CurrentUser() user: any) {
    return this.service.setLessonLink(user, lectureId, dto.date, dto.joinUrl);
  }

  @Get('me/lessons')
  @Roles(Role.TEACHER, Role.STUDENT)
  @ApiOperation({ summary: "The signed-in teacher's or student's remote lessons on a day, with join links" })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD; today by default' })
  myLessons(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.service.lessonsOn(user, date);
  }
}
