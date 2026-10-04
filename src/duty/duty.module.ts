import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DutyController } from './duty.controller';
import { DutyService } from './duty.service';
import { LeaveRequest, LeaveRequestSchema } from './schemas/leave-request.schema';
import {
  DutySupervisor,
  DutySupervisorSchema,
} from './schemas/duty-supervisor.schema';
import { Substitution, SubstitutionSchema } from './schemas/substitution.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import {
  TeacherAttendance,
  TeacherAttendanceSchema,
} from '../teacher-attendance/schemas/teacher-attendance.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import {
  StaffAttendance,
  StaffAttendanceSchema,
} from '../staff-attendance/schemas/staff-attendance.schema';
import {
  StaffLeaveRequest,
  StaffLeaveRequestSchema,
} from '../staff-attendance/schemas/staff-leave-request.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeaveRequest.name, schema: LeaveRequestSchema },
      { name: DutySupervisor.name, schema: DutySupervisorSchema },
      { name: Substitution.name, schema: SubstitutionSchema },
      { name: Teacher.name, schema: TeacherSchema },
      { name: Lecture.name, schema: LectureSchema },
      { name: TeacherAttendance.name, schema: TeacherAttendanceSchema },
      { name: Term.name, schema: TermSchema },
      // Registered so the cover board's populate of class and subject names
      // resolves without depending on another module having loaded first.
      { name: Class.name, schema: ClassSchema },
      { name: Subject.name, schema: SubjectSchema },
      { name: SubjectOffering.name, schema: SubjectOfferingSchema },
      // Supervisors and managers in the cover pool: who they are, whether
      // they checked in, and whether they are on leave.
      { name: Admin.name, schema: AdminSchema },
      { name: StaffAttendance.name, schema: StaffAttendanceSchema },
      { name: StaffLeaveRequest.name, schema: StaffLeaveRequestSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [DutyController],
  providers: [DutyService],
  exports: [DutyService, MongooseModule],
})
export class DutyModule {}
