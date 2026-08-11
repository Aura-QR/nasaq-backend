import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryTeacherAttendanceDto {
  @ApiProperty({ description: 'Filter by teacher ID', required: false })
  @IsOptional()
  @IsMongoId()
  teacherId?: string;

  @ApiProperty({ description: 'Filter by specific date (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiProperty({ description: 'Start date range filter (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiProperty({ description: 'End date range filter (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiProperty({ description: 'Filter by check-in method', enum: ['location', 'manual'], required: false })
  @IsOptional()
  @IsEnum(['location', 'manual'])
  method?: string;

  @ApiProperty({ description: 'Page number (default: 1)', required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiProperty({ description: 'Items per page (default: 10, max: 100)', required: false, default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;
}
