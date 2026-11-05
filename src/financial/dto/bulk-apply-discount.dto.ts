import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsMongoId, IsOptional } from 'class-validator';

/** Apply one discount from the list to many students' tuition at once. */
export class BulkApplyDiscountDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty({ message: 'اختر طالبًا واحدًا على الأقل' })
  @ArrayMaxSize(1000)
  @IsMongoId({ each: true })
  studentIds: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsMongoId()
  academicYearId?: string;
}
