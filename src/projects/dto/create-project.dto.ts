import {
  IsString,
  IsNotEmpty,
  IsMongoId,
  IsArray,
  IsDateString,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ description: 'Array of class IDs', type: [String], required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return value;
    let arr = Array.isArray(value) ? value :
              typeof value === 'string' ?
                (value.includes('[') ? JSON.parse(value) : value.split(',').map((id: string) => id.trim())) :
                [value];
    return arr;
  })
  @IsArray()
  @IsMongoId({ each: true })
  classIds?: string[];

  @ApiProperty({ description: 'Subject ID', type: String })
  @IsNotEmpty()
  @IsMongoId()
  subjectId: string;



  @ApiProperty({ description: 'Academic year' })
  @IsString()
  @IsNotEmpty()
  academicYear: string;

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
    required: false
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  filePaths?: string[];
}