import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { NATIONALITY_CODES } from '../../../common/constants/nationalities.constant';

export class LocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

export class UpdateSchoolSettingsDto {
  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  termsPerYear?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  defaultPassingGrade?: number;

  @IsArray()
  @IsString({ each: true })
  @IsIn(NATIONALITY_CODES, { each: true })
  @IsOptional()
  localNationalityCodes?: string[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto | null;

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(2000)
  checkInRadiusMeters?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  schoolNetworkIps?: string[];

  @IsOptional()
  @IsBoolean()
  teacherCheckInEnabled?: boolean;
}
