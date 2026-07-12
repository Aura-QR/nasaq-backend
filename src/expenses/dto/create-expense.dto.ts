import { ApiProperty } from '@nestjs/swagger';
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

  @ApiProperty({ required: false, example: '2024-2025' })
  @IsString()
  @IsOptional()
  academicYear?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}
