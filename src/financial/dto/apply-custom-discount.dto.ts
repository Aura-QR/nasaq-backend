import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** A discount typed in for one student, with the reason it was given. */
export class ApplyCustomDiscountDto {
  @ApiProperty({ enum: ['percentage', 'fixed'] })
  @IsIn(['percentage', 'fixed'], { message: 'نوع الخصم: نسبة أو مبلغ ثابت' })
  type: 'percentage' | 'fixed';

  @ApiProperty({ example: 500, description: 'Percentage (0–100) or riyals, by type' })
  @IsNumber()
  @Min(0.01, { message: 'أدخل قيمة الخصم' })
  value: number;

  @ApiProperty({ example: 'ظروف خاصة بالأسرة' })
  @IsString()
  @IsNotEmpty({ message: 'اكتب سبب الخصم' })
  @MaxLength(300)
  reason: string;

  @ApiProperty({ required: false })
  @IsMongoId()
  @IsOptional()
  academicYearId?: string;
}
