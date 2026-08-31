import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { LibraryService } from './library.service';
import { CreateLibraryDto } from './dto/create-library.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { ApiOperation, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('library')
@ApiTags('Library')
export class LibraryController {
  constructor(private readonly libraryService: LibraryService) {}

  @ApiOperation({ summary: 'Create a new library item' })
  @ApiResponse({ status: 201, description: 'Library item created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Subject not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createLibraryDto: CreateLibraryDto) {
    return await this.libraryService.create(createLibraryDto);
  }

  @ApiOperation({ summary: 'Get all library items or filter with query params' })
  @ApiResponse({ status: 200, description: 'Library items fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Library items not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'subjectOfferingId', required: false, type: String, description: 'Filter by SubjectOffering ID' })
  @ApiQuery({ name: 'subjectId', required: false, type: String, description: 'Filter by Subject ID' })
  @ApiQuery({ name: 'academicYearId', required: false, type: String, description: 'Filter by Academic Year ID' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.libraryService.filtering(filters, pagination);
  }

  @ApiOperation({ summary: 'Get simplified list for dropdowns' })
  @ApiResponse({ status: 200, description: 'List of library items fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'List of library items not found' })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list() {
    return await this.libraryService.list();
  }

  @ApiOperation({ summary: 'Get library items by subject ID' })
  @ApiResponse({ status: 200, description: 'Library items fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Library items not found' })
  @Get('by-subject/:subjectId')
  @HttpCode(HttpStatus.OK)
  async findBySubject(@Param('subjectId') subjectId: string) {
    return await this.libraryService.findBySubject(subjectId);
  }

  @ApiOperation({ summary: 'Get a library item by ID' })
  @ApiResponse({ status: 200, description: 'Library item fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Library item not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.libraryService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a library item' })
  @ApiResponse({ status: 200, description: 'Library item updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Library item not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateLibraryDto: UpdateLibraryDto,
  ) {
    return await this.libraryService.update(id, updateLibraryDto);
  }

  @ApiOperation({ summary: 'Delete a library item' })
  @ApiResponse({ status: 200, description: 'Library item deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Library item not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.libraryService.remove(id);
  }
}
