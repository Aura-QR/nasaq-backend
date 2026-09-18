import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitLateReasonDto {
  @ApiProperty({
    description: "The teacher's own account of why they were late",
    example: 'ازدحام مروري على طريق المدرسة',
  })
  @IsString()
  @IsNotEmpty({ message: 'يُرجى كتابة سبب التأخير' })
  // Long enough to say something real, short enough that the director reads it.
  // Below three characters it is a keystroke to dismiss the dialog, not a reason.
  @MinLength(3, { message: 'يُرجى كتابة سبب التأخير' })
  @MaxLength(500, { message: 'سبب التأخير طويل جدًا' })
  reason: string;

  @ApiProperty({
    description: 'Which day, YYYY-MM-DD. Defaults to today.',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  date?: string;
}
