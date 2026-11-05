import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsInt, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateFeeItemDto {
  @ApiProperty({ example: 'الزي المدرسي' })
  @IsString()
  @IsNotEmpty({ message: 'اكتب اسم البند' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ required: false, example: 'طقم واحد' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 150, description: 'Price of one piece, in riyals' })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class UpdateFeeItemDto extends PartialType(CreateFeeItemDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Charge a student for N pieces of an item, at today's price. */
export class SellFeeItemDto {
  @ApiProperty({ example: 2 })
  @IsInt({ message: 'الكمية عدد صحيح' })
  @Min(1, { message: 'الكمية لا تقل عن 1' })
  @Max(100)
  quantity: number;

  @ApiProperty({ required: false, description: 'Also record it as paid on this date' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  academicYearId?: string;
}
