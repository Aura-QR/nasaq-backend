import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'صيانة' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'أعمال الصيانة الدورية' })
  @IsString()
  @IsOptional()
  description?: string;
}
