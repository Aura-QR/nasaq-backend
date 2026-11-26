import { PartialType } from '@nestjs/mapped-types';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsOptional } from 'class-validator';
import { CreateExamDto } from './create-exam.dto';

export class UpdateExamDto extends PartialType(CreateExamDto) {
  /** Makeup exams only: who may sit it. Added students are checked and notified. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر طالبة واحدة على الأقل' })
  @ArrayMaxSize(200, { message: 'لا يتجاوز الاختبار البديل 200 طالبة' })
  @IsMongoId({ each: true, message: 'معرّف طالبة غير صالح' })
  studentIds?: string[];
}
