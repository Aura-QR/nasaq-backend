import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DEVICE_PLATFORMS, DevicePlatform } from '../schemas/device-token.schema';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'The FCM registration token from the app' })
  @IsString()
  @IsNotEmpty({ message: 'رمز الجهاز مطلوب' })
  token: string;

  @ApiPropertyOptional({ enum: DEVICE_PLATFORMS, default: 'android' })
  @IsOptional()
  @IsIn(DEVICE_PLATFORMS as unknown as string[])
  platform?: DevicePlatform;
}
