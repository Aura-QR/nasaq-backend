import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { Teacher, TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { Student, StudentSchema } from 'src/students/schemas/student.schema';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import jwtConfig from './config/jwt.config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CaslModule } from 'src/casl/casl.module';
import { PermissionsModule } from 'src/permissions/permissions.module';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    PassportModule,
    JwtModule.registerAsync(
     jwtConfig.asProvider()
    ),
    CaslModule,
    PermissionsModule,
    MongooseModule.forFeature([
      { name: Admin.name, schema: AdminSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Student.name, schema: StudentSchema },
    ])
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtStrategy, PassportModule]
})
export class AuthModule {}
