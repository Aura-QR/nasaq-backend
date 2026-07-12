import { IsArray, IsMongoId, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AnswerDto {
  @IsMongoId()
  @ApiProperty({
    description: 'The ID of the question being answered',
    example: 'questionId',
  })
  questionId: string;

  @IsString()
  @ApiProperty({
    description: 'The student\'s answer',
    example: 'Paris',
  })
  answer: string;
}

export class SubmitAnswersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  @ApiProperty({
    description: 'Array of answers submitted by the student',
    type: [AnswerDto],
    example: [
      {
        questionId: 'questionId',
        answer: 'Paris',
      },
      {
        questionId: 'questionId',
        answer: '4',
      },
    ],
  })
  answers: AnswerDto[];
}
