import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  Matches,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DailyTrackingRecordDto {
  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'معرّف الطالبة' })
  studentId: string;

  /**
   * Routed to the `attendance` collection, not stored here — so the family
   * is notified and the excuse flow still opens, exactly as it does today.
   */
  @IsBoolean()
  @ApiProperty({ description: 'غائبة اليوم', example: false })
  absent: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({ description: 'شاركت في الحصة', default: true })
  participation?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'أحضرت الواجب وحاولته — رصد سلوكي لا درجة',
    default: true,
  })
  homework?: boolean;

  /**
   * Tri-state. Absent from the payload, or null, both mean "no quiz today";
   * `false` means one was held and she did not pass it. @IsOptional() lets
   * null through where @IsBoolean() alone would reject it.
   */
  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'null = لا اختبار اليوم، false = لم تجتزه',
    nullable: true,
    default: null,
  })
  quiz?: boolean | null;
}

export class BulkDailyTrackingDto {
  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'معرّف الحصة' })
  lectureId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD',
  })
  @IsNotEmpty()
  @ApiProperty({ description: 'تاريخ الحصة', example: '2026-09-29' })
  date: string;

  @IsArray()
  @ArrayNotEmpty()
  // A class roster, not a bulk import. Well past the largest real class,
  // and low enough that one request cannot be turned into a heavy write.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DailyTrackingRecordDto)
  @ApiProperty({ type: [DailyTrackingRecordDto] })
  records: DailyTrackingRecordDto[];
}
