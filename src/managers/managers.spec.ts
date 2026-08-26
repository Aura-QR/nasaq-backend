import * as mongoose from 'mongoose';
import { ManagersService } from './managers.service';
import { AdminSchema } from 'src/admin/schemas/admin.schema';
import { TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { TenantContextService } from 'src/tenancy/tenant-context.service';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Managers Service Integration', () => {
  let adminModel: any;
  let teacherModel: any;
  let service: ManagersService;
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await mongoose.connect(mongoUri);

    try {
      adminModel = mongoose.model('TestAdmin', AdminSchema);
    } catch {
      adminModel = mongoose.model('TestAdmin');
    }

    try {
      teacherModel = mongoose.model('TestTeacher', TeacherSchema);
    } catch {
      teacherModel = mongoose.model('TestTeacher');
    }

    service = new ManagersService(adminModel, teacherModel);
  });

  afterAll(async () => {
    try {
      await adminModel.deleteMany({ schoolId: new mongoose.Types.ObjectId(schoolId) }).setOptions({ skipTenantScope: true });
      await teacherModel.deleteMany({ schoolId: new mongoose.Types.ObjectId(schoolId) }).setOptions({ skipTenantScope: true });
    } catch {}
    await mongoose.disconnect();
  });

  it('should create a manager admin without storing a per-account permission list', async () => {
    const dto = {
      username: 'testmanager',
      email: 'testmanager@school.com',
      password: 'password123',
      // Sent, but deliberately not stored: a manager's rights come from the
      // school's MANAGER row, resolved at login. Storing this would leave a
      // list on the document that nothing reads.
      permissions: ['school.students.read', 'school.classes.manage'],
    };

    await contextService.runWithTenant(schoolId, false, async () => {
      const manager = await service.createManagerAdmin(schoolId, dto);
      expect(manager.username).toEqual(dto.username);
      expect(manager.role).toEqual('MANAGER');
      expect(manager.permissions).toEqual([]);

      // Verify it exists in database
      const dbRecord = await adminModel.findById(manager.id);
      expect(dbRecord).toBeDefined();
      expect(dbRecord.schoolId.toString()).toEqual(schoolId);
      expect(dbRecord.permissions).toEqual([]);
    });
  });

  it('should still store ["*"] for a supervisor', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const supervisor = await service.createManagerAdmin(schoolId, {
        username: 'testsupervisor',
        email: 'testsupervisor@school.com',
        password: 'password123',
        role: 'SUPERVISOR',
      } as any);
      expect(supervisor.role).toEqual('SUPERVISOR');
      expect(supervisor.permissions).toEqual(['*']);
    });
  });

  it('should promote a teacher to manager', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      // Create a dummy teacher
      const teacher = await teacherModel.create({
        name: 'Teacher A',
        email: 'teachera@school.com',
        password: 'password123',
        hireDate: new Date(),
        isActive: true,
      });

      // Same reason as above: a promoted teacher merges the school's MANAGER
      // set on top of their teaching rights at login, so nothing is stored
      // here either.
      const promoted = await service.promoteTeacher(teacher._id.toString(), [
        'school.attendance.manage',
      ]);
      expect(promoted.isManager).toBe(true);
      expect(promoted.permissions).toEqual([]);

      const dbTeacher = await teacherModel.findById(teacher._id);
      expect(dbTeacher.isManager).toBe(true);
      expect(dbTeacher.managerPermissions).toEqual([]);
    });
  });

  it('should demote a teacher manager', async () => {
    await contextService.runWithTenant(schoolId, false, async () => {
      const teacher = await teacherModel.findOne({ email: 'teachera@school.com' });
      const demoted = await service.demoteTeacher(teacher._id.toString());
      expect(demoted.isManager).toBe(false);
      expect(demoted.permissions).toEqual([]);
    });
  });
});
