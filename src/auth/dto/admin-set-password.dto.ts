import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH_MESSAGE } from '../constants/password.constants';

export class AdminSetPasswordDto {
  @ApiPropertyOptional({
    description: 'Password to set; omit to generate an 8-character password',
    minLength: 6,
  })
  @IsOptional()
  @IsString()
  @MinLength(6, { message: PASSWORD_MIN_LENGTH_MESSAGE })
  password?: string;
}
