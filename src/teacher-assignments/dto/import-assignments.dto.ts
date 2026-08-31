import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportAssignmentsDto {
  @ApiProperty({ description: 'Term the assignments belong to' })
  @IsMongoId()
  termId: string;

  @ApiProperty({
    description:
      'Pasted sheet, one row per teacher-subject-grade: teacher, subject, ' +
      'grade(s). Several grades in one row are separated by "+" or "/". ' +
      'Tab, comma, pipe or semicolon all work. Lines starting with # are ignored.',
    example:
      'أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع + الصف الخامس\nأ/ جيهان\tعلوم\tالصف الرابع',
  })
  @IsString()
  @MaxLength(50000)
  text: string;

  @ApiPropertyOptional({
    description:
      'Parse and report without writing. Defaults to true — assigning a class ' +
      'to the wrong teacher is much easier to prevent than to notice.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
