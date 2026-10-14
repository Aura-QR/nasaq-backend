import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { MongoIdPipe } from '../common/pipes/mongo-id.pipe';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementEditorGuard } from './announcement-editor.guard';
import { announcementMulterConfig } from './config/multer.config';
import { UploadTooLargeFilter } from './config/upload-too-large.filter';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  ReorderAnnouncementsDto,
  SetAnnouncementStatusDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

/**
 * شاشة الإعلانات — the carousel at the top of every home screen.
 *
 * The feed is for everyone with a home screen; managing the slides is for the
 * school's staff, and the permissions screen governs a manager through
 * `announcements`. Authentication, tenant isolation, roles and abilities are
 * all global APP_GUARDs.
 */
@Controller('announcements')
@Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER)
@ApiTags('Announcements')
@ApiBearerAuth('school-jwt')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  // Literal paths first: anything declared after @Get(':id') is swallowed by it.

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.TEACHER, Role.STUDENT)
  @Get('feed')
  @ApiOperation({
    summary: "The slides showing now for the caller's role, in carousel order",
    description: 'Switched on, inside their dates, and meant for this audience. No management fields.',
  })
  feed(@CurrentUser() user: any) {
    return this.service.feed(user);
  }

  @Post('uploads')
  @UseGuards(AnnouncementEditorGuard)
  @UseInterceptors(FileInterceptor('file', announcementMulterConfig))
  @UseFilters(UploadTooLargeFilter)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Upload a slide's image; returns the url to send with the slide",
    description: 'JPG, PNG or WEBP up to 5 MB. Videos are not uploaded here: a video slide links to YouTube or the like.',
  })
  upload(@CurrentUser() user: any, @UploadedFile() file?: Express.Multer.File) {
    return this.service.acceptUpload(user, file);
  }

  @Put('order')
  @CheckAbilities({ action: 'update', subject: 'Announcement' })
  @ApiOperation({ summary: 'Reorder the carousel; unlisted slides keep their order after the listed ones' })
  reorder(@CurrentUser() user: any, @Body() dto: ReorderAnnouncementsDto) {
    return this.service.reorder(user, dto.ids);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Announcement' })
  @ApiOperation({ summary: 'Every slide, with its status (live, scheduled, expired, paused)' })
  list(@Query() query: ListAnnouncementsQueryDto) {
    return this.service.list(query);
  }

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Announcement' })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a slide: honor_roll, program or video' })
  create(@CurrentUser() user: any, @Body() dto: CreateAnnouncementDto) {
    return this.service.create(user, dto);
  }

  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Announcement' })
  @ApiOperation({ summary: 'One slide, for the edit screen' })
  findOne(@Param('id', MongoIdPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  @CheckAbilities({ action: 'update', subject: 'Announcement' })
  @ApiOperation({ summary: 'Switch a slide on or off' })
  setStatus(@Param('id', MongoIdPipe) id: string, @Body() dto: SetAnnouncementStatusDto) {
    return this.service.setStatus(id, dto.isActive);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Announcement' })
  @ApiOperation({ summary: 'Edit a slide; send only what changes' })
  update(@CurrentUser() user: any, @Param('id', MongoIdPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Announcement' })
  @ApiOperation({ summary: 'Delete a slide and its uploaded image' })
  remove(@Param('id', MongoIdPipe) id: string) {
    return this.service.remove(id);
  }
}
