import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterMarkDto {
  @IsMongoId()
  studentId: string;

  /** null removes the mark. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  score: number | null;
}

export class WrittenItemDto {
  /** Omitted — a new item. */
  @IsMongoId()
  @IsOptional()
  _id?: string;

  @IsString()
  @MaxLength(120)
  @IsOptional()
  title?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  @IsOptional()
  maxScore?: number;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RegisterMarkDto)
  @IsOptional()
  marks?: RegisterMarkDto[];

  /** true — delete this item and its marks. */
  @IsBoolean()
  @IsOptional()
  remove?: boolean;
}

export class SaveRegisterMarksDto {
  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty()
  classId: string;

  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty()
  subjectOfferingId: string;

  /** Paper end-of-term marks, out of 40. Final-exam subjects only. */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RegisterMarkDto)
  @IsOptional()
  @ApiPropertyOptional({ type: [RegisterMarkDto] })
  finalMarks?: RegisterMarkDto[];

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => WrittenItemDto)
  @IsOptional()
  @ApiPropertyOptional({ type: [WrittenItemDto] })
  writtenItems?: WrittenItemDto[];
}
