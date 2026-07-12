import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsMongoId,
  IsArray,
  Min,
  IsDateString,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class CreateClassDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The academic year of the class' })
  academicYear: string;

  @IsEnum(['male', 'female', 'both'])
  @IsNotEmpty()
  @ApiProperty({ description: 'The gender of the class' })
  gender: string;

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  @ApiProperty({ description: 'The subject IDs of the class' })
  subjectIds?: string[];

  @IsArray()
  @IsMongoId({ each: true })
  @IsOptional()
  @ApiProperty({ description: 'The student IDs of the class' })
  studentIds?: string[];

  @IsMongoId()
  @IsOptional()
  @ApiProperty({ description: 'The teacher in charge of the class' })
  teacherInChargeId?: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'The room number of the class' })
  roomNumber: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  @ApiProperty({ description: 'The maximum capacity of the class' })
  maxCapacity: number;

  @IsBoolean()
  @IsNotEmpty()
  @ApiProperty({ description: 'The active status of the class' })
  isActive: boolean;

  // @IsDateString()
  // @IsOptional()
  // @ApiProperty({ description: 'The start date of the class' })
  // startDate?: string;

  // @IsDateString()
  // @IsOptional()
  // @ApiProperty({ description: 'The end date of the class' })
  // endDate?: string;
}