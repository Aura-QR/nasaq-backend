import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateDiscountDto {
  @ApiProperty({ example: 'الطلاب السابقون' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'لكل طالب درس في المدرسة العام الماضي' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, enum: ['percentage', 'fixed'], default: 'percentage' })
  @IsOptional()
  @IsIn(['percentage', 'fixed'], { message: 'نوع الخصم: نسبة أو مبلغ ثابت' })
  type?: 'percentage' | 'fixed';

  @ApiProperty({ required: false, example: 10, description: 'For type=percentage: 0–100' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100, { message: 'نسبة الخصم لا يمكن أن تتجاوز 100%' })
  percentage?: number;

  @ApiProperty({ required: false, example: 500, description: 'For type=fixed: riyals off' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}
