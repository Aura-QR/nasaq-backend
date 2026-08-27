import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Req,
  Param,  
  Patch,
  Delete,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PreparationService } from './preparation.service';
import { CreatePreparationDto } from './dto/create-preparation.dto';
import { UpdatePreparationDto } from './dto/update-preparation.dto';
import { ReviewPreparationDto } from './dto/review-preparation.dto';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiQuery,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CheckAbilities } from '../casl/decorators/check-abilities.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { multerConfig } from './config/multer.config';

@Controller('preparation')
@ApiTags('Preparation')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiBearerAuth()
export class PreparationController {
  constructor(private readonly preparationService: PreparationService) {}

  @ApiOperation({ summary: 'Create a new preparation' })
  @ApiResponse({ status: 201, description: 'Preparation created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Lecture not found' })
  @Post()
  @CheckAbilities({ action: 'create', subject: 'Preparation' })
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        lecture: {
          type: 'string',
          description: 'Lecture ID',
          example: '507f1f77bcf86cd799439011',
        },
        lessonTitle: {
          type: 'string',
          description: 'Lesson title, free text',
          example: 'حل المعادلات من الدرجة الأولى',
        },
        weekOf: {
          type: 'string',
          description:
            'Any date inside the target week (YYYY-MM-DD). Defaults to the current week.',
          example: '2026-08-22',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Preparation files (max 10 files, 20MB each)',
        },
      },
      required: ['lecture'],
    },
  })
  async create(
    @Body() createPreparationDto: CreatePreparationDto,
    @CurrentUser() user: any,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return await this.preparationService.create(
      createPreparationDto,
      user.userId,
      req,
      files,
      user,
    );
  }

  @ApiOperation({ summary: 'Get all preparations or filter with query params' })
  @ApiResponse({
    status: 200,
    description: 'Preparations fetched successfully',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
  })
  @ApiQuery({
    name: 'lecture',
    required: false,
    type: String,
    description: 'Filter by lecture ID (alias: lectureId)',
  })
  @ApiQuery({
    name: 'teacherId',
    required: false,
    type: String,
    description: 'Filter by teacher (alias of submittedBy)',
  })
  @ApiQuery({ name: 'classId', required: false, type: String })
  @ApiQuery({ name: 'termId', required: false, type: String })
  @ApiQuery({ name: 'subject', required: false, type: String })
  @ApiQuery({
    name: 'weekOf',
    required: false,
    type: String,
    description: 'Any date inside the week (YYYY-MM-DD)',
  })
  @ApiQuery({ name: 'weekFrom', required: false, type: String })
  @ApiQuery({ name: 'weekTo', required: false, type: String })
  @ApiQuery({
    name: 'lessonTitle',
    required: false,
    type: String,
    description: 'Partial, case-insensitive match on the lesson title',
  })
  @ApiQuery({
    name: 'reviewStatus',
    required: false,
    enum: ['pending', 'approved', 'needs_revision'],
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: "Partial match on the TEACHER's name (not the lesson title)",
  })
  @Get()
  @CheckAbilities({ action: 'read', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser() user: any,
    @Query() queryParams: any,
    @Req() req: any,
  ) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.preparationService.filtering(
      filters,
      pagination,
      user,
      req,
    );
  }

  @ApiOperation({
    summary: "A teacher's whole week, submitted preparations and gaps alike",
    description:
      'Starts from the timetable rather than from what was uploaded, so every ' +
      'lecture in the week comes back with its preparation or with null. ' +
      'Omit teacherId for one summary row per teacher. A TEACHER caller always ' +
      'gets their own week, whatever teacherId they send.',
  })
  @ApiResponse({ status: 200, description: 'Weekly review data' })
  @ApiQuery({
    name: 'weekOf',
    required: false,
    type: String,
    description:
      'Any date inside the week (YYYY-MM-DD). Defaults to the current week.',
  })
  @ApiQuery({ name: 'teacherId', required: false, type: String })
  @ApiQuery({ name: 'termId', required: false, type: String })
  @Get('weekly')
  @CheckAbilities({ action: 'read', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async weekly(
    @CurrentUser() user: any,
    @Query('weekOf') weekOf: string,
    @Query('teacherId') teacherId: string,
    @Query('termId') termId: string,
    @Req() req: any,
  ) {
    return await this.preparationService.getWeekly(
      { weekOf, teacherId, termId },
      user,
      req,
    );
  }

  @ApiOperation({ summary: 'Get a single preparation by ID' })
  @ApiResponse({ status: 200, description: 'Preparation fetched successfully' })
  @ApiResponse({ status: 404, description: 'Preparation not found' })
  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string, @Req() req: any) {
    return await this.preparationService.findOne(id, req);
  }

  @ApiOperation({ summary: 'Update a preparation by ID' })
  @ApiResponse({ status: 200, description: 'Preparation updated successfully' })
  @ApiResponse({ status: 404, description: 'Preparation not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not authorized to update this preparation',
  })
  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        lecture: {
          type: 'string',
          description: 'Lecture ID',
          example: '507f1f77bcf86cd799439011',
        },
        lessonTitle: {
          type: 'string',
          description: 'Lesson title, free text',
          example: 'حل المعادلات من الدرجة الأولى',
        },
        weekOf: {
          type: 'string',
          description:
            'Any date inside the target week (YYYY-MM-DD). Defaults to the current week.',
          example: '2026-08-22',
        },
        files: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
          description: 'Preparation files (max 10 files, 20MB each)',
        },
      },
      required: [],
    },
  })
  async update(
    @Param('id') id: string,
    @Body() updatePreparationDto: UpdatePreparationDto,
    @CurrentUser() user: any,
    @Req() req: any,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return await this.preparationService.update(
      id,
      updatePreparationDto,
      req,
      files,
      user,
    );
  }

  @ApiOperation({ summary: 'Record the outcome of reviewing a preparation' })
  @ApiResponse({ status: 200, description: 'Review saved' })
  @ApiResponse({ status: 403, description: 'A teacher cannot review their own' })
  @ApiResponse({ status: 404, description: 'Preparation not found' })
  @Patch(':id/review')
  @CheckAbilities({ action: 'update', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewPreparationDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return await this.preparationService.review(id, dto, user, req);
  }

  @ApiOperation({ summary: 'Delete a preparation by ID' })
  @ApiResponse({ status: 200, description: 'Preparation deleted successfully' })
  @ApiResponse({ status: 404, description: 'Preparation not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not authorized to delete this preparation',
  })
  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.preparationService.delete(id, user);
  }

  @ApiOperation({ summary: 'Add files to an existing preparation' })
  @ApiResponse({ status: 200, description: 'Files added successfully' })
  @ApiResponse({ status: 404, description: 'Preparation not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not authorized to add files to this preparation',
  })
  @Post(':id/files')
  @CheckAbilities({ action: 'update', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files', 10, multerConfig))
  @ApiConsumes('multipart/form-data')
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
    return await this.preparationService.addFiles(id, req, files, user);
  }

  @ApiOperation({ summary: 'Remove a file from a preparation' })
  @ApiResponse({ status: 200, description: 'File removed successfully' })
  @ApiResponse({ status: 404, description: 'Preparation or file not found' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not authorized to remove files from this preparation',
  })
  @Delete(':id/files/:filename')
  @CheckAbilities({ action: 'update', subject: 'Preparation' })
  @HttpCode(HttpStatus.OK)
  async removeFile(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    return await this.preparationService.removeFile(id, filename, user, req);
  }
}
