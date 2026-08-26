import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { NATIONALITY_CODES } from '../../../common/constants/nationalities.constant';
import { WEEKDAYS } from '../schemas/school.schema';

export class LocationDto {
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkDayDto {
  @IsIn(WEEKDAYS as unknown as string[], {
    message: 'day يجب أن يكون أحد أيام الأسبوع بالإنجليزية بحروف صغيرة',
  })
  day: string;

  @IsOptional()
  @IsBoolean()
  isWorkingDay?: boolean;

  /*
   * null is a meaningful value here — a working day whose hours are not set —
   * so ValidateIf lets it through rather than tripping the pattern.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, { message: 'startTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  startTime?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, { message: 'endTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  endTime?: string | null;
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

  /**
   * The school week. Send the days you want to change; a day you omit is left
   * as it was — except that sending the array at all replaces it wholesale,
   * so read the current value first and send back the full seven.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkDayDto)
  workSchedule?: WorkDayDto[];
}
