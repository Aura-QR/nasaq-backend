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
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginAdminDto } from './dto/login-admin.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new admin' })
  @ApiResponse({ status: 201, description: 'Admin registered successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 409, description: 'Username or email already exists' })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() createAdminDto: CreateAdminDto
  ) {
    return await this.adminService.register(createAdminDto)
  }

  @ApiOperation({ summary: 'Login an admin' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginAdminDto: LoginAdminDto
  ) {
    return await this.adminService.login(loginAdminDto)
  }

  @ApiOperation({ summary: 'Get all admins' })
  @ApiResponse({ status: 200, description: 'Admins fetched successfully' })
  @Get()
  @HttpCode(HttpStatus.OK)
  async findAll() {
    return await this.adminService.findAll()
  }

  @ApiOperation({ summary: 'Get an admin by ID' })
  @ApiResponse({ status: 200, description: 'Admin fetched successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async findOne(
    @Param('id') id: string
  ) {
    return await this.adminService.findOne(id)
  }

  @ApiOperation({ summary: 'Update an admin' })
  @ApiResponse({ status: 200, description: 'Admin updated successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateAdminDto: Partial<CreateAdminDto>,
  ) {
    return await this.adminService.update(id, updateAdminDto)
  }

  @ApiOperation({ summary: 'Delete an admin' })
  @ApiResponse({ status: 200, description: 'Admin deleted successfully' })
  @ApiResponse({ status: 404, description: 'Admin not found' })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string
) {
    return await this.adminService.remove(id)
  }
}