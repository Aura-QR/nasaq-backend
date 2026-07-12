import { IsNotEmpty, IsMongoId, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAttendanceDto {

  @IsNotEmpty()
  @ApiProperty({ description: 'The student ID' })
  @IsMongoId()
  studentId: string;


  @IsNotEmpty()
  @ApiProperty({ description: 'The class ID' })
  @IsMongoId()
  classId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in format YYYY-MM-DD (e.g., 2025-11-18)',
  })
  @IsNotEmpty()
  @ApiProperty({
    description: 'The attendance date in YYYY-MM-DD format',
    example: '2025-11-18',
  })
  date: string;
}
