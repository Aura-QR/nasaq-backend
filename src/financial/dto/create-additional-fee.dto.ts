import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AdditionalFeeTarget } from '../schemas/additional-fee.schema';

export class CreateAdditionalFeeDto {
  @ApiProperty({ example: 'رسوم الكتب' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'رسوم شراء الكتب للعام الدراسي' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    enum: AdditionalFeeTarget,
    example: AdditionalFeeTarget.CLASS,
    description: 'student | class | academicYear | school | all',
  })
  @IsEnum(AdditionalFeeTarget)
  targetType: AdditionalFeeTarget;

  @ApiProperty({
    required: false,
    example: '6650a1b2c3d4e5f6a7b8c9d0',
    description:
      'Required when targetType is "student", "class", or "academicYear". ' +
      'Must be the ObjectId of the student, class, or academic year respectively.',
  })
  @IsMongoId()
  @IsOptional()
  targetId?: string;

  /**
   * @deprecated Use targetId (ObjectId of AcademicYear) instead.
   * Kept for backward compatibility — ignored when targetId is also provided.
   */
  @ApiProperty({
    required: false,
    description: 'Deprecated: use targetId (ObjectId of AcademicYear) instead',
  })
  @IsString()
  @IsOptional()
  targetAcademicYear?: string;
}
