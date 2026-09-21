import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OBSERVATION_STATUSES } from '../schemas/lesson-observation.schema';

/** What a supervisor saw in one classroom. */
export class RecordObservationDto {
  @ApiProperty({ description: 'The lesson that was looked in on' })
  @IsMongoId()
  lectureId: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD. Defaults to today.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ enum: OBSERVATION_STATUSES })
  @IsIn(OBSERVATION_STATUSES as unknown as string[], {
    message: 'الحالة يجب أن تكون present أو late أو absent',
  })
  status: (typeof OBSERVATION_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Minutes late. Only read for status=late.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  lateMinutes?: number;

  /**
   * The clock time of the round, in the school's timezone.
   *
   * "We passed at 11:15" is the fact the teacher will dispute or accept, and
   * it is not the same as when the supervisor typed it up.
   */
  @ApiPropertyOptional({ example: '11:15', description: 'HH:mm' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'الوقت يجب أن يكون بصيغة HH:mm' })
  observedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** The teacher's account of what the supervisor wrote down. */
export class ExplainObservationDto {
  @ApiProperty({ example: 'كنت في اجتماع مع ولي أمر بطلب من الإدارة' })
  @IsString()
  @MinLength(3, { message: 'اكتب سبب التأخر أو الغياب' })
  @MaxLength(1000)
  reason: string;
}

export const OBSERVATION_VERDICTS = ['accepted', 'rejected'] as const;

/** The school's ruling on that account. */
export class ReviewObservationDto {
  @ApiProperty({ enum: OBSERVATION_VERDICTS })
  @IsIn(OBSERVATION_VERDICTS as unknown as string[], {
    message: 'القرار يجب أن يكون accepted أو rejected',
  })
  verdict: (typeof OBSERVATION_VERDICTS)[number];

  /** Required for a refusal — see the service. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Filters for the log. */
export class ListObservationsDto {
  @ApiPropertyOptional({
    enum: ['late', 'absent', 'present', 'pending', 'unexplained'],
    description:
      "'pending' is explained and awaiting a ruling; 'unexplained' is a " +
      'lateness or absence the teacher has not answered at all.',
  })
  @IsOptional()
  @IsIn(['late', 'absent', 'present', 'pending', 'unexplained'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  teacherId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
