import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty } from 'class-validator';

export class ApplyDiscountDto {
  @ApiProperty({ example: '6650a1b2c3d4e5f6a7b8c9d0', description: 'Discount template ID' })
  @IsMongoId()
  @IsNotEmpty()
  discountId: string;
}
