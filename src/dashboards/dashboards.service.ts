import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { School } from 'src/platform/schools/schemas/school.schema';
import { Student } from 'src/students/schemas/student.schema';
import { Teacher } from 'src/teachers/schemas/teacher.schema';
import { Class } from 'src/classes/schemas/class.schema';
import { AcademicYear } from 'src/academic-years/schemas/academic-year.schema';
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
    @InjectModel(AcademicYear.name)
    private academicYearModel: Model<AcademicYear>,
    @InjectModel(Attendance.name) private attendanceModel: Model<Attendance>,
    @InjectModel(Expense.name) private expenseModel: Model<Expense>,
    @InjectModel(StudentFinancialRecord.name)
    private financialRecordModel: Model<StudentFinancialRecord>,
  ) {}

  /**
   * A class belongs to one academic year, so counting every class ever created
   * answers a question nobody asked. A school in its second year saw twenty-two
   * classes on a dashboard that shows eleven on the timetable — the old ones had
   * not gone anywhere, they had just stopped being this year's.
   *
   * Activating a year archives the rest (academic-years.service), so at most one
   * row comes back. A school with no active year has no current classes either,
   * which is what a null here means downstream.
   */
  private async getActiveYear(): Promise<{
    _id: Types.ObjectId;
    name: string;
  } | null> {
    const year = await this.academicYearModel
      .findOne({ status: 'active' })
      .select('_id name')
      .lean()
      .exec();

    return year ? { _id: year._id as Types.ObjectId, name: year.name } : null;
  }

  async getOwnerDashboard(schoolId: string) {
    const sId = new Types.ObjectId(schoolId);
    const activeYear = await this.getActiveYear();

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
      activeYear
        ? this.classModel.countDocuments({ academicYearId: activeYear._id })
        : Promise.resolve(0),
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
      academicYear: activeYear
        ? { id: activeYear._id, name: activeYear.name }
        : null,
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
        // This year's classes, not every class the school has ever had.
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
      const activeYear = await this.getActiveYear();
      const totalClasses = activeYear
        ? await this.classModel.countDocuments({ academicYearId: activeYear._id })
        : 0;
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
