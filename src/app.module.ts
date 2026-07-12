import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join } from 'path';
import databaseConfig from './config/database.config';
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
          res.removeHeader('Access-Control-Allow-Origin');
        },
      },
    }),
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
})
export class AppModule {}
