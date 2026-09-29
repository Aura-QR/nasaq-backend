import { PermissionsService } from './permissions.service';

describe('PermissionsService — Automatic Backfill & Merging of Defaults', () => {
  let service: PermissionsService;
  let mockModel: any;

  beforeEach(() => {
    mockModel = {
      collection: {
        indexes: jest.fn().mockResolvedValue([]),
      },
      syncIndexes: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
      findOne: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    service = new PermissionsService(mockModel as any);
  });

  describe('ensureDefaultsMerged', () => {
    it('should backfill missing keys (financial, financialSettings) into a stale permission document', async () => {
      const staleDoc: any = {
        _id: 'doc-123',
        role: 'MANAGER',
        permissions: {
          students: { read: true, add: true, edit: true, delete: true },
          teachers: { read: true, add: true, edit: true, delete: true },
        },
      };

      const result = await service.ensureDefaultsMerged(staleDoc, 'MANAGER');

      expect(result.permissions.financial).toEqual({
        read: true,
        add: true,
        edit: true,
        delete: true,
      });
      expect(result.permissions.financialSettings).toEqual({
        read: true,
        add: false,
        edit: false,
        delete: false,
      });
      expect(result.permissions.students).toEqual({
        read: true,
        add: true,
        edit: true,
        delete: true,
      });

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: 'doc-123' },
        { $set: { permissions: expect.any(Object) } },
      );
    });

    it('should NOT overwrite existing explicitly set permissions when merging', async () => {
      const customDoc: any = {
        _id: 'doc-456',
        role: 'MANAGER',
        permissions: {
          students: { read: true, add: false, edit: false, delete: false },
          financial: { read: true, add: false, edit: false, delete: false },
        },
      };

      const result = await service.ensureDefaultsMerged(customDoc, 'MANAGER');

      expect(result.permissions.students.add).toBe(false);
      expect(result.permissions.financial.add).toBe(false);
      expect(result.permissions.financialSettings).toEqual({
        read: true,
        add: false,
        edit: false,
        delete: false,
      });
    });
  });

  describe('getFlatPermissions', () => {
    it('should return correct flat permissions strings for MANAGER including financial and financialSettings', async () => {
      const storedDoc: any = {
        _id: 'doc-mgr',
        role: 'MANAGER',
        permissions: {
          students: { read: true, add: true, edit: true, delete: true },
          financial: { read: true, add: true, edit: true, delete: true },
          financialSettings: { read: true, add: false, edit: false, delete: false },
        },
      };

      mockModel.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(storedDoc),
      });

      const perms = await service.getFlatPermissions('MANAGER', '507f1f77bcf86cd799439011');

      expect(perms).toContain('school.financial.read');
      expect(perms).toContain('school.financial.create');
      expect(perms).toContain('school.financial.update');
      expect(perms).toContain('school.financial.delete');
      expect(perms).toContain('school.financialSettings.read');
      expect(perms).not.toContain('school.financialSettings.create');
      expect(perms).not.toContain('school.financialSettings.update');
      expect(perms).not.toContain('school.financialSettings.delete');
    });
  });

  /**
   * سجل المتابعة اليومي reached production before this key existed, so every
   * school already had a stored TEACHER row without it and every save came
   * back «ليس لديك صلاحية للقيام بهذا الإجراء».
   *
   * The fix is the key in default-permissions, not a migration: existing rows
   * are backfilled on boot by onModuleInit. These pin that down, and pin the
   * shape of the grant — a teacher must not be able to delete an observation.
   */
  describe('dailyTracking', () => {
    const teacherRowWithout = () => ({
      _id: 'doc-teacher',
      role: 'TEACHER',
      permissions: {
        // A real pre-release row: attendance is there, tracking is not.
        attendance: { read: false, add: true, edit: true, delete: true },
        preparation: { read: true, add: true, edit: true, delete: true },
      },
      markModified: jest.fn(),
      save: jest.fn().mockResolvedValue(true),
    });

    it('backfills the key into a school row saved before it existed', async () => {
      const doc = teacherRowWithout();
      await service.ensureDefaultsMerged(doc, 'TEACHER');

      expect(doc.permissions).toHaveProperty('dailyTracking');
      expect((doc.permissions as any).dailyTracking.add).toBe(true);
      expect(doc.save).toHaveBeenCalled();
    });

    it('gives a teacher create — the permission the save endpoint checks', async () => {
      mockModel.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(teacherRowWithout()),
      });

      const perms = await service.getFlatPermissions('TEACHER', '507f1f77bcf86cd799439011');
      expect(perms).toContain('school.dailyTracking.create');
    });

    it('does not let a teacher delete an observation', async () => {
      // Saving is an upsert, so correcting a tick needs update, not delete.
      // Nothing in the API deletes a row; granting it would only allow
      // erasing the record rather than fixing it.
      mockModel.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue(teacherRowWithout()),
      });

      const perms = await service.getFlatPermissions('TEACHER', '507f1f77bcf86cd799439011');
      expect(perms).toContain('school.dailyTracking.update');
      expect(perms).not.toContain('school.dailyTracking.delete');
    });

    it('leaves a school that deliberately withheld it withheld', async () => {
      // The backfill fills absent keys only. A school that unticked the box
      // must not have it handed back on the next restart.
      const doc: any = {
        _id: 'doc-teacher-2',
        role: 'TEACHER',
        permissions: {
          dailyTracking: { read: false, add: false, edit: false, delete: false },
        },
        markModified: jest.fn(),
        save: jest.fn().mockResolvedValue(true),
      };

      await service.ensureDefaultsMerged(doc, 'TEACHER');
      expect(doc.permissions.dailyTracking.add).toBe(false);
    });

    it('does not record behaviour for a student', async () => {
      mockModel.findOne.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue({
          _id: 'doc-student',
          role: 'STUDENT',
          permissions: {},
          markModified: jest.fn(),
          save: jest.fn().mockResolvedValue(true),
        }),
      });

      const perms = await service.getFlatPermissions('STUDENT', '507f1f77bcf86cd799439011');
      expect(perms).not.toContain('school.dailyTracking.create');
      expect(perms).not.toContain('school.dailyTracking.read');
    });
  });
});
