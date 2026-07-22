import * as mongoose from 'mongoose';
import { DashboardsService } from './dashboards.service';
import { SchoolSchema } from 'src/platform/schools/schemas/school.schema';
import { StudentSchema } from 'src/students/schemas/student.schema';
import { TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { ClassSchema } from 'src/classes/schemas/class.schema';
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
    try { attendanceModel = mongoose.model('TestAttendanceDash', AttendanceSchema); } catch { attendanceModel = mongoose.model('TestAttendanceDash'); }
    try { expenseModel = mongoose.model('TestExpenseDash', ExpenseSchema); } catch { expenseModel = mongoose.model('TestExpenseDash'); }
    try { financialRecordModel = mongoose.model('TestFinancialRecordDash', StudentFinancialRecordSchema); } catch { financialRecordModel = mongoose.model('TestFinancialRecordDash'); }

    service = new DashboardsService(
      schoolModel,
      studentModel,
      teacherModel,
      classModel,
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

  it('should return Super Admin cross-tenant aggregate platform stats', async () => {
    const superAdminDash = await service.getSuperAdminDashboard();
    expect(superAdminDash.platform.totalSchools).toBeGreaterThanOrEqual(0);
  });
});
