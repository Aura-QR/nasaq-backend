import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../auth/enums/role.enum';
import { CheckAbilities } from '../../casl/decorators/check-abilities.decorator';
import { ResidencyDocumentsService } from './residency-documents.service';
import { ReviewResidencyDocumentDto, SubmitResidencyDocumentDto } from './residency-document.dto';
import { multerResidencyConfig } from './multer-residency.config';

const ADMINS = [Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN] as [Role, ...Role[]];

@Controller()
@ApiTags('Residency documents')
@ApiBearerAuth()
export class ResidencyDocumentsController {
  constructor(private readonly service: ResidencyDocumentsService) {}

  // ── The student (the family signs in as the child) ──────────────────────

  @ApiOperation({ summary: "The signed-in student's residency documents" })
  @Roles(Role.STUDENT)
  @Get('students/me/residency-documents')
  async mine(@CurrentUser() user: any) {
    return this.service.listForStudent(user.userId);
  }

  @ApiOperation({ summary: 'Upload a residency document (multipart: files[] up to 2 + fields); waits for review' })
  @ApiConsumes('multipart/form-data')
  @Roles(Role.STUDENT)
  @Post('students/me/residency-documents')
  @UseInterceptors(FilesInterceptor('files', 2, multerResidencyConfig))
  @HttpCode(HttpStatus.CREATED)
  async submitMine(@CurrentUser() user: any, @Body() dto: SubmitResidencyDocumentDto, @UploadedFiles() files: any[]) {
    return this.service.submitByStudent(user, dto, files);
  }

  // ── The school ───────────────────────────────────────────────────────────

  @ApiOperation({ summary: "A student's residency documents, newest first, and the current one" })
  @Roles(...ADMINS)
  @CheckAbilities({ action: 'read', subject: 'Student', roles: [Role.MANAGER] })
  @Get('students/:id/residency-documents')
  async forStudent(@Param('id') id: string) {
    return this.service.listForStudent(id);
  }

  @ApiOperation({ summary: "Upload a student's residency document as the school; approved as filed" })
  @ApiConsumes('multipart/form-data')
  @Roles(...ADMINS)
  @CheckAbilities({ action: 'update', subject: 'Student' })
  @Post('students/:id/residency-documents')
  @UseInterceptors(FilesInterceptor('files', 2, multerResidencyConfig))
  @HttpCode(HttpStatus.CREATED)
  async submitForStudent(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitResidencyDocumentDto,
    @UploadedFiles() files: any[],
  ) {
    return this.service.submitByAdmin(id, user, dto, files);
  }

  @ApiOperation({ summary: 'The review queue (default: pending), with student name and class' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'approved', 'rejected'] })
  @Roles(...ADMINS)
  @CheckAbilities({ action: 'read', subject: 'Student', roles: [Role.MANAGER] })
  @Get('residency-documents')
  async list(@Query('status') status?: string) {
    return this.service.list(status || 'pending');
  }

  @ApiOperation({ summary: 'Approve or reject a pending document (a rejection needs a reason)' })
  @Roles(...ADMINS)
  @CheckAbilities({ action: 'update', subject: 'Student' })
  @Patch('residency-documents/:documentId/review')
  async review(@Param('documentId') documentId: string, @CurrentUser() user: any, @Body() dto: ReviewResidencyDocumentDto) {
    return this.service.review(documentId, user, dto);
  }

  @ApiOperation({ summary: 'Delete a document and its files' })
  @Roles(...ADMINS)
  @CheckAbilities({ action: 'update', subject: 'Student' })
  @Delete('residency-documents/:documentId')
  async remove(@Param('documentId') documentId: string) {
    return this.service.remove(documentId);
  }

  @ApiOperation({ summary: 'A document file, for the school or the student it belongs to' })
  @Roles(...ADMINS, Role.STUDENT)
  @CheckAbilities({ action: 'read', subject: 'Student', roles: [Role.MANAGER] })
  @Get('residency-documents/:documentId/files/:index')
  async file(
    @Param('documentId') documentId: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const file = await this.service.filePath(documentId, index, user);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName || 'document')}`);
    res.sendFile(file.path);
  }
}
