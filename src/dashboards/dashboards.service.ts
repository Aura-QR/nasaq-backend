import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from 'src/platform/schools/schemas/school.schema';
import { Student } from 'src/students/schemas/student.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { Class } from 'src/classes/schemas/class.schema';
import { Attendance } from 'src/attendance/schemas/attendance.schema';
import { Expense } from 'src/expenses/schemas/expense.schema';
import { StudentFinancialRecord } from 'src/financial/schemas/student-financial-record.schema';

@Injectable()
export class DashboardsService {
  constructor(
    @InjectModel(School.name) private schoolModel: Model<School>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Teacher.name) private teacherModel: Model<Teacher>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(Attendance.name) private attendanceModel: Model<Attendance>,
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(StudentFinancialRecord.name)
    private financialRecordModel: Model<StudentFinancialRecord>,
  ) {}

  async getOwnerDashboard(schoolId: string) {
    const sId = new Types.ObjectId(schoolId);

    const [
      totalStudents,
      activeStudents,
      totalTeachers,
      totalClasses,
      school,
      expensesAggregate,
      financialRecords,
      todayAttendanceCount,
    ] = await Promise.all([
      this.studentModel.countDocuments(),
      this.studentModel.countDocuments({ isActive: true }),
      this.teacherModel.countDocuments(),
      this.classModel.countDocuments(),
      this.schoolModel.findById(schoolId).setOptions({ skipTenantScope: true }).lean(),
      this.expenseModel.aggregate([
        { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
      ]),
      this.financialRecordModel.find().lean(),
      this.getTodayAttendanceCount(),
    ]);

    const totalExpenses = expensesAggregate[0]?.totalAmount || 0;

    let totalTuitionCollected = 0;
    financialRecords.forEach((rec: any) => {
      totalTuitionCollected += rec.tuition?.totalPaid || 0;
      totalTuitionCollected += rec.bus?.totalPaid || 0;
    });

    const netIncome = totalTuitionCollected - totalExpenses;

    return {
      school: {
        id: school?._id,
        name: (school as any)?.name,
        slug: (school as any)?.slug,
        subscriptionStatus: (school as any)?.subscriptionStatus,
        isActive: (school as any)?.isActive,
      },
      counts: {
        students: totalStudents,
        activeStudents,
        teachers: totalTeachers,
        classes: totalClasses,
      },
      financialSummary: {
        totalRevenue: totalTuitionCollected,
        totalExpenses,
        netIncome,
      },
      attendanceToday: todayAttendanceCount,
    };
  }

  async getManagerDashboard(userPermissions: string[]) {
    const isOwnerOrAll = userPermissions.includes('*');
    const result: any = {
      permissions: userPermissions,
      metrics: {},
    };

    if (isOwnerOrAll || userPermissions.includes('school.students.read')) {
      const [totalStudents, activeStudents] = await Promise.all([
        this.studentModel.countDocuments(),
        this.studentModel.countDocuments({ isActive: true }),
      ]);
      result.metrics.students = { totalStudents, activeStudents };
    }

    if (isOwnerOrAll || userPermissions.includes('school.teachers.manage')) {
      const totalTeachers = await this.teacherModel.countDocuments();
      result.metrics.teachers = { totalTeachers };
    }

    if (isOwnerOrAll || userPermissions.includes('school.classes.manage')) {
      const totalClasses = await this.classModel.countDocuments();
      result.metrics.classes = { totalClasses };
    }

    if (isOwnerOrAll || userPermissions.includes('school.attendance.manage')) {
      const todayAttendance = await this.getTodayAttendanceCount();
      result.metrics.attendanceToday = todayAttendance;
    }

    if (isOwnerOrAll || userPermissions.includes('school.financial.manage')) {
      const [expensesAgg, financialRecords] = await Promise.all([
        this.expenseModel.aggregate([
          { $group: { _id: null, totalAmount: { $sum: '$amount' } } },
        ]),
        this.financialRecordModel.find().lean(),
      ]);

      const totalExpenses = expensesAgg[0]?.totalAmount || 0;
      let totalCollected = 0;
      financialRecords.forEach((rec: any) => {
        totalCollected += rec.tuition?.totalPaid || 0;
        totalCollected += rec.bus?.totalPaid || 0;
      });

      result.metrics.financial = {
        totalRevenue: totalCollected,
        totalExpenses,
        netIncome: totalCollected - totalExpenses,
      };
    }

    return result;
  }

  async getSuperAdminDashboard() {
    const [
      totalSchools,
      activeSchools,
      suspendedSchools,
      totalStudents,
      totalTeachers,
      subscriptionsBreakdown,
    ] = await Promise.all([
      this.schoolModel.countDocuments().setOptions({ skipTenantScope: true }),
      this.schoolModel.countDocuments({ isActive: true }).setOptions({ skipTenantScope: true }),
      this.schoolModel.countDocuments({ isActive: false }).setOptions({ skipTenantScope: true }),
      this.studentModel.countDocuments().setOptions({ skipTenantScope: true }),
      this.teacherModel.countDocuments().setOptions({ skipTenantScope: true }),
      this.schoolModel.aggregate([
        { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } },
      ], { skipTenantScope: true }),
    ]);

    const subscriptions: Record<string, number> = {};
    subscriptionsBreakdown.forEach((item: any) => {
      subscriptions[item._id || 'unknown'] = item.count;
    });

    return {
      platform: {
        totalSchools,
        activeSchools,
        suspendedSchools,
        totalPlatformStudents: totalStudents,
        totalPlatformTeachers: totalTeachers,
        subscriptions,
      },
    };
  }

  private async getTodayAttendanceCount() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const records = await this.attendanceModel.countDocuments({
      date: { $gte: startOfDay, $lte: endOfDay },
    });

    return records;
  }
}
