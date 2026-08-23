import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateExpenseDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  date?: string;

  @ApiPropertyOptional({ example: '6650a1b2c3d4e5f6a7b8c9d1' })
  @IsMongoId()
  @IsOptional()
  academicYearId?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Deprecated: the academic year NAME. Send academicYearId instead.',
  })
  @IsString()
  @IsOptional()
  academicYear?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
