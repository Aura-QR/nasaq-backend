import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionDto } from './create-exam.dto';

/**
 * «اختبار بديل»: the missed exam again, for the students the teacher picks.
 * Subject, classes, type and grade come from the original; these are the
 * makeup's own.
 */
export class CreateMakeupExamDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر طالبة واحدة على الأقل' })
  @ArrayMaxSize(200, { message: 'لا يتجاوز الاختبار البديل 200 طالبة' })
  @IsMongoId({ each: true, message: 'معرّف طالبة غير صالح' })
  @ApiProperty({ type: [String] })
  studentIds: string[];

  // YYYY-MM-DD (the whole day) or a date-time («الثلاثاء 08:00»).
  @IsDateString({}, { message: 'تاريخ البداية غير صالح' })
  @ApiProperty({ example: '2026-12-08T08:00:00+03:00' })
  startDate: string;

  @IsDateString({}, { message: 'تاريخ النهاية غير صالح' })
  @ApiProperty({ example: '2026-12-08T10:00:00+03:00' })
  endDate: string;

  @IsInt({ message: 'مدة الاختبار بالدقائق عدد صحيح' })
  @Min(1, { message: 'مدة الاختبار دقيقة واحدة على الأقل' })
  @ApiProperty({ example: 20 })
  duration: number;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ description: 'Copy the original\'s questions (new ids). Otherwise send `questions`.' })
  copyQuestions?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  @ApiPropertyOptional({ type: [QuestionDto] })
  questions?: QuestionDto[];
}
