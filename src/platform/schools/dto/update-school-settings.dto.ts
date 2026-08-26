import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
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

  /** "HH:mm", 24h, in the school's timezone. Send null to stop tracking lateness. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'workStartTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة',
  })
  workStartTime?: string | null;
}
