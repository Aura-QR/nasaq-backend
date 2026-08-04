import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ExamsService } from './exams.service';
import { CreateExamDto, QuestionDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { SubmitAnswersDto } from './dto/submit-answers.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AbilitiesGuard } from 'src/casl/guards/abilities.guard';
import { CheckAbilities } from 'src/casl/decorators/check-abilities.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('exams')
@UseGuards(JwtAuthGuard, AbilitiesGuard)
@ApiTags('Exams')
@ApiBearerAuth()
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  @ApiOperation({ summary: 'Create a new exam' })
  @ApiResponse({ status: 201, description: 'Exam created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Exam already exists' })
  @Post()
  @CheckAbilities({ action: 'create', subject: 'Exam' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: any,
    @Body() createExamDto: CreateExamDto) {
      console.log(user)
    return await this.examsService.create(createExamDto, user);
  }

  @ApiOperation({ summary: 'Get exams for the authenticated student' })
  @ApiResponse({ status: 200, description: 'Student exams fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @ApiQuery({ name: 'examType', required: false, type: String, description: 'Filter by exam type (quiz, assignment, activity, final)' })
  @ApiQuery({ name: 'subjectOfferingId', required: false, type: String, description: 'Filter by SubjectOffering ID' })
  @ApiQuery({ name: 'gradesCriteriaId', required: false, type: String, description: 'Filter by grades criteria ID' })
  @ApiQuery({ name: 'status', required: false, enum: ['upcoming', 'available', 'expired'], description: 'Filter by exam status' })
  @Get('student/me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMyExams(@CurrentUser() user: any, @Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    return await this.examsService.getMyExams(user.userId, filters, { page, limit });
  }

  @ApiOperation({ summary: 'Get all exams or filter with query params' })
  @ApiResponse({ status: 200, description: 'Exams fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exams not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @Get()
  @CheckAbilities({ action: 'read', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async findAll( @CurrentUser() user: any,
    @Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination = { page, limit };
    return await this.examsService.filtering(filters, pagination,user);
  }

  @ApiOperation({ summary: 'Edit a student exam grade (Teacher only — must teach this subject in the student class)' })
  @ApiResponse({ status: 200, description: 'Grade updated successfully' })
  @ApiResponse({ status: 403, description: 'Teacher does not teach this subject in the student class' })
  @ApiResponse({ status: 404, description: 'Exam, student, or result not found' })
  @Patch(':examId/students/:studentId/grade')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async editStudentGrade(
    @Param('examId') examId: string,
    @Param('studentId') studentId: string,
    @Body('achievedGrade') achievedGrade: number,
    @CurrentUser() user: any,
  ) {
    return await this.examsService.editStudentGrade(examId, studentId, achievedGrade, user);
  }

  @ApiOperation({ summary: 'Delete all exams (Admin only)' })
  @ApiResponse({ status: 200, description: 'All exams deleted successfully' })
  @Delete('deleteAll')
  @HttpCode(HttpStatus.OK)
  async deleteAll() {
    return await this.examsService.deleteAll();
  }

  @ApiOperation({ summary: 'Get exam by ID' })
  @ApiResponse({ status: 200, description: 'Exam fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam not found' })
  @Get(':id')
  @CheckAbilities({ action: 'read', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.examsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update exam' })
  @ApiResponse({ status: 200, description: 'Exam updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam not found' })
  @Patch(':id')
  @CheckAbilities({ action: 'update', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() updateExamDto: UpdateExamDto, @CurrentUser() user: any) {
    return await this.examsService.update(id, updateExamDto, user);
  }

  @ApiOperation({ summary: 'Delete exam' })
  @ApiResponse({ status: 200, description: 'Exam deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam not found' })
  @Delete(':id')
  @CheckAbilities({ action: 'delete', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return await this.examsService.remove(id, user);
  }

  @ApiOperation({ summary: 'Add a question to an exam' })
  @ApiResponse({ status: 201, description: 'Question added successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam not found' })
  @Post(':examId/questions')
  @CheckAbilities({ action: 'update', subject: 'Exam' })
  @HttpCode(HttpStatus.CREATED)
  async addQuestion(
    @Param('examId') examId: string,
    @Body() questionDto: QuestionDto,
  ) {
    return await this.examsService.addQuestion(examId, questionDto);
  }

  @ApiOperation({ summary: 'Update a question in an exam' })
  @ApiResponse({ status: 200, description: 'Question updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam or question not found' })
  @Patch(':examId/questions/:questionId')
  @CheckAbilities({ action: 'update', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async updateQuestion(
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
  ) {
    return await this.examsService.updateQuestion(examId, questionId, updateQuestionDto);
  }

  @ApiOperation({ summary: 'Delete a question from an exam' })
  @ApiResponse({ status: 200, description: 'Question deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Exam or question not found' })
  @Delete(':examId/questions/:questionId')
  @CheckAbilities({ action: 'delete', subject: 'Exam' })
  @HttpCode(HttpStatus.OK)
  async deleteQuestion(
    @Param('examId') examId: string,
    @Param('questionId') questionId: string,
  ) {
    return await this.examsService.deleteQuestion(examId, questionId);
  }


  @ApiOperation({ summary: 'Start an exam — records startedAt and returns remaining seconds' })
  @ApiResponse({ status: 200, description: 'Exam started successfully' })
  @ApiResponse({ status: 400, description: 'Exam not in window or already submitted' })
  @Post(':examId/start')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startExam(
    @Param('examId') examId: string,
    @CurrentUser() user: any,
  ) {
    return await this.examsService.startExam(examId, user);
  }

  @ApiOperation({ summary: 'Grade an exam by submitting answers' })
  @ApiResponse({
    status: 200,
    description: 'Exam graded successfully. Returns detailed results including correct/incorrect answers, percentage, and final grade based on exam type.',
    schema: {
      example: {
        examId: 'examId',
        examType: 'final',
        totalQuestions: 2,
        answeredQuestions: 2,
        correctAnswers: 2,
        incorrectAnswers: 0,
        percentage: 100,
        maxGrade: 50,
        achievedGrade: 50,
        results: [
          {
            questionId: 'questionId',
            studentAnswer: 'Paris',
            correctAnswer: 'Paris',
            isCorrect: true,
          },
          {
            questionId: 'questionId',
            studentAnswer: '4',
            correctAnswer: '4',
            isCorrect: true,
          },
        ],
        passed: true,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid question ID or answer format' })
  @ApiResponse({ status: 404, description: 'Exam not found' })
  @Post(':examId/grade')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async gradeExam(
    @Param('examId') examId: string,
    @Body() submitAnswersDto: SubmitAnswersDto,
    @CurrentUser() user: any,
  ) {
    return await this.examsService.gradeExam(examId, submitAnswersDto, user);
  }

}
