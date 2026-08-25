import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class EnrollBusDto {
  @ApiProperty({ description: 'Bus Plan ID to enroll the student in' })
  @IsMongoId()
  busPlanId: string;
}

