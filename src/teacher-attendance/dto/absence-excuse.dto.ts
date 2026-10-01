import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class SubmitAbsenceExcuseDto {
  @Matches(DATE_PATTERN, { message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' })
  @IsNotEmpty()
  @ApiProperty({ description: 'يوم الغياب', example: '2026-09-29' })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'اكتب سبب الغياب' })
  @MaxLength(1000)
  @ApiProperty({ description: 'سبب الغياب', example: 'وعكة صحية' })
  reason: string;

  /**
   * The path returned by the upload endpoint, not a file. Uploading and
   * explaining are separate steps so a teacher on a slow connection does not
   * lose her typed reason when the photo fails.
   */
  @IsString()
  @IsOptional()
  @MaxLength(300)
  @ApiPropertyOptional({
    description: 'مسار المرفق من /me/absence-excuse/attachment',
    example: '/uploads/absence-excuses/1759-ab12.jpg',
  })
  attachment?: string;
}

export class ReviewAbsenceExcuseDto {
  @IsIn(['accepted', 'rejected'])
  @ApiProperty({ enum: ['accepted', 'rejected'] })
  verdict: 'accepted' | 'rejected';

  /**
   * Required on a rejection, enforced in the service rather than here: a
   * refusal with no reason is the thing a teacher cannot answer.
   */
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  @ApiPropertyOptional({ description: 'سبب القبول أو الرفض — إلزامي عند الرفض' })
  note?: string;
}

export class ListAbsenceExcusesDto {
  @IsIn(['pending', 'accepted', 'rejected'])
  @IsOptional()
  @ApiPropertyOptional({ enum: ['pending', 'accepted', 'rejected'], default: 'pending' })
  status?: 'pending' | 'accepted' | 'rejected';

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
  teacherId?: string;
}

export class PendingAbsenceDaysDto {
  /**
   * How far back to look for unexplained days.
   *
   * A teacher off sick for three days answers once, when she is back, and
   * the other two days must still be there to answer. Capped so this never
   * becomes a scan of the whole year.
   */
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(60)
  @ApiPropertyOptional({ default: 14, maximum: 60 })
  days?: number;
}
