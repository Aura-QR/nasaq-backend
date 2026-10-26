import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { RESIDENCY_DOCUMENT_TYPES } from './residency-document.schema';

export class SubmitResidencyDocumentDto {
  @ApiProperty({ enum: RESIDENCY_DOCUMENT_TYPES })
  @IsIn(RESIDENCY_DOCUMENT_TYPES as unknown as string[], { message: 'نوع الوثيقة يجب أن يكون إقامة أو زيارة أو جواز سفر أو أخرى' })
  type: string;

  @ApiPropertyOptional({ description: 'Required when type is other' })
  @ValidateIf((o) => o.type === 'other')
  @IsString({ message: 'يرجى كتابة اسم الوثيقة' })
  @MaxLength(60)
  otherTypeLabel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  documentNumber?: string;

  @ApiPropertyOptional({ example: '2026-01-15' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ الإصدار غير صالح' })
  issueDate?: string;

  @ApiPropertyOptional({ example: '2027-01-15' })
  @IsOptional()
  @IsDateString({}, { message: 'تاريخ الانتهاء غير صالح' })
  expiryDate?: string;
}

export class ReviewResidencyDocumentDto {
  @ApiProperty({ enum: ['approved', 'rejected'] })
  @IsIn(['approved', 'rejected'], { message: 'القرار يجب أن يكون قبول أو رفض' })
  decision: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Required when rejecting; shown to the student' })
  @ValidateIf((o) => o.decision === 'rejected')
  @IsString({ message: 'يرجى كتابة سبب الرفض' })
  @MaxLength(300)
  reason?: string;
}
