import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength,
  ValidateIf, ValidateNested,
} from 'class-validator';
import { WEEKDAYS } from '../../platform/schools/schemas/school.schema';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One day of a staff member's own week — the school settings' WorkDay without periods. */
export class StaffWorkDayDto {
  @IsIn(WEEKDAYS as unknown as string[], { message: 'day يجب أن يكون أحد أيام الأسبوع بالإنجليزية بحروف صغيرة' })
  @ApiProperty({ example: 'sunday' })
  day: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ example: true })
  isWorkingDay?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME, { message: 'startTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  @ApiPropertyOptional({ example: '06:30' })
  startTime?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(TIME, { message: 'endTime يجب أن يكون بصيغة HH:mm بنظام 24 ساعة' })
  @ApiPropertyOptional({ example: '13:30' })
  endTime?: string | null;
}

const USERNAME = /^[A-Za-z0-9._-]+$/;

export class CreateStaffMemberDto {
  @IsString()
  @IsNotEmpty({ message: 'اكتب اسم الموظف' })
  @MaxLength(100)
  @ApiProperty({ example: 'محمد السيد' })
  fullName: string;

  /** What they sign in with — a guard rarely has an email address. */
  @IsString()
  @Length(4, 20)
  @Matches(USERNAME, { message: 'اسم المستخدم حروف إنجليزية وأرقام فقط' })
  @ApiProperty({ example: 'guard01' })
  username: string;

  @IsString()
  @Length(6, 100)
  @ApiProperty()
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  @ApiPropertyOptional({ example: 'حارس' })
  jobLabel?: string;

  /** How the school reaches them — a guard often has neither email nor app. */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  // Same shape as a teacher's number; an empty string clears it.
  @Matches(/^$|^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/, { message: 'رقم الهاتف غير صحيح' })
  @ApiPropertyOptional({ example: '0501234567' })
  phoneNumber?: string;

  /**
   * Optional. Without one, "forgot password" cannot reach them and the owner
   * resets it instead (PATCH with a new password).
   */
  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional()
  email?: string;

  /**
   * Their own hours, where they differ from the school's. Each day listed
   * replaces the school's day of that name; [] clears it, and the person
   * follows the school again.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => StaffWorkDayDto)
  @ApiPropertyOptional({ type: [StaffWorkDayDto] })
  workSchedule?: StaffWorkDayDto[];
}

export class UpdateStaffMemberDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'اكتب اسم الموظف' })
  @MaxLength(100)
  @ApiPropertyOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(60)
  @ApiPropertyOptional()
  jobLabel?: string;

  /** How the school reaches them — a guard often has neither email nor app. */
  @IsString()
  @IsOptional()
  @MaxLength(20)
  // Same shape as a teacher's number; an empty string clears it.
  @Matches(/^$|^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/, { message: 'رقم الهاتف غير صحيح' })
  @ApiPropertyOptional({ example: '0501234567' })
  phoneNumber?: string;

  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional()
  email?: string;

  /** Set a new password — the owner's way back in for someone with no email. */
  @IsString()
  @IsOptional()
  @Length(6, 100)
  @ApiPropertyOptional()
  password?: string;

  /**
   * Their own hours, where they differ from the school's. Each day listed
   * replaces the school's day of that name; [] clears it, and the person
   * follows the school again.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => StaffWorkDayDto)
  @ApiPropertyOptional({ type: [StaffWorkDayDto] })
  workSchedule?: StaffWorkDayDto[];
}
