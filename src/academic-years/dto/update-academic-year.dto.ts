import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { CreateAcademicYearDto } from './create-academic-year.dto';

export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {
  @ApiProperty({ description: 'Wizard setup step progress (0-7)', required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(7)
  setupStep?: number;
}
