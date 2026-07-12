import { IsOptional, IsMongoId } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePreparationDto {
  @ApiProperty({
    description: 'Lecture ID',
    example: '507f1f77bcf86cd799439011',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  lecture?: string;
}
