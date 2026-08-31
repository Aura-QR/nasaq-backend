import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImportPlanDto {
  @ApiProperty({ description: 'Term the plan belongs to' })
  @IsMongoId()
  termId: string;

  @ApiProperty({ description: 'Grade level the plan belongs to' })
  @IsMongoId()
  gradeLevelId: string;

  @ApiProperty({
    description:
      'Pasted plan, one subject per line: name then periods. Tab, comma, ' +
      'pipe, semicolon or plain spacing all work, so a paste straight out of ' +
      'Excel is accepted as-is. Lines starting with # are ignored.',
    example: 'لغتي\t6\nرياضيات\t6\nعلوم\t4\nتربية فنية\t1',
  })
  @IsString()
  @MaxLength(20000)
  text: string;

  @ApiPropertyOptional({
    description:
      'Parse and report without writing. Defaults to true — an import that ' +
      'writes before you have seen what it matched is how a plan gets ' +
      'silently attached to the wrong subject.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Create a subject offering for a subject that has none in this term ' +
      'and grade, instead of reporting it as missing.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  createMissingOfferings?: boolean;
}
