import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestPasswordSetupDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @ApiProperty({ description: 'Student personal email registered by admin' })
  email: string;
}
