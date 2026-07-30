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
} from '@nestjs/common';
import { TermsService } from './terms.service';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
import { CreateTermsBulkDto } from './dto/create-terms-bulk.dto';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('terms')
@Controller('terms')
export class TermsController {
  constructor(private readonly termsService: TermsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new term' })
  @ApiResponse({ status: 201, description: 'Term created successfully' })
  @ApiResponse({ status: 409, description: 'Term order conflict' })
  async create(@Body() createTermDto: CreateTermDto) {
    return await this.termsService.create(createTermDto);
  }

  @Post('bulk/:academicYearId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create multiple terms for an academic year' })
  @ApiResponse({ status: 201, description: 'Terms created successfully' })
  @ApiResponse({ status: 400, description: 'Duplicate orders in input' })
  @ApiResponse({ status: 409, description: 'Term order conflict' })
  async createBulk(
    @Param('academicYearId') academicYearId: string,
    @Body() createTermsBulkDto: CreateTermsBulkDto,
  ) {
    return await this.termsService.createBulk(
      academicYearId,
      createTermsBulkDto.terms,
    );
  }

  @Get('by-year/:academicYearId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all terms for an academic year' })
  @ApiResponse({ status: 200, description: 'Terms fetched successfully' })
  async findByAcademicYear(@Param('academicYearId') academicYearId: string) {
    return await this.termsService.findByAcademicYear(academicYearId);
  }

  @Post('copy-from/:targetYearId/:sourceYearId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Copy terms from a previous academic year' })
  @ApiResponse({ status: 201, description: 'Terms copied successfully' })
  @ApiResponse({ status: 404, description: 'Source year has no terms' })
  @ApiResponse({ status: 409, description: 'Target year already has terms' })
  async copyFromYear(
    @Param('targetYearId') targetYearId: string,
    @Param('sourceYearId') sourceYearId: string,
    @Body() body: { termOverrides?: { order: number; startDate: string; endDate: string }[] },
  ) {
    return await this.termsService.copyFromYear(
      targetYearId,
      sourceYearId,
      body.termOverrides,
    );
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get term by ID' })
  @ApiResponse({ status: 200, description: 'Term fetched successfully' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  async findOne(@Param('id') id: string) {
    return await this.termsService.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update term' })
  @ApiResponse({ status: 200, description: 'Term updated successfully' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  async update(@Param('id') id: string, @Body() updateTermDto: UpdateTermDto) {
    return await this.termsService.update(id, updateTermDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete term' })
  @ApiResponse({ status: 200, description: 'Term deleted successfully' })
  @ApiResponse({ status: 404, description: 'Term not found' })
  async remove(@Param('id') id: string) {
    return await this.termsService.remove(id);
  }
}
