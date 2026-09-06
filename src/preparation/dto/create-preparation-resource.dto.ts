import {
  IsArray,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FileRefDto } from '../../common/dto/file-ref.dto';
import { RESOURCE_TYPES } from '../schemas/preparation-resource.schema';
export class CreatePreparationResourceDto {
  @IsIn(RESOURCE_TYPES) type: string;
  @IsOptional() @IsMongoId() examId?: string;
  @IsOptional() @IsMongoId() projectId?: string;
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) description?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsNumber() @Min(0) totalGrade?: number;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  link?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileRefDto)
  files?: FileRefDto[];
}
