import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
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
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => SeedCatalogLessonDto)
  lessons: SeedCatalogLessonDto[];
}
