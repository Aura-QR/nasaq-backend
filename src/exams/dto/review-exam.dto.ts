import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsNumber,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** One essay answer marked: what it earned, and an optional note to the student. */
export class ReviewGradeDto {
  @IsMongoId({ message: 'معرّف الطالب غير صالح' })
  @ApiProperty()
  studentId: string;

  @IsMongoId({ message: 'معرّف السؤال غير صالح' })
  @ApiProperty()
  questionId: string;

  // Range and the 0.25 step are checked against the question's marks in the service.
  @IsNumber({}, { message: 'الدرجة يجب أن تكون رقمًا' })
  @ApiProperty({ description: 'A multiple of 0.25 between 0 and the question\'s marks', example: 5 })
  earned: number;

  @ValidateIf((o) => o.feedback !== null && o.feedback !== undefined)
  @IsString()
  @MaxLength(1000, { message: 'الملاحظة لا تتجاوز 1000 حرف' })
  @ApiPropertyOptional({ example: 'أحسنتِ، ينقص ذكر الوحدة', nullable: true })
  feedback?: string | null;
}

/** One save for a whole marking screen. */
export class ReviewExamDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'لا توجد درجات للحفظ' })
  @ArrayMaxSize(500, { message: 'لا تتجاوز 500 إجابة في المرة الواحدة' })
  @ValidateNested({ each: true })
  @Type(() => ReviewGradeDto)
  @ApiProperty({ type: [ReviewGradeDto] })
  grades: ReviewGradeDto[];
}
