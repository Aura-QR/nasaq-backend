import { PartialType } from '@nestjs/swagger';
import { CreateSubjectDto } from './create-subject.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {
  @IsBoolean()
  @IsOptional()
  @ApiProperty({ description: 'Whether the subject is required for promotion', required: false })
  isRequiredForPromotion?: boolean;
}
