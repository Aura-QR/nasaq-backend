import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, Min } from 'class-validator';

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
}
