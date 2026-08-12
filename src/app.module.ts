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
import { AcademicYearsModule } from './academic-years/academic-years.module';
import { TermsModule } from './terms/terms.module';
import { StagesModule } from './stages/stages.module';
import { GradeLevelsModule } from './grade-levels/grade-levels.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { SubjectOfferingsModule } from './subject-offerings/subject-offerings.module';
import { TeacherAssignmentsModule } from './teacher-assignments/teacher-assignments.module';
import { TeacherAttendanceModule } from './teacher-attendance/teacher-attendance.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { TenantGuard } from './tenancy/guards/tenant.guard';
import { CaslModule } from './casl/casl.module';
import { AbilitiesGuard } from './casl/guards/abilities.guard';



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
    TeacherAttendanceModule,
    GradesCriteriaModule,
    ExamsModule,
    ProjectsModule,
    AuthModule,
    PreparationModule,
    TasksModule,
    FinancialModule,
    ExpensesModule,
    AcademicYearsModule,
    TermsModule,
    StagesModule,
    GradeLevelsModule,
    EnrollmentsModule,
    SubjectOfferingsModule,
    TeacherAssignmentsModule,
    CaslModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Global guard chain — applied to EVERY route by default.
    // JwtAuthGuard verifies the JWT signature and populates request.user.
    // TenantGuard then enforces school-scoping / platform-route rules.
    // Both respect @Public() to allow genuinely public endpoints
    // (login, registration, health checks, password-setup flows).
    //
    // AbilitiesGuard is global so that @CheckAbilities works wherever it is
    // written. It returns true immediately when a handler carries no
    // @CheckAbilities metadata, so routes without it are unaffected — but a
    // route that DOES declare abilities can no longer be left unenforced just
    // because its controller forgot @UseGuards(AbilitiesGuard). That silent
    // failure mode left POST /attendance wide open.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: AbilitiesGuard },
  ],
})
export class AppModule {}
