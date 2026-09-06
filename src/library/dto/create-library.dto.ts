import {
  IsString,
  IsNotEmpty,
  MinLength,
  IsOptional,
  IsMongoId,
  IsUrl,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateLibraryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @ApiProperty({ description: 'The title of the library item' })
  title: string;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @ApiProperty({ description: 'The link/URL of the library item' })
  link?: string;

  @IsOptional()
  @IsIn(['link', 'file'])
  @ApiProperty({ enum: ['link', 'file'], default: 'link', required: false })
  kind?: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({
    description: 'The SubjectOffering ID this item is connected to (optional)',
    required: false,
  })
  subjectOfferingId?: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({
    description: 'The Subject ID (alternative to subjectOfferingId)',
    required: false,
  })
  subjectId?: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({
    description: 'The Academic Year ID (optional)',
    required: false,
  })
  academicYearId?: string;
}
