import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Role } from '../../auth/enums/role.enum';

export const ATTENDANCE_STAFF_ROLES = [Role.MANAGER, Role.SUPERVISOR];

export class StaffLocationDto {
  @ApiProperty({ example: 24.7136 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 46.6753 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mockLocationSuspected?: boolean;
}

export class StaffDirectoryQueryDto {
  @ApiPropertyOptional({ enum: ATTENDANCE_STAFF_ROLES })
  @IsOptional()
  @IsIn(ATTENDANCE_STAFF_ROLES)
  role?: Role.MANAGER | Role.SUPERVISOR;
}

export class StaffAbsenceQueryDto extends StaffDirectoryQueryDto {
  @ApiPropertyOptional({
    description: 'YYYY-MM-DD; defaults to today in the school timezone',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date?: string;
}

export class QueryStaffAttendanceDto extends StaffAbsenceQueryDto {
  @ApiPropertyOptional({ description: 'Admin account ID, not a teacher ID' })
  @IsOptional()
  @IsMongoId()
  staffId?: string;

  @ApiPropertyOptional({ description: 'Inclusive YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Inclusive YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateTo?: string;

  @ApiPropertyOptional({ enum: ['location', 'manual'] })
  @IsOptional()
  @IsIn(['location', 'manual'])
  method?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}

export class SummaryStaffAttendanceDto extends StaffDirectoryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  staffId?: string;

  @ApiProperty({ description: 'Inclusive YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateFrom: string;

  @ApiProperty({ description: 'Inclusive YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dateTo: string;
}

// An explicit offset avoids interpreting a phone's local clock as UTC.
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class CreateManualStaffAttendanceDto {
  @ApiProperty({ description: 'MANAGER or SUPERVISOR Admin account ID' })
  @IsMongoId()
  staffId: string;

  @ApiProperty({ description: 'School calendar date, YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  date: string;

  @ApiProperty({ example: '2026-09-14T07:45:00+03:00' })
  @Matches(INSTANT_PATTERN)
  @IsDateString({ strict: true })
  checkInAt: string;

  @ApiPropertyOptional({ example: '2026-09-14T14:00:00+03:00' })
  @IsOptional()
  @Matches(INSTANT_PATTERN)
  @IsDateString({ strict: true })
  checkOutAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateStaffAttendanceDto {
  @ApiPropertyOptional({ example: '2026-09-14T07:45:00+03:00' })
  @IsOptional()
  @Matches(INSTANT_PATTERN)
  @IsDateString({ strict: true })
  checkInAt?: string;

  @ApiPropertyOptional({ example: '2026-09-14T14:00:00+03:00' })
  @IsOptional()
  @Matches(INSTANT_PATTERN)
  @IsDateString({ strict: true })
  checkOutAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
