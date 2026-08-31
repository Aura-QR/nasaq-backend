import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ApiTags } from '@nestjs/swagger';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { RequestPasswordSetupDto } from './dto/request-password-setup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('students')
@ApiTags('Students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) { }

  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create a new student' })
  @ApiResponse({ status: 201, description: 'Student created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Student already exists' })
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createStudentDto: CreateStudentDto) {
    return await this.studentsService.create(createStudentDto);
  }

  @ApiOperation({ summary: 'Get all students or filter with query params' })
  @ApiResponse({ status: 200, description: 'Students fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Students not found' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10, max: 100)' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll(@Query() queryParams: any) {
    const { page, limit, ...filters } = queryParams;
    const pagination: PaginationDto = { page, limit };
    return await this.studentsService.filtering(filters, pagination);
  }

  @ApiOperation({ summary: 'Get list for students' })
  @ApiResponse({ status: 200, description: 'List of students fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'List of students not found' })
  @Get('list')
  @HttpCode(HttpStatus.OK)
  async list() {
    return await this.studentsService.list();
  }

  @ApiOperation({ summary: 'Get the authenticated student profile' })
  @ApiResponse({ status: 200, description: 'Student profile fetched successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  async getMyProfile(@CurrentUser() user: any) {
    return await this.studentsService.getMyProfile(user.userId);
  }

  @ApiOperation({ summary: 'Get a student by ID' })
  @ApiResponse({ status: 200, description: 'Student fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(@Param('id') id: string) {
    return await this.studentsService.findOne(id);
  }

  @ApiOperation({ summary: 'Update a student' })
  @ApiResponse({ status: 200, description: 'Student updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateStudentDto: UpdateStudentDto,
  ) {
    return await this.studentsService.update(id, updateStudentDto);
  }

  @ApiOperation({ summary: 'Toggle active status of a student' })
  @ApiResponse({ status: 200, description: 'Student active status toggled successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  async toggleActive(@Param('id') id: string) {
    return await this.studentsService.toggleActive(id);
  }

  @ApiOperation({ summary: 'Delete a student' })
  @ApiResponse({ status: 200, description: 'Student deleted successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  @Roles(Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return await this.studentsService.remove(id);
  }

  @ApiOperation({ summary: 'طلب رمز OTP لإعادة تعيين كلمة المرور أو تعيينها لأول مرة (للطلاب)' })
  @ApiResponse({ status: 200, description: 'تم إرسال رمز التحقق إلى البريد الإلكتروني' })
  @ApiResponse({ status: 404, description: 'البريد الإلكتروني غير مسجل' })
  @Public()
  @Post('request-password-setup')
  @HttpCode(HttpStatus.OK)
  async requestPasswordSetup(@Body() body: RequestPasswordSetupDto) {
    return await this.studentsService.requestPasswordSetup(body.email);
  }

  @ApiOperation({ summary: 'تعيين أو إعادة تعيين كلمة المرور باستخدام رمز OTP (للطلاب)' })
  @ApiResponse({ status: 200, description: 'تم تغيير كلمة المرور بنجاح' })
  @ApiResponse({ status: 400, description: 'رمز التحقق غير صحيح أو منتهي الصلاحية' })
  @Public()
  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  async setPassword(@Body() body: SetPasswordDto) {
    return await this.studentsService.setPassword(body.email, body.otp, body.password);
  }
}
