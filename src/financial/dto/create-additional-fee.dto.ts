import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AdditionalFeeTarget } from '../schemas/additional-fee.schema';

export class CreateAdditionalFeeDto {
  @ApiProperty({ example: 'New Screens' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'Smart screens installed in all classrooms' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ enum: AdditionalFeeTarget, example: AdditionalFeeTarget.CLASS })
  @IsEnum(AdditionalFeeTarget)
  targetType: AdditionalFeeTarget;

  @ApiProperty({
    required: false,
    example: '6650a1b2c3d4e5f6a7b8c9d0',
    description: 'Required when targetType is "student" or "class"',
  })
  @IsMongoId()
  @IsOptional()
  targetId?: string;

  @ApiProperty({
    required: false,
    example: 'grade 1',
    description: 'Required when targetType is "academicYear"',
  })
  @IsString()
  @IsOptional()
  targetAcademicYear?: string;
}
