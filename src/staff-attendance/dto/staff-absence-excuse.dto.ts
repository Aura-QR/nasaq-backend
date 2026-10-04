import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class SubmitStaffAbsenceExcuseDto {
  @Matches(DATE_PATTERN, { message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' })
  @IsNotEmpty()
  @ApiProperty({ description: 'يوم الغياب', example: '2026-10-04' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'اكتب سبب الغياب' })
  @MaxLength(1000)
  @ApiProperty({ description: 'سبب الغياب', example: 'وعكة صحية' })
  reason: string;

  /** The path returned by the upload endpoint, not a file. */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  @ApiPropertyOptional({
    description: 'مسار المرفق من /staff-attendance/absence-excuse/attachment',
    example: '/uploads/absence-excuses/1759-ab12.jpg',
  })
  attachment?: string;
}

/** The school writing an excuse for somebody — a cleaner with no phone. */
export class RecordStaffAbsenceExcuseDto extends SubmitStaffAbsenceExcuseDto {
  @IsMongoId({ message: 'معرّف الموظف غير صالح' })
  @ApiProperty({ description: 'الموظف (مدير أو مشرف أو موظف خدمات)' })
  staffId: string;
}

export class ReviewStaffAbsenceExcuseDto {
  @IsIn(['accepted', 'rejected'])
  @ApiProperty({ enum: ['accepted', 'rejected'] })
  verdict: 'accepted' | 'rejected';

  /** Required on a rejection; enforced in the service. */
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @ApiPropertyOptional({ description: 'سبب القبول أو الرفض — إلزامي عند الرفض' })
  note?: string;
}

export class ListStaffAbsenceExcusesDto {
  @IsIn(['pending', 'accepted', 'rejected', 'marked_present'])
  @IsOptional()
  @ApiPropertyOptional({
    enum: ['pending', 'accepted', 'rejected', 'marked_present'],
    default: 'pending',
  })
  status?: 'pending' | 'accepted' | 'rejected' | 'marked_present';

  @Matches(DATE_PATTERN, { message: 'from يجب أن يكون بصيغة YYYY-MM-DD' })
  @IsOptional()
  @ApiPropertyOptional()
  from?: string;

  @Matches(DATE_PATTERN, { message: 'to يجب أن يكون بصيغة YYYY-MM-DD' })
  @IsOptional()
  @ApiPropertyOptional()
  to?: string;

  @IsMongoId()
  @IsOptional()
  @ApiPropertyOptional()
  staffId?: string;
}

export class MarkStaffPresentDto {
  /** When they arrived, school time. Omitted: the day's start, so no lateness. */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkInAt يجب أن يكون بصيغة HH:mm' })
  @ApiPropertyOptional({ example: '07:00' })
  checkInAt?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @ApiPropertyOptional({ example: 'كان في مهمة خارجية بتكليف من الإدارة' })
  note?: string;
}
