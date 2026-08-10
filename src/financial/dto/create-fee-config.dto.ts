import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class CreateFeeConfigDto {
  @ApiProperty({ description: 'Academic Year ID (Mongo ObjectId)' })
  @IsMongoId()
  @IsNotEmpty()
  academicYearId: string;

  @ApiProperty({ description: 'Grade Level ID (Mongo ObjectId)' })
  @IsMongoId()
  @IsNotEmpty()
  gradeLevelId: string;

  @ApiProperty({ description: 'Annual tuition fee in EGP' })
  @IsNumber()
  @Min(0)
  tuitionFee: number;

  @ApiProperty({ description: 'Expatriate tuition surcharge percentage (0-100)', required: false, default: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  expatriateSurchargePercentage?: number;
}
