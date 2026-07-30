import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsMongoId,
  Min,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GenderEnum } from '../enums/gender.enum';

export class CreateClassDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Name of the class (e.g. 1/1, 1/2)' })
  name: string;

  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'ID of the GradeLevel' })
  gradeLevelId: string;

  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'ID of the AcademicYear' })
  academicYearId: string;

  @IsEnum(GenderEnum)
  @IsNotEmpty()
  @ApiProperty({ description: 'Gender for the class' })
  gender: GenderEnum;

  @IsMongoId()
  @IsOptional()
  @ApiProperty({ description: 'Teacher in charge of the class', required: false })
  teacherInChargeId?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Physical room number', required: false })
  roomNumber?: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @ApiProperty({ description: 'Maximum capacity of the class' })
  maxCapacity: number;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Active status of the class', default: true })
  isActive?: boolean;
}