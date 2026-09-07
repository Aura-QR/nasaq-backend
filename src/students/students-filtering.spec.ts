import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { StudentsService } from './students.service';
import { Student, StudentSchema } from './schemas/student.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Enrollment, EnrollmentSchema } from '../enrollments/schemas/enrollment.schema';
import { AcademicYear, AcademicYearSchema } from '../academic-years/schemas/academic-year.schema';
import { Counter, CounterSchema } from '../Counter/Schema/counter.schema';
import {
  StudentFinancialRecord,
  StudentFinancialRecordSchema,
} from '../financial/schemas/student-financial-record.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';

dotenv.config();

describe('StudentsService academic-year filtering', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();

  let studentModel: any;
  let classModel: any;
  let enrollmentModel: any;
  let academicYearModel: any;
  let counterModel: any;
  let financialRecordModel: any;
  let service: StudentsService;
  let activeYearId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await mongoose.connect(mongoUri);

    studentModel = mongoose.models[Student.name] || mongoose.model(Student.name, StudentSchema);
    classModel = mongoose.models[Class.name] || mongoose.model(Class.name, ClassSchema);
    enrollmentModel = mongoose.models[Enrollment.name] || mongoose.model(Enrollment.name, EnrollmentSchema);
    academicYearModel = mongoose.models[AcademicYear.name] || mongoose.model(AcademicYear.name, AcademicYearSchema);
    counterModel = mongoose.models[Counter.name] || mongoose.model(Counter.name, CounterSchema);
    financialRecordModel = mongoose.models[StudentFinancialRecord.name]
      || mongoose.model(StudentFinancialRecord.name, StudentFinancialRecordSchema);

    service = new StudentsService(
      studentModel,
      classModel,
      counterModel,
      enrollmentModel,
      financialRecordModel,
      {} as any,
      {} as any,
      {} as any,
    );

    await contextService.runWithTenant(schoolId, false, async () => {
      const previousYear = await academicYearModel.create({
        name: '2025/2026',
        startDate: new Date('2025-08-01'),
        endDate: new Date('2026-06-01'),
        status: 'archived',
      });
      const activeYear = await academicYearModel.create({
        name: '2026/2027',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-01'),
        status: 'active',
      });
      activeYearId = activeYear._id;

      const gradeLevelId = new mongoose.Types.ObjectId();
      const previousClass = await classModel.create({
        name: 'previous',
        gradeLevelId,
        academicYearId: previousYear._id,
        gender: 'male',
        maxCapacity: 30,
      });
      const currentClass = await classModel.create({
        name: 'current',
        gradeLevelId,
        academicYearId: activeYear._id,
        gender: 'male',
        maxCapacity: 30,
      });

      const createStudent = (firstName: string, classId?: mongoose.Types.ObjectId) =>
        studentModel.create({
          firstName,
          fatherName: 'Test',
          familyName: 'Student',
          birthDate: new Date('2015-01-01'),
          gender: 'male',
          phoneNumber: `050${Math.random()}`,
          email: `${firstName.toLowerCase()}@example.test`,
          address: 'Riyadh',
          classId,
          isActive: true,
        });

      const current = await createStudent('Current', currentClass._id);
      const previous = await createStudent('Previous', previousClass._id);
      const withdrawn = await createStudent('Withdrawn', currentClass._id);
      // A stale class field must not prevent the explicit unplaced flag. The
      // enrollment collection, not Student.classId, is the source of truth.
      const unplaced = await createStudent('Unplaced', previousClass._id);

      await enrollmentModel.create([
        {
          studentId: current._id,
          classId: currentClass._id,
          academicYearId: activeYear._id,
          status: 'active',
        },
        {
          studentId: previous._id,
          classId: previousClass._id,
          academicYearId: previousYear._id,
          status: 'active',
        },
        {
          studentId: withdrawn._id,
          classId: currentClass._id,
          academicYearId: activeYear._id,
          status: 'withdrawn',
        },
      ]);

      expect(unplaced).toBeDefined();
    });
  });

  afterAll(async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      await enrollmentModel.deleteMany({});
      await studentModel.deleteMany({});
      await classModel.deleteMany({});
      await academicYearModel.deleteMany({});
    });
    await mongoose.disconnect();
  });

  it('includes active enrollments in the selected year and excludes prior-year-only students', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const students = await service.filtering({ academicYearId: activeYearId }) as any[];
      expect(students.map((student: any) => student.firstName).sort()).toEqual([
        'Current',
        'Unplaced',
      ]);
    });
  });

  it('marks students with no enrollment as unplaced', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const students = await service.filtering({ academicYearId: activeYearId }) as any[];
      const unplaced = students.find((student: any) => student.firstName === 'Unplaced');
      const current = students.find((student: any) => student.firstName === 'Current');

      expect(unplaced?.isUnplaced).toBe(true);
      expect(current?.isUnplaced).toBe(false);
    });
  });

  it('excludes a withdrawn enrollment in the selected year', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const students = await service.filtering({ academicYearId: activeYearId }) as any[];
      expect(students.some((student: any) => student.firstName === 'Withdrawn')).toBe(false);
    });
  });

  it('keeps the legacy all-students behavior when no academic year is supplied', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const students = await service.filtering({}) as any[];
      expect(students).toHaveLength(4);
      expect(students.every((student: any) => student.isUnplaced === undefined)).toBe(true);
    });
  });
});
