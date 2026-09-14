import * as mongoose from 'mongoose';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminSchema } from 'src/admin/schemas/admin.schema';
import { TeacherSchema } from 'src/teachers/schemas/teacher.schema';
import { PermissionSchema } from '../schemas/permission.schema';
import { PermissionsService } from '../permissions.service';
import { MANAGER_PERMISSIONS } from '../default-permissions';
import { TenantContextService } from 'src/tenancy/tenant-context.service';
import { JobTitleSchema } from './job-title.schema';
import { JobTitlesService } from './job-titles.service';
import { grantableKeys, jobTitleTemplates, normalizeTitlePermissions } from './job-title-permissions';

describe('job title permissions', () => {
  it('every template covers every grantable key, with four booleans each', () => {
    for (const template of jobTitleTemplates()) {
      expect(Object.keys(template.permissions).sort()).toEqual(grantableKeys().sort());
      for (const entry of Object.values(template.permissions)) {
        expect(Object.keys(entry).sort()).toEqual(['add', 'delete', 'edit', 'read']);
      }
    }
  });

  it('names the starter titles the school asked for', () => {
    expect(jobTitleTemplates().map((t) => t.name)).toEqual([
      'المالية',
      'وكيل شؤون الطلاب',
      'وكيل شؤون المعلمين',
      'المسؤول الأكاديمي',
    ]);
  });

  it('finance handles money but cannot change fee prices, and sees nothing academic', () => {
    const finance = jobTitleTemplates().find((t) => t.key === 'finance')!.permissions;
    expect(finance.financial).toEqual({ read: true, add: true, edit: true, delete: true });
    expect(finance.expenses.delete).toBe(true);
    expect(finance.financialSettings).toEqual({ read: true, add: false, edit: false, delete: false });
    expect(finance.teachers.read).toBe(false);
    expect(finance.attendance.read).toBe(false);
  });

  it('forces off the boxes no title may tick', () => {
    const all = { read: true, add: true, edit: true, delete: true };
    const clean = normalizeTitlePermissions({ exams: all, projects: all, preparation: all, academicYears: all }, { strict: true });
    expect(clean.exams).toEqual({ read: true, add: false, edit: false, delete: true });
    expect(clean.preparation).toEqual({ read: true, add: false, edit: false, delete: true });
    expect(clean.academicYears).toEqual({ read: true, add: true, edit: true, delete: false });
  });

  it('rejects unknown keys and non-boolean boxes from the screen', () => {
    expect(() => normalizeTitlePermissions({ managers: { read: true } }, { strict: true })).toThrow(BadRequestException);
    expect(() => normalizeTitlePermissions({ students: { read: 'yes' } }, { strict: true })).toThrow(BadRequestException);
    expect(() => normalizeTitlePermissions({ students: { read: true, manage: true } }, { strict: true })).toThrow(
      BadRequestException,
    );
    expect(() => normalizeTitlePermissions({ students: true }, { strict: true })).toThrow(BadRequestException);
  });

  it('reads a stored title leniently, so a key a later release drops cannot break a login', () => {
    const clean = normalizeTitlePermissions({ removedLater: { read: true }, students: { read: true } });
    expect(clean.removedLater).toBeUndefined();
    expect(clean.students.read).toBe(true);
    expect(clean.teachers).toEqual({ read: false, add: false, edit: false, delete: false });
  });
});

describe('JobTitlesService + login resolution (MongoDB)', () => {
  const schoolId = new mongoose.Types.ObjectId();
  const otherSchoolId = new mongoose.Types.ObjectId();
  let titles: mongoose.Model<any>;
  let admins: mongoose.Model<any>;
  let teachers: mongoose.Model<any>;
  let permissionRows: mongoose.Model<any>;
  let service: JobTitlesService;
  let permissions: PermissionsService;

  const model = (name: string, schema: mongoose.Schema) => {
    try {
      return mongoose.model(name, schema);
    } catch {
      return mongoose.model(name);
    }
  };

  const S = String(schoolId);
  const tenant = new TenantContextService();
  // The service runs inside a request's tenant context in the app; give it one.
  const inSchool = (id: string) =>
    new Proxy({} as JobTitlesService, {
      get: (_, method: keyof JobTitlesService) => (...args: any[]) =>
        tenant.runWithTenant(id, false, () => (service[method] as any)(...args)),
    });
  const skip = { skipTenantScope: true };

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');
    titles = model('TestJobTitle', JobTitleSchema);
    admins = model('TestJobTitleAdmin', AdminSchema);
    teachers = model('TestJobTitleTeacher', TeacherSchema);
    permissionRows = model('TestJobTitlePermission', PermissionSchema);
    await titles.syncIndexes();
    service = new JobTitlesService(titles as any, admins as any, teachers as any);
    permissions = new PermissionsService(permissionRows as any, titles as any);
  });

  afterEach(async () => {
    for (const m of [titles, admins, teachers, permissionRows]) {
      await m.deleteMany({ schoolId: { $in: [schoolId, otherSchoolId] } }).setOptions(skip);
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  const manager = (extra = {}) =>
    admins.collection
      .insertOne({ schoolId, username: `m${Math.random()}`, email: `${Math.random()}@x.test`, password: 'x', role: 'MANAGER', jobTitleId: null, ...extra })
      .then((r) => String(r.insertedId));

  it('creates a title from a template and lists it with its count', async () => {
    const created = await inSchool(S).create(S, { name: 'المالية', templateKey: 'finance' });
    expect(created!.templateKey).toBe('finance');
    expect(created!.permissions.financial.delete).toBe(true);

    const id = await manager();
    await inSchool(S).assign(S, id, { type: 'admin', jobTitleId: created!.id });

    const list = await inSchool(S).list(S);
    expect(list).toHaveLength(1);
    expect(list[0].assignedCount).toBe(1);
  });

  it('refuses a second title with the same name in one school, but not in another', async () => {
    await inSchool(S).create(S, { name: 'وكيل شؤون الطلاب', templateKey: 'studentAffairs' });
    await expect(inSchool(S).create(S, { name: 'وكيل شؤون الطلاب' })).rejects.toBeInstanceOf(ConflictException);
    await expect(inSchool(String(otherSchoolId)).create(String(otherSchoolId), { name: 'وكيل شؤون الطلاب' })).resolves.toBeDefined();
  });

  it('a blank title grants nothing; explicit permissions are validated', async () => {
    const blank = await inSchool(S).create(S, { name: 'فارغ' });
    expect(Object.values(blank!.permissions).every((p) => !p.read && !p.add && !p.edit && !p.delete)).toBe(true);
    await expect(inSchool(S).create(S, { name: 'سيء', permissions: { nope: { read: true } } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('updates name and permissions', async () => {
    const t = await inSchool(S).create(S, { name: 'قديم', templateKey: 'finance' });
    const updated = await inSchool(S).update(S, t!.id, {
      name: 'جديد',
      permissions: { ...t!.permissions, expenses: { read: true, add: false, edit: false, delete: false } },
    });
    expect(updated!.name).toBe('جديد');
    expect(updated!.permissions.expenses.add).toBe(false);
  });

  it('refuses to delete a title while it is assigned, then allows it once cleared', async () => {
    const t = await inSchool(S).create(S, { name: 'مالية', templateKey: 'finance' });
    const id = await manager();
    await inSchool(S).assign(S, id, { type: 'admin', jobTitleId: t!.id });

    await expect(inSchool(S).remove(S, t!.id)).rejects.toThrow(/مُسند إلى 1/);

    await inSchool(S).assign(S, id, { type: 'admin', jobTitleId: null });
    await expect(inSchool(S).remove(S, t!.id)).resolves.toEqual({ message: 'تم حذف المسمى الوظيفي' });
  });

  it('only assigns to MANAGER accounts and promoted teachers', async () => {
    const t = await inSchool(S).create(S, { name: 'مالية', templateKey: 'finance' });
    const supervisor = String(
      (await admins.collection.insertOne({ schoolId, username: 'sup', email: 'sup@x.test', password: 'x', role: 'SUPERVISOR' })).insertedId,
    );
    await expect(inSchool(S).assign(S, supervisor, { type: 'admin', jobTitleId: t!.id })).rejects.toBeInstanceOf(
      ConflictException,
    );

    const plainTeacher = String(
      (await teachers.collection.insertOne({ schoolId, name: 'معلم', email: 't@x.test', isManager: false })).insertedId,
    );
    await expect(inSchool(S).assign(S, plainTeacher, { type: 'teacher', jobTitleId: t!.id })).rejects.toBeInstanceOf(
      ConflictException,
    );

    const promoted = String(
      (await teachers.collection.insertOne({ schoolId, name: 'معلم مدير', email: 'tm@x.test', isManager: true })).insertedId,
    );
    await expect(inSchool(S).assign(S, promoted, { type: 'teacher', jobTitleId: t!.id })).resolves.toMatchObject({
      jobTitle: { name: 'مالية' },
    });
  });

  it('cannot reach across schools: another school\'s title or account is not found', async () => {
    const foreign = await inSchool(String(otherSchoolId)).create(String(otherSchoolId), { name: 'غريب', templateKey: 'finance' });
    const id = await manager();
    await expect(inSchool(S).assign(S, id, { type: 'admin', jobTitleId: foreign!.id })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    const t = await inSchool(S).create(S, { name: 'محلي', templateKey: 'finance' });
    const foreignManager = String(
      (await admins.collection.insertOne({ schoolId: otherSchoolId, username: 'fm', email: 'fm@x.test', password: 'x', role: 'MANAGER' })).insertedId,
    );
    await expect(inSchool(S).assign(S, foreignManager, { type: 'admin', jobTitleId: t!.id })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('resolveManagerPermissions (what login signs)', () => {
    beforeEach(async () => {
      await permissionRows.create({ role: 'MANAGER', schoolId, userId: null, permissions: { ...MANAGER_PERMISSIONS } });
    });

    it('a manager with no title gets the school MANAGER row, exactly as before titles', async () => {
      const resolved = await permissions.resolveManagerPermissions(S, null);
      expect(resolved.jobTitle).toBeNull();
      expect(resolved.permissions).toEqual(await permissions.getFlatPermissions('MANAGER', S));
    });

    it('a manager with a title gets only that title\'s permissions', async () => {
      const t = await inSchool(S).create(S, { name: 'المالية', templateKey: 'finance' });
      const resolved = await permissions.resolveManagerPermissions(S, t!.id);

      expect(resolved.jobTitle).toEqual({ id: t!.id, name: 'المالية' });
      expect(resolved.permissions).toEqual(expect.arrayContaining(['school.financial.delete', 'school.expenses.create', 'school.students.read']));
      expect(resolved.permissions).not.toContain('school.students.delete');
      expect(resolved.permissions).not.toContain('school.teachers.read');
      expect(resolved.permissions).not.toContain('school.financialSettings.update');
    });

    it('falls back to the MANAGER row for a deleted title or one from another school', async () => {
      const foreign = await inSchool(String(otherSchoolId)).create(String(otherSchoolId), { name: 'غريب', templateKey: 'finance' });
      const fromOtherSchool = await permissions.resolveManagerPermissions(S, foreign!.id);
      expect(fromOtherSchool.jobTitle).toBeNull();
      expect(fromOtherSchool.permissions).toContain('school.teachers.delete');

      const gone = await permissions.resolveManagerPermissions(S, String(new mongoose.Types.ObjectId()));
      expect(gone.jobTitle).toBeNull();
    });
  });
});
