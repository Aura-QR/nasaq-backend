import {
  IsString,
  IsNotEmpty,
  IsMongoId,
  IsArray,
  IsDateString,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ description: 'Array of class IDs', type: [String], required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return value;
    let arr = Array.isArray(value)
      ? value
      : typeof value === 'string'
      ? value.includes('[')
        ? JSON.parse(value)
        : value.split(',').map((id: string) => id.trim())
      : [value];
    return arr;
  })
  @IsArray()
  @IsMongoId({ each: true })
  classIds?: string[];

  @ApiProperty({ description: 'SubjectOffering ID', type: String })
  @IsNotEmpty()
  @IsMongoId()
  subjectOfferingId: string;

  @ApiProperty({ description: 'Project title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Project description' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ description: 'Project due date', type: String })
  @IsDateString()
  @IsNotEmpty()
  dueDate: Date;

  @ApiProperty({
    description: 'Project file paths',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];

  /**
   * Ministry grading template only: what the project is out of (default 10).
   * Sent as form data, so it arrives as text.
   */
  @ApiProperty({ description: 'Ministry template: the project is out of this', required: false, example: 10 })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === undefined || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(1)
  @Max(100)
  grade?: number;
}
