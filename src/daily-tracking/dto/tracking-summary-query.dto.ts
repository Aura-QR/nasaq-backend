import { IsMongoId, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrackingSummaryQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'startDate يجب أن يكون بصيغة YYYY-MM-DD',
  })
  @IsNotEmpty()
  @ApiProperty({ description: 'بداية المدة', example: '2026-09-01' })
  startDate: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'endDate يجب أن يكون بصيغة YYYY-MM-DD',
  })
  @IsNotEmpty()
  @ApiProperty({ description: 'نهاية المدة — مشمولة', example: '2026-09-30' })
  endDate: string;

  /**
   * Required, and not merely for convenience.
   *
   * The report is read per class, and an unscoped query would return every
   * tracked student in the school in one response. It is also what the
   * teacher's access is checked against.
   */
  @IsMongoId()
  @IsNotEmpty()
  @ApiProperty({ description: 'الفصل — مطلوب' })
  classId: string;

  @IsMongoId()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'مادة بعينها. بدونها تُحتسب كل مواد الفصل معًا.',
  })
  subjectOfferingId?: string;
}
