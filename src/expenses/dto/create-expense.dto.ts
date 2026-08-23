import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateExpenseDto {
  @ApiProperty({ example: 'إصلاح مكيفات' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 1500 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({ example: '2025-09-01' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    example: '6650a1b2c3d4e5f6a7b8c9d1',
    description:
      'Academic year the expense belongs to. Omit it and the school\'s active year is used.',
  })
  @IsMongoId()
  @IsOptional()
  academicYearId?: string;

  @ApiPropertyOptional({
    deprecated: true,
    example: '2025-2026',
    description:
      'Deprecated: the academic year NAME. Kept so the current web client keeps working; ' +
      'it is resolved to an id server-side. Send academicYearId instead.',
  })
  @IsString()
  @IsOptional()
  academicYear?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
