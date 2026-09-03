import * as mongoose from 'mongoose';
import { DashboardsService } from './dashboards.service';
import { SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { StudentSchema } from 'src/students/schemas/student.schema';
import { TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { ClassSchema } from 'src/classes/schemas/class.schema';
import { AcademicYearSchema } from 'src/academic-years/schemas/academic-year.schema';
import { AttendanceSchema } from 'src/attendance/schemas/attendance.schema';
import { ExpenseSchema } from 'src/expenses/schemas/expense.schema';
import { StudentFinancialRecordSchema } from 'src/financial/schemas/student-financial-record.schema';
import { TenantContextService } from 'src/tenancy/tenant-context.service';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Dashboards Service Integration', () => {
  const contextService = new TenantContextService();
  const schoolIdA = new mongoose.Types.ObjectId().toString();
  const schoolIdB = new mongoose.Types.ObjectId().toString();

  let schoolModel: any;
  let studentModel: any;
  let teacherModel: any;
  let classModel: any;
  let academicYearModel: any;
  let attendanceModel: any;
  let expenseModel: any;
  let financialRecordModel: any;
  let service: DashboardsService;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await mongoose.connect(mongoUri);

    try { schoolModel = mongoose.model('TestSchoolDash', SchoolSchema); } catch { schoolModel = mongoose.model('TestSchoolDash'); }
    try { studentModel = mongoose.model('TestStudentDash', StudentSchema); } catch { studentModel = mongoose.model('TestStudentDash'); }
    try { teacherModel = mongoose.model('TestTeacherDash', TeacherSchema); } catch { teacherModel = mongoose.model('TestTeacherDash'); }
    try { classModel = mongoose.model('TestClassDash', ClassSchema); } catch { classModel = mongoose.model('TestClassDash'); }
    try { academicYearModel = mongoose.model('TestAcademicYearDash', AcademicYearSchema); } catch { academicYearModel = mongoose.model('TestAcademicYearDash'); }
    try { attendanceModel = mongoose.model('TestAttendanceDash', AttendanceSchema); } catch { attendanceModel = mongoose.model('TestAttendanceDash'); }
    try { expenseModel = mongoose.model('TestExpenseDash', ExpenseSchema); } catch { expenseModel = mongoose.model('TestExpenseDash'); }
    try { financialRecordModel = mongoose.model('TestFinancialRecordDash', StudentFinancialRecordSchema); } catch { financialRecordModel = mongoose.model('TestFinancialRecordDash'); }

    service = new DashboardsService(
      schoolModel,
      studentModel,
      teacherModel,
      classModel,
      academicYearModel,
      attendanceModel,
      expenseModel,
      financialRecordModel,
    );
  });

  afterAll(async () => {
    try {
      await schoolModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await studentModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await teacherModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await classModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await academicYearModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await attendanceModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await expenseModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await financialRecordModel.deleteMany({}).setOptions({ skipTenantScope: true });
    } catch {}
    await mongoose.disconnect();
  });

  it('should return isolated Owner dashboard metrics for School A', async () => {
    await contextService.runWithTenant(schoolIdA, false, async () => {
      await studentModel.create({
        firstName: 'Ali',
        fatherName: 'Ahmed',
        familyName: 'Salem',
        birthDate: new Date(),
        gender: 'male',
        nationality: 'Saudi',
        academicYear: '2026/2027',
        phoneNumber: '0500000000',
        email: 'ali@schoola.com',
        address: 'Riyadh',
        isActive: true,
      });

      const dash = await service.getOwnerDashboard(schoolIdA);
      expect(dash.counts.students).toEqual(1);
    });
  });

  it('should dynamically filter Manager dashboard metrics based on permissions', async () => {
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const studentOnlyDash = await service.getManagerDashboard(['school.students.read']);
      expect(studentOnlyDash.metrics.students).toBeDefined();
      expect(studentOnlyDash.metrics.teachers).toBeUndefined();
      expect(studentOnlyDash.metrics.financial).toBeUndefined();
    });
  });

  it('counts this year\'s classes, not last year\'s as well', async () => {
    await contextService.runWithTenant(schoolIdB, false, async () => {
      const archived = await academicYearModel.create({
        name: '1447',
        startDate: new Date('2025-08-01'),
        endDate: new Date('2026-06-01'),
        status: 'archived',
      });

      const active = await academicYearModel.create({
        name: '1448',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-01'),
        status: 'active',
      });

      // Two classes carried over from a year nobody is teaching any more,
      // three that the school actually runs today.
      const gradeLevelId = new mongoose.Types.ObjectId();
      for (const [name, yearId] of [
        ['old-a', archived._id],
        ['old-b', archived._id],
        ['now-a', active._id],
        ['now-b', active._id],
        ['now-c', active._id],
      ] as [string, any][]) {
        await classModel.create({
          name,
          gradeLevelId,
          academicYearId: yearId,
          gender: 'male',
          maxCapacity: 30,
        });
      }

      const dash = await service.getOwnerDashboard(schoolIdB);

      expect(dash.counts.classes).toEqual(3);
      expect(dash.academicYear?.name).toEqual('1448');

      // The manager dashboard reads the same number the owner does.
      const managerDash = await service.getManagerDashboard(['school.classes.manage']);
      expect(managerDash.metrics.classes.totalClasses).toEqual(3);
    });
  });

  it('reports no classes rather than every class when no year is active', async () => {
    const schoolIdC = new mongoose.Types.ObjectId().toString();

    await contextService.runWithTenant(schoolIdC, false, async () => {
      const orphanYear = await academicYearModel.create({
        name: 'archived-only',
        startDate: new Date('2025-08-01'),
        endDate: new Date('2026-06-01'),
        status: 'archived',
      });

      await classModel.create({
        name: 'stranded',
        gradeLevelId: new mongoose.Types.ObjectId(),
        academicYearId: orphanYear._id,
        gender: 'female',
        maxCapacity: 30,
      });

      const dash = await service.getOwnerDashboard(schoolIdC);

      expect(dash.counts.classes).toEqual(0);
      expect(dash.academicYear).toBeNull();
    });

    await classModel.deleteMany({ name: 'stranded' }).setOptions({ skipTenantScope: true });
    await academicYearModel.deleteMany({ name: 'archived-only' }).setOptions({ skipTenantScope: true });
  });

  it('should return Super Admin cross-tenant aggregate platform stats', async () => {
    const superAdminDash = await service.getSuperAdminDashboard();
    expect(superAdminDash.platform.totalSchools).toBeGreaterThanOrEqual(0);
  });
});
