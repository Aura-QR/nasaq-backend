import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import databaseConfig from './config/database.config';
import { TenancyModule } from './tenancy/tenancy.module';
import { PlatformModule } from './platform/platform.module';
import { ManagersModule } from './managers/managers.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { StudentsModule } from './students/students.module';
import { AdminModule } from './admin/admin.module';
import { SubjectsModule } from './subjects/subjects.module';
import { TeachersModule } from './teachers/teachers.module';
import { ClassesModule } from './classes/classes.module';
import { LecturesModule } from './lectures/lectures.module';
import { LibraryModule } from './library/library.module';
import { AttendanceModule } from './attendance/attendance.module';
import { GradesCriteriaModule } from './grades-criteria/grades-criteria.module';
import { ExamsModule } from './exams/exams.module';
import { ProjectsModule } from './projects/projects.module';
import { AuthModule } from './auth/auth.module';
import { PreparationModule } from './preparation/preparation.module';
import { TasksModule } from './tasks/tasks.module';
import { FinancialModule } from './financial/financial.module';
import { ExpensesModule } from './expenses/expenses.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantGuard } from './tenancy/guards/tenant.guard';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        setHeaders: (res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
        },
      },
    }),
    TenancyModule,
    PlatformModule,
    ManagersModule,
    DashboardsModule,
    StudentsModule,
    AdminModule,
    SubjectsModule,
    TeachersModule,
    ClassesModule,
    LecturesModule,
    LibraryModule,
    AttendanceModule,
    GradesCriteriaModule,
    ExamsModule,
    ProjectsModule,
    AuthModule,
    PreparationModule,
    TasksModule,
    FinancialModule,
    ExpensesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guard chain — applied to EVERY route by default.
    // JwtAuthGuard verifies the JWT signature and populates request.user.
    // TenantGuard then enforces school-scoping / platform-route rules.
    // Both respect @Public() to allow genuinely public endpoints
    // (login, registration, health checks, password-setup flows).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
