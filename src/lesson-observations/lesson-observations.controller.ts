import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LessonObservationsService } from './lesson-observations.service';
import {
  ExplainObservationDto,
  ListObservationsDto,
  RecordObservationDto,
  ReviewObservationDto,
} from './dto/lesson-observation.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';

const ROUND_WALKERS = [
  Role.OWNER,
  Role.MANAGER,
  Role.SUPERVISOR,
  Role.SUPER_ADMIN,
] as const;

@ApiTags('lesson-observations')
@ApiBearerAuth()
@Controller('lesson-observations')
export class LessonObservationsController {
  constructor(private readonly service: LessonObservationsService) {}

  /*
   * The teacher's own routes are literal paths and sit above ':id/...' — 'me'
   * read as an id would 404 on a cast error.
   */

  @ApiOperation({
    summary: 'Observations about the signed-in teacher that they have not answered',
  })
  @Get('me/pending')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  async minePending(@CurrentUser() user: any) {
    return this.service.minePending(user);
  }

  @ApiOperation({
    summary: "The day's lessons, each with whatever was written about it",
    description:
      'One call: the supervisor is walking a corridor on a phone, and a screen ' +
      'that needs three requests to say whether this room was visited is a ' +
      'screen they stop using. Cover is included, because a lesson the office ' +
      'already reassigned is not an absence to report.',
  })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD, defaults to today' })
  @Get('round')
  @Roles(...ROUND_WALKERS)
  @CheckAbilities({ action: 'read', subject: 'Duty' })
  @HttpCode(HttpStatus.OK)
  async round(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.service.round(date, user);
  }

  @ApiOperation({
    summary: 'The log of latenesses and absences seen on the round',
    description:
      "status defaults to late+absent. 'unexplained' is one the teacher has " +
      "not answered at all; 'pending' is an answer awaiting a ruling.",
  })
  @ApiQuery({ name: 'status', required: false, enum: ['late', 'absent', 'present', 'pending', 'unexplained'] })
  @ApiQuery({ name: 'teacherId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @Get()
  @Roles(...ROUND_WALKERS)
  @CheckAbilities({ action: 'read', subject: 'Duty' })
  @HttpCode(HttpStatus.OK)
  async list(@Query() query: any) {
    const { page, limit, ...filters } = query;
    return this.service.list(
      filters as ListObservationsDto,
      Number(page) || 1,
      Math.min(Number(limit) || 30, 100),
    );
  }

  @ApiOperation({
    summary: 'Record one classroom, or correct what was recorded',
    description:
      'Upserts on (lesson, day): two supervisors walking the same corridor ' +
      'must not notify the teacher twice or count one absence as two. Frozen ' +
      'once the teacher has answered.',
  })
  @ApiResponse({ status: 400, description: 'The lesson is not taught on that day' })
  @ApiResponse({ status: 409, description: 'The teacher has already answered it' })
  @Post()
  @Roles(...ROUND_WALKERS)
  @CheckAbilities({ action: 'create', subject: 'Duty' })
  @HttpCode(HttpStatus.OK)
  async record(@Body() dto: RecordObservationDto, @CurrentUser() user: any) {
    return this.service.record(dto, user);
  }

  @ApiOperation({ summary: "The teacher's account of what was written down" })
  @ApiResponse({ status: 403, description: 'The observation is about another teacher' })
  @ApiResponse({ status: 409, description: 'Already answered' })
  @Post(':id/reason')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  async explain(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ExplainObservationDto,
  ) {
    return this.service.explain(id, user, dto);
  }

  @ApiOperation({
    summary: 'Accept or refuse that account — the teacher is told either way',
  })
  @Patch(':id/review')
  @Roles(...ROUND_WALKERS)
  @CheckAbilities({ action: 'update', subject: 'Duty' })
  @HttpCode(HttpStatus.OK)
  async review(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ReviewObservationDto,
  ) {
    return this.service.review(id, user, dto);
  }
}
