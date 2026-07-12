import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  Get,
  Query,
  Param,
  Res,
  Delete,
  UseGuards,
  Req,
  Patch,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiParam, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { multerConfig } from './config/multer.config';
import { multerSubmissionConfig } from './config/multer-submission.config';
import { AbilitiesGuard } from 'src/casl/guards/abilities.guard';
import { CheckAbilities } from 'src/casl/decorators/check-abilities.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('projects')
@Controller('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AbilitiesGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @CheckAbilities({ action: 'create', subject: 'Project' })
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        classIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of class IDs',
        },
        subjectId: {
          type: 'string',
          description: 'Subject ID',
        },
        academicYear: {
          type: 'string',
          description: 'Academic year (e.g., 2024-2025)',
        },
        title: {
          type: 'string',
          description: 'Project title',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        dueDate: {
          type: 'string',
          format: 'date-time',
          description: 'Project due date in ISO format',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Project files (max 10 files, 20MB each)',
        },
      },
      required: ['classIds', 'subjectId', 'academicYear', 'title', 'description', 'dueDate'],
    },
  })
  create(
    @CurrentUser() user: any,
    @Body() createProjectDto: CreateProjectDto,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {

    return this.projectsService.create(createProjectDto, req, files, user);
  }

  @Get()
  @CheckAbilities({ action: 'read', subject: 'Project' })
  findAll(@CurrentUser() user: any, @Query() queryParams: any, @Req() req: any){
    const { page, limit, ...filters } = queryParams;
    const pagination = { page, limit };
    return this.projectsService.filtering(filters, req, pagination, user)
  }

  @Get('teacher/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get projects created by the authenticated teacher' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'academicYear', required: false, type: String })
  @ApiQuery({ name: 'classIds', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['upcoming', 'overdue'] })
  @HttpCode(HttpStatus.OK)
  async getMyTeacherProjects(@CurrentUser() user: any, @Query() queryParams: any, @Req() req: any) {
    const { page, limit, ...filters } = queryParams;
    return this.projectsService.getTeacherProjects(user.userId, filters, { page, limit }, req);
  }

  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get projects for the authenticated student (with filter + pagination)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'subjectId', required: false, type: String })
  @ApiQuery({ name: 'academicYear', required: false, type: String })
  @ApiQuery({ name: 'gradesCriteriaId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['upcoming', 'overdue'], description: 'Filter by due date status' })
  async getMyProjects(@CurrentUser() user: any, @Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    return this.projectsService.getMyProjects(user.userId, filters, { page, limit });
  }

  @Delete('deleteAll')
  @ApiOperation({ summary: 'Delete all projects (Admin only)' })
  deleteAll(){
    console.log('deleting all projects')
    return this.projectsService.deleteAll();
  }
  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Project' })
  @ApiOperation({ summary: 'Get a single project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  findOne(@Param('id') id: string, @Req() req: any, @CurrentUser() user: any) {
    return this.projectsService.findOne(id, req, user);
  }

  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Download project files as ZIP — students can only download projects assigned to their class' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async downloadFiles(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ): Promise<void> {
    return this.projectsService.downloadProjectFiles(id, user, res);
  }

  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Project' })
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update a project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        classIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of class IDs',
        },
        subjectId: {
          type: 'string',
          description: 'Subject ID',
        },
        academicYear: {
          type: 'string',
          description: 'Academic year (e.g., 2024-2025)',
        },
        title: {
          type: 'string',
          description: 'Project title',
        },
        description: {
          type: 'string',
          description: 'Project description',
        },
        dueDate: {
          type: 'string',
          format: 'date-time',
          description: 'Project due date in ISO format',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Project files (max 10 files, 20MB each)',
        },
      },
    },
  })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() updateProjectDto: UpdateProjectDto,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.projectsService.update(id, updateProjectDto, req, files, user);
  }

  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Project' })
  @ApiOperation({ summary: 'Delete a project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  delete(@Param('id') id: string, @CurrentUser() user: any){
    return this.projectsService.delete(id, user)
  }

  @Post(':id/files')
  @CheckAbilities({ action: 'update', subject: 'Project' })
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add files to an existing project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Files to add (max 10 files, 20MB each)',
        },
      },
      required: ['files'],
    },
  })
  async addFiles(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return await this.projectsService.addFiles(id, req, files, user);
  }

  @Delete(':id/files/:filename')
  @CheckAbilities({ action: 'update', subject: 'Project' })
  @ApiOperation({ summary: 'Remove a file from a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiParam({ name: 'filename', description: 'Filename to remove' })
  async removeFile(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return await this.projectsService.removeFile(id, filename, user, req);
  }

  @Get('submissions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Teacher — get all student submissions for a specific subject + class' })
  @ApiQuery({ name: 'subjectId', required: true, type: String })
  @ApiQuery({ name: 'classId', required: true, type: String })
  @HttpCode(HttpStatus.OK)
  async listSubmissionsBySubjectAndClass(
    @CurrentUser() user: any,
    @Query('subjectId') subjectId: string,
    @Query('classId') classId: string,
    @Req() req: any,
  ) {
    return this.projectsService.listSubmissionsBySubjectAndClass(user.userId, subjectId, classId, req);
  }

  // ─── Student Submission Endpoints ─────────────────────────────────────────

  @Post(':projectId/submit')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('files', 10, multerSubmissionConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Student uploads submission files for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['files'],
    },
  })
  @HttpCode(HttpStatus.OK)
  async submitFiles(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.projectsService.submitFiles(projectId, user.userId, files, req);
  }

  @Delete(':projectId/submit/files/:filename')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Student removes a file from their submission' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'filename', description: 'Filename to remove' })
  @HttpCode(HttpStatus.OK)
  async deleteSubmissionFile(
    @Param('projectId') projectId: string,
    @Param('filename') filename: string,
    @CurrentUser() user: any,
  ) {
    return this.projectsService.deleteSubmissionFile(projectId, user.userId, filename);
  }

  @Get(':projectId/my-submission')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Student views their own submission for a project" })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @HttpCode(HttpStatus.OK)
  async getMySubmission(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.projectsService.getMySubmission(projectId, user.userId, req);
  }

  @Get(':projectId/submissions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Teacher/admin lists all student submissions for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @HttpCode(HttpStatus.OK)
  async listSubmissions(
    @Param('projectId') projectId: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return this.projectsService.listSubmissions(projectId, user, req);
  }

  @Get(':projectId/submissions/:studentId/download')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Teacher downloads a student's submission as ZIP" })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'studentId', description: 'Student ID' })
  async downloadSubmission(
    @Param('projectId') projectId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    return this.projectsService.downloadSubmission(projectId, studentId, user, res);
  }

  @Patch(':projectId/submissions/:studentId/grade')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Teacher grades a student submission' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'studentId', description: 'Student ID' })
  @HttpCode(HttpStatus.OK)
  async gradeSubmission(
    @Param('projectId') projectId: string,
    @Param('studentId') studentId: string,
    @Body('achievedGrade') achievedGrade: number,
    @CurrentUser() user: any,
  ) {
    return this.projectsService.gradeSubmission(projectId, studentId, achievedGrade, user);
  }

}
