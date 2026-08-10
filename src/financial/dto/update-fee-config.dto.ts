import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateFeeConfigDto {
  @ApiProperty({ required: false, description: 'Academic Year ID (Mongo ObjectId)' })
  @IsMongoId()
  @IsOptional()
  academicYearId?: string;

  @ApiProperty({ required: false, description: 'Grade Level ID (Mongo ObjectId)' })
  @IsMongoId()
  @IsOptional()
  gradeLevelId?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  tuitionFee?: number;

  @ApiProperty({ required: false, description: 'Expatriate tuition surcharge percentage (0-100)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  expatriateSurchargePercentage?: number;
}
