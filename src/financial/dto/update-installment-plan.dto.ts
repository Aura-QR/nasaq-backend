import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateInstallmentPlanDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  numberOfInstallments?: number;

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @ArrayMinSize(1)
  @IsDateString({}, { each: true })
  @IsOptional()
  dueDates?: string[];

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({ required: false, description: 'Optional linked discount MongoID' })
  @ValidateIf((o, v) => v !== null && v !== undefined)
  @IsMongoId()
  @IsOptional()
  linkedDiscountId?: string | null;
}
