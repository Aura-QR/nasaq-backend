import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
export class SeedCatalogLessonDto {
  @Matches(/^\d+(,\d+){2,3}$/) id: string;
  @IsString() @IsNotEmpty() @MaxLength(500) unit: string;
  @IsString() @IsNotEmpty() @MaxLength(500) lessonName: string;
}
export class SeedCatalogSubjectDto {
  @Matches(/^\d+$/) subjectId: string;
  @IsString() @IsNotEmpty() @MaxLength(500) subjectName: string;

  /** Distinguishes two courses that share a subject name. See the schema. */
  @IsOptional() @IsString() @MaxLength(500) subjectVariant?: string;

  /** Only when the source knows it; the school picks the real grade on import. */
  @IsOptional() @IsString() @MaxLength(200) gradeName?: string;
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => SeedCatalogLessonDto)
  lessons: SeedCatalogLessonDto[];
}
