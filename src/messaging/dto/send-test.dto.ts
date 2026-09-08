import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendTestMessageDto {
  @ApiProperty({ example: '0501234567', description: 'أي صيغة — يتم توحيدها قبل الإرسال' })
  @IsString()
  @IsNotEmpty({ message: 'رقم الجوال مطلوب' })
  @MaxLength(25)
  phone: string;
}
