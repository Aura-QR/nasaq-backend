import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
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

  /** Periods on this day. Omit to use the school-wide number. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(10)
  periodsPerDay?: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A named stretch of days the school does not work.
 *
 * A range, not a list of dates: a mid-term break is one thing with one name,
 * and making somebody enter ten separate days is how a setting goes unused.
 * A single day is a range whose ends are equal.
 */
export class SchoolHolidayDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @Matches(DATE_PATTERN, { message: 'startDate يجب أن يكون بصيغة YYYY-MM-DD' })
  startDate: string;

  /** Inclusive. Equal to startDate for a single day. */
  @Matches(DATE_PATTERN, { message: 'endDate يجب أن يكون بصيغة YYYY-MM-DD' })
  endDate: string;
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

  /** Teaching periods in a school day. Decides a week's timetable capacity. */
  @IsInt()
  @Min(1)
  @Max(10)
  @IsOptional()
  periodsPerDay?: number;

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

  @IsOptional()
  @IsBoolean()
  staffCheckInEnabled?: boolean;

  /**
   * The school week. Sending the array replaces it wholesale, so read the
   * current value first and send back the full seven days.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkDayDto)
  workSchedule?: WorkDayDto[];

  /**
   * One start time for the whole week — the shape this setting shipped in
   * first, kept working for the client already sending it.
   *
   * It is applied to every working day in `workSchedule`, and read back in
   * GET when the working days share a start time. They will not once a school
   * sets a short day, and null is the honest answer then rather than picking
   * one of them.
   *
   * `workSchedule` wins if both are sent. Prefer it: this cannot express a
   * short day or a day off.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME_PATTERN, {
    message: 'workStartTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة',
  })
  workStartTime?: string | null;

  /**
   * Days off the weekly schedule cannot express — Eid, a mid-term break, a
   * national day. Sending the array replaces it wholesale.
   *
   * `workSchedule` answers "is Friday a working day", which is the wrong
   * question for the twelfth of Ramadan. Without this, a break counted as
   * absence against every teacher in the school.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SchoolHolidayDto)
  holidays?: SchoolHolidayDto[];
}
