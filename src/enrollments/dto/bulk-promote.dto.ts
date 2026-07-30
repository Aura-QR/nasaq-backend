import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SinglePromotionDto {
  @ApiProperty({ description: 'Student ID' })
  @IsMongoId()
  studentId: string;

  @ApiProperty({ description: 'Target Class ID in the new academic year' })
  @IsMongoId()
  targetClassId: string;
}

export class BulkPromoteDto {
  @ApiProperty({ description: 'Array of student promotion mappings', type: [SinglePromotionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SinglePromotionDto)
  promotions: SinglePromotionDto[];

  @ApiProperty({ description: 'Array of student IDs to exclude from promotion (repeating, transferred, graduating)', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  excludedStudentIds?: string[];
}
