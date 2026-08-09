import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateInstallmentPlanDto {
  @ApiProperty({ example: '4 Equal Installments' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 4, description: 'Number of installments (must equal dueDates.length)' })
  @IsInt()
  @Min(1)
  numberOfInstallments: number;

  @ApiProperty({
    type: [String],
    example: ['2025-09-01', '2025-11-01', '2026-01-01', '2026-03-01'],
    description: 'Due dates — count must equal numberOfInstallments',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsDateString({}, { each: true })
  dueDates: string[];

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @ApiProperty({ required: false, description: 'Optional linked discount MongoID' })
  @ValidateIf((o, v) => v !== null && v !== undefined)
  @IsMongoId()
  @IsOptional()
  linkedDiscountId?: string | null;
}
