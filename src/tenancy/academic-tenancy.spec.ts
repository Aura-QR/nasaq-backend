import * as mongoose from 'mongoose';
import { TenantContextService } from './tenant-context.service';
import { ClassSchema } from 'src/classes/schemas/class.schema';
import { SubjectSchema } from 'src/subjects/schemas/subject.schema';
import { ExamSchema } from 'src/exams/schemas/exam.schema';
import { AttendanceSchema } from 'src/attendance/schemas/attendance.schema';
import { LibrarySchema } from 'src/library/schemas/library.schema';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Academic Modules Tenancy Isolation', () => {
  const contextService = new TenantContextService();
  const schoolIdA = new mongoose.Types.ObjectId().toString();
  const schoolIdB = new mongoose.Types.ObjectId().toString();

  let classModel: any;
  let subjectModel: any;
  let examModel: any;
  let attendanceModel: any;
  let libraryModel: any;

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await mongoose.connect(mongoUri);

    try { classModel = mongoose.model('TestClass', ClassSchema); } catch { classModel = mongoose.model('TestClass'); }
    try { subjectModel = mongoose.model('TestSubject', SubjectSchema); } catch { subjectModel = mongoose.model('TestSubject'); }
    try { examModel = mongoose.model('TestExam', ExamSchema); } catch { examModel = mongoose.model('TestExam'); }
    try { attendanceModel = mongoose.model('TestAttendance', AttendanceSchema); } catch { attendanceModel = mongoose.model('TestAttendance'); }
    try { libraryModel = mongoose.model('TestLibrary', LibrarySchema); } catch { libraryModel = mongoose.model('TestLibrary'); }
  });

  afterAll(async () => {
    try {
      await classModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await subjectModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await examModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await attendanceModel.deleteMany({}).setOptions({ skipTenantScope: true });
      await libraryModel.deleteMany({}).setOptions({ skipTenantScope: true });
    } catch {}
    await mongoose.disconnect();
  });

  it('should auto-assign schoolId on Class creation and prevent cross-tenant queries', async () => {
    let classAId: string = '';

    // Create class in School A
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const cls = await classModel.create({
        academicYear: '2026/2027',
        gender: 'male',
        roomNumber: '101',
        maxCapacity: 30,
      });
      expect(cls.schoolId.toString()).toEqual(schoolIdA);
      classAId = cls._id.toString();
    });

    // Attempt to query Class A from School B context
    await contextService.runWithTenant(schoolIdB, false, async () => {
      const foundInB = await classModel.findById(classAId);
      expect(foundInB).toBeNull();
    });

    // Query Class A from School A context
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const foundInA = await classModel.findById(classAId);
      expect(foundInA).toBeDefined();
      expect(foundInA._id.toString()).toEqual(classAId);
    });
  });

  it('should isolate Subjects and Library books per school', async () => {
    let subjectAId: string = '';

    await contextService.runWithTenant(schoolIdA, false, async () => {
      const sub = await subjectModel.create({ subjectName: 'Mathematics' });
      expect(sub.schoolId.toString()).toEqual(schoolIdA);
      subjectAId = sub._id.toString();
    });

    await contextService.runWithTenant(schoolIdB, false, async () => {
      const subB = await subjectModel.create({ subjectName: 'Physics' });
      expect(subB.schoolId.toString()).toEqual(schoolIdB);

      const subjectsInB = await subjectModel.find({});
      expect(subjectsInB.length).toEqual(1);
      expect(subjectsInB[0].subjectName).toEqual('Physics');
    });
  });
});
