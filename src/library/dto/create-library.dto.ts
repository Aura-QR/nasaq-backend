import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsMongoId,
  IsUrl,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateLibraryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The title of the library item' })
  title: string;

  @IsString()
  @IsNotEmpty()
  @IsUrl()
  @ApiProperty({ description: 'The link/URL of the library item' })
  link: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({
    description: 'The subject ID this item is connected to (optional)',
    required: false,
  })
  subjectId?: string; // Optional: connected to a subject

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'The academic year (e.g., "2024-2025") (optional)',
    required: false,
  })
  academicYear?: string; // Optional: academic year
}
