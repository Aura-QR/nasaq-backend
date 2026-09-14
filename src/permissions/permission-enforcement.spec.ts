import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as mongoose from 'mongoose';
import { ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { CHECK_ABILITY, RequiredAbility } from '../casl/decorators/check-abilities.decorator';
import { AbilitiesGuard } from '../casl/guards/abilities.guard';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { PermissionsService } from './permissions.service';
import { PermissionSchema } from './schemas/permission.schema';
import { MANAGER_PERMISSIONS } from './default-permissions';

/**
 * The permissions screen is only true if the server reads it. These tests hold
 * that in place: a route a manager can call to change something must carry an
 * ability check, and a check scoped to MANAGER must leave teachers and students
 * exactly where they were.
 */

// Every controller in the app, loaded for its decorator metadata only.
function loadControllers(): { file: string; cls: any }[] {
  const out: { file: string; cls: any }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.controller.ts')) {
        const mod = require(full);
        for (const exported of Object.values(mod)) {
          if (typeof exported === 'function' && Reflect.getMetadata(PATH_METADATA, exported) !== undefined) {
            out.push({ file: path.relative(path.join(__dirname, '..'), full), cls: exported });
          }
        }
      }
    }
  };
  walk(path.join(__dirname, '..'));
  return out;
}

type Route = { id: string; roles: string[] | null; abilities: RequiredAbility[] | undefined };

function routes(): Route[] {
  const list: Route[] = [];
  for (const { cls } of loadControllers()) {
    const classRoles = Reflect.getMetadata(ROLES_KEY, cls) ?? null;
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      const handler = cls.prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
      list.push({
        id: `${cls.name}.${name}`,
        roles: Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles,
        abilities: Reflect.getMetadata(CHECK_ABILITY, handler),
      });
    }
  }
  return list;
}

/**
 * Manager-reachable routes that deliberately carry no ability check.
 * Each entry must still lack one — a stale entry fails the test below.
 */
const NO_ABILITY_BY_DESIGN: Record<string, string> = {
  'TeacherAttendanceController.detectClientIp': 'reads the caller\'s own IP; changes nothing',
  // Personal attendance never depends on the management permission.
  'StaffAttendanceController.checkIn': 'self check-in by location',
  'StaffAttendanceController.checkOut': 'self check-out by location',
  'StaffAttendanceController.getMine': 'own history',
  'StaffAttendanceController.detectIp': 'reads the caller\'s own IP; changes nothing',
};

describe('permission enforcement — route sweep', () => {
  const all = routes();

  it('finds the controllers', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('every staff-only route a MANAGER is admitted to by role carries an ability check', () => {
    // Staff-only: admits MANAGER and neither TEACHER nor STUDENT. Routes shared
    // with teachers or students (e.g. a preparation's student view) are scoped
    // by their services, not by the permissions screen.
    const unguarded = all
      .filter((r) => r.roles?.includes('MANAGER') && !r.roles.includes('TEACHER') && !r.roles.includes('STUDENT'))
      .filter((r) => !r.abilities?.length)
      .map((r) => r.id)
      .filter((id) => !NO_ABILITY_BY_DESIGN[id]);
    expect(unguarded).toEqual([]);
  });

  it('keeps the by-design list honest', () => {
    const stale = Object.keys(NO_ABILITY_BY_DESIGN).filter((id) => {
      const route = all.find((r) => r.id === id);
      return !route || !!route.abilities?.length;
    });
    expect(stale).toEqual([]);
  });

  it('scopes every check on a route teachers or students can reach to MANAGER', () => {
    // A plain check there would apply the TEACHER / STUDENT rows, which were
    // never written for these routes (e.g. teachers: NONE blocks GET /teachers).
    const alreadyApplied = new Set([
      // Checked for every role before this change, on purpose.
      'AttendanceController', 'ExamsController', 'ProjectsController', 'PreparationController',
      'GradesCriteriaController', 'ExpenseController', 'ExpenseCategoryController',
    ]);
    const leaking = all
      .filter((r) => r.abilities?.length)
      .filter((r) => !alreadyApplied.has(r.id.split('.')[0]))
      .filter((r) => !r.roles || r.roles.includes('TEACHER') || r.roles.includes('STUDENT'))
      .filter((r) => r.abilities!.some((a) => !a.roles?.length))
      .filter((r) => !r.id.startsWith('Financial') && !/^(Bus|Trip|AdditionalFee|Discount|FeeConfig|InstallmentPlan)/.test(r.id))
      .map((r) => r.id);
    expect(leaking).toEqual([]);
  });

  it.each([
    ['StudentsController.remove', 'delete', 'Student'],
    ['TeachersController.remove', 'delete', 'Teacher'],
    ['ClassesController.remove', 'delete', 'Class'],
    ['SubjectsController.remove', 'delete', 'Subject'],
    ['LibraryController.remove', 'delete', 'Library'],
    ['AcademicYearsController.create', 'create', 'AcademicYear'],
    ['SchoolsController.updateMySettings', 'update', 'SchoolSettings'],
    ['ExpenseController.find', 'read', 'Expense'],
  ])('%s requires %s %s', (id, action, subject) => {
    const route = all.find((r) => r.id === id)!;
    expect(route.abilities).toEqual([expect.objectContaining({ action, subject })]);
  });
});

describe('AbilitiesGuard — role-scoped requirements', () => {
  const factory = new CaslAbilityFactory();
  const guardFor = (abilities: RequiredAbility[]) => {
    const reflector = { get: () => abilities } as unknown as Reflector;
    return new AbilitiesGuard(reflector, factory);
  };
  const ctx = (user: any) =>
    ({ getHandler: () => null, switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

  const scopedRead = [{ action: 'read', subject: 'Teacher', roles: ['MANAGER'] }];

  it('lets a teacher through a check scoped to MANAGER, whatever their row says', async () => {
    await expect(guardFor(scopedRead).canActivate(ctx({ role: 'TEACHER', permissions: [] }))).resolves.toBe(true);
  });

  it('refuses a manager without the permission', async () => {
    await expect(
      guardFor(scopedRead).canActivate(ctx({ role: 'MANAGER', permissions: ['school.students.read'] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admits a manager with the permission, and an owner by wildcard', async () => {
    await expect(
      guardFor(scopedRead).canActivate(ctx({ role: 'MANAGER', permissions: ['school.teachers.read'] })),
    ).resolves.toBe(true);
    await expect(guardFor(scopedRead).canActivate(ctx({ role: 'OWNER', permissions: ['*'] }))).resolves.toBe(true);
  });

  it('still applies an unscoped check to everyone', async () => {
    const plain = [{ action: 'delete', subject: 'Student' }];
    await expect(guardFor(plain).canActivate(ctx({ role: 'TEACHER', permissions: [] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('tokens signed before PERMISSIONS_VERSION 2', () => {
    const legacyManager = {
      role: 'MANAGER',
      // What a default manager's token held before this release: no new keys.
      permissions: ['school.students.read', 'school.students.update', 'school.financial.read'],
    };

    it('keep the role-only reach they had, so nobody logged in at deploy is locked out', async () => {
      const ability = await factory.defineAbilitiesFor(legacyManager);
      for (const subject of ['TeacherAttendance', 'Duty', 'Curriculum', 'AcademicStructure', 'AcademicYear', 'SchoolSettings', 'Messaging']) {
        expect(ability.can('delete', subject as any)).toBe(true);
      }
    });

    it('see expenses exactly as their financial permissions allowed', async () => {
      const ability = await factory.defineAbilitiesFor(legacyManager);
      expect(ability.can('read', 'Expense')).toBe(true);
      expect(ability.can('delete', 'Expense')).toBe(false);
    });

    it('do not gain what the token already governs', async () => {
      const ability = await factory.defineAbilitiesFor(legacyManager);
      expect(ability.can('delete', 'Student')).toBe(false);
      expect(ability.can('read', 'Teacher')).toBe(false);
    });

    it('stop applying once the token carries the version', async () => {
      const ability = await factory.defineAbilitiesFor({ ...legacyManager, permissionsVersion: 2 });
      expect(ability.can('read', 'Duty')).toBe(false);
      expect(ability.can('read', 'Expense')).toBe(false);
    });

    it('never apply to teachers', async () => {
      const ability = await factory.defineAbilitiesFor({ role: 'TEACHER', permissions: [] });
      expect(ability.can('read', 'Duty')).toBe(false);
    });
  });

  it.each([
    ['subjects', 'Subject'],
    ['library', 'Library'],
    ['duty', 'Duty'],
    ['academicStructure', 'AcademicStructure'],
    ['academicYears', 'AcademicYear'],
    ['schoolSettings', 'SchoolSettings'],
    ['messaging', 'Messaging'],
    ['expenses', 'Expense'],
  ])('maps school.%s.* onto %s', async (entity, subject) => {
    const ability = await factory.defineAbilitiesFor({ role: 'MANAGER', permissionsVersion: 2, permissions: [`school.${entity}.update`] });
    expect(ability.can('update', subject as any)).toBe(true);
    expect(ability.can('delete', subject as any)).toBe(false);
  });
});

describe('PermissionsService — stored rows', () => {
  let model: mongoose.Model<any>;
  let service: PermissionsService;
  const schoolId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');
    try {
      model = mongoose.model('TestPermissionEnforcement', PermissionSchema);
    } catch {
      model = mongoose.model('TestPermissionEnforcement');
    }
    await model.syncIndexes();
    service = new PermissionsService(model as any);
  });

  afterEach(async () => {
    await model.deleteMany({ schoolId }).setOptions({ skipTenantScope: true });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  const NONE = { read: false, add: false, edit: false, delete: false };
  const ALL = { read: true, add: true, edit: true, delete: true };

  it('backfills expenses from the row\'s own financial value, not from the default', async () => {
    const legacy = { ...MANAGER_PERMISSIONS, financial: NONE } as any;
    delete legacy.expenses;
    await model.create({ role: 'MANAGER', schoolId, userId: null, permissions: legacy });

    const flat = await service.getFlatPermissions('MANAGER', schoolId.toString());

    expect(flat.filter((p) => p.startsWith('school.expenses.'))).toEqual([]);
    const stored = await model.findOne({ schoolId, role: 'MANAGER' }).setOptions({ skipTenantScope: true }).lean();
    expect((stored as any).permissions.expenses).toEqual(NONE);
  });

  it('gives a legacy row the new keys at today\'s reach', async () => {
    const legacy = { students: ALL, financial: ALL } as any;
    await model.create({ role: 'MANAGER', schoolId, userId: null, permissions: legacy });

    const flat = await service.getFlatPermissions('MANAGER', schoolId.toString());

    for (const key of ['expenses', 'teacherAttendance', 'duty', 'curriculum', 'academicStructure']) {
      expect(flat).toEqual(expect.arrayContaining([`school.${key}.read`, `school.${key}.delete`]));
    }
    expect(flat).toEqual(expect.arrayContaining(['school.academicYears.create', 'school.schoolSettings.update']));
    expect(flat).not.toContain('school.academicYears.delete');
  });

  it('reads the school\'s role row, never an account override row', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await model.create({ role: 'MANAGER', schoolId, userId: accountId, permissions: { students: NONE } });
    await model.create({ role: 'MANAGER', schoolId, userId: null, permissions: { ...MANAGER_PERMISSIONS } });

    const flat = await service.getFlatPermissions('MANAGER', schoolId.toString());

    expect(flat).toContain('school.students.delete');
  });
});
