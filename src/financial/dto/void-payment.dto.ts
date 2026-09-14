import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const VOIDABLE_SECTIONS = ['tuition', 'bus', 'trip', 'additionalFee'] as const;
export type VoidableSection = (typeof VOIDABLE_SECTIONS)[number];

/**
 * Which payment to void, and why.
 *
 * Payments carry no id of their own, so one is addressed by where it sits:
 * the section, the trip or additional fee when there is one, the installment,
 * and its position in that installment's payments. Positions are stable —
 * payments are only ever appended, and a void marks an entry rather than
 * removing it. `expectedAmount` is checked against the entry at that position
 * so a stale page cannot void the wrong one.
 */
export class VoidPaymentDto {
  @ApiProperty({ enum: VOIDABLE_SECTIONS })
  @IsIn(VOIDABLE_SECTIONS as unknown as string[])
  section: VoidableSection;

  @ApiPropertyOptional({ description: "The trip record's _id. Required for section=trip." })
  @ValidateIf((dto) => dto.section === 'trip')
  @IsMongoId()
  tripId?: string;

  @ApiPropertyOptional({ description: 'Required for section=additionalFee.' })
  @ValidateIf((dto) => dto.section === 'additionalFee')
  @IsMongoId()
  additionalFeeId?: string;

  @ApiPropertyOptional({ description: 'Required for tuition, bus and trip.' })
  @ValidateIf((dto) => dto.section !== 'additionalFee')
  @IsInt()
  @Min(1)
  installmentNumber?: number;

  @ApiProperty({ description: "Position in that installment's payments array." })
  @IsInt()
  @Min(0)
  paymentIndex: number;

  @ApiProperty({ description: 'The amount shown for that payment. Must match.' })
  @IsNumber()
  @Min(0)
  expectedAmount: number;

  @ApiProperty({ description: 'Why it is being voided. Kept on the entry.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'اكتب سبب إلغاء الدفعة' })
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  academicYearId?: string;
}
