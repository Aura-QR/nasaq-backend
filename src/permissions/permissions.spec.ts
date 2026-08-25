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
});
