import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from '../auth/auth.service';
import { PasswordUtil } from '../auth/utils/password.util';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import { ATTENDANCE_STAFF_ROLES } from '../staff-attendance/dto/staff-attendance.dto';
import { StaffMembersService } from './staff-members.service';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';
import { Role } from '../auth/enums/role.enum';

/**
 * موظفو الخدمات — a guard, a cleaner, a driver.
 *
 * They keep the school's hours and record their attendance like the
 * administrators, and must reach nothing else. These tests pin the second
 * half, because every way it could go wrong is silent: a guard who receives a
 * family's medical note in a push, reads the administrators' leave requests,
 * or files leave in a manager's name, and nothing on screen says so.
 */
const SRC = path.join(__dirname, '..');
const SCHOOL = '6ab0000000000000000000aa';
const GUARD = '6ab0000000000000000000a7';

describe('a STAFF account signing in', () => {
  const build = async (getFlat: jest.Mock) => {
    const hash = await PasswordUtil.hash('secret1');
    const signed: any[] = [];
    const service = new AuthService(
      { find: () => ({ select: () => ({ setOptions: async () => [{ _id: GUARD, role: 'STAFF', email: 'g@x.staff.local', password: hash, schoolId: SCHOOL }] }) }) } as any,
      {} as any,
      {} as any,
      { findById: () => ({ setOptions: () => ({ lean: async () => ({ _id: SCHOOL, isActive: true }) }) }) } as any,
      { findOne: () => ({ select: async () => null }) } as any,
      { signAsync: async (p: any) => { signed.push(p); return 'token'; } } as any,
      { getFlatPermissions: getFlat, resolveManagerPermissions: jest.fn() } as any,
      {} as any,
    );
    return { service, signed };
  };

  it('signs in with no school permission at all', async () => {
    const getFlat = jest.fn();
    const { service, signed } = await build(getFlat);
    const res: any = await service.login({ identifier: 'guard01', password: 'secret1' } as any);

    expect(res.user.role).toBe('STAFF');
    expect(res.permissions).toEqual([]);
    expect(signed[0].permissions).toEqual([]);
  });

  it('never looks up a permission row for the role', async () => {
    // That lookup creates a row when none exists, and the Permission schema
    // rejects STAFF — so falling through to it failed the first sign-in.
    const getFlat = jest.fn();
    const { service } = await build(getFlat);
    await service.login({ identifier: 'guard01', password: 'secret1' } as any);
    expect(getFlat).not.toHaveBeenCalled();
  });

  it('can do nothing a permission check guards', async () => {
    const ability = await new CaslAbilityFactory().defineAbilitiesFor({ role: 'STAFF', permissions: [] });
    for (const subject of ['Student', 'Teacher', 'Attendance', 'StaffAttendance', 'Financial', 'Preparation'] as any[]) {
      expect(ability.can('read', subject)).toBe(false);
    }
  });
});

describe('what reaches a STAFF account', () => {
  /** Every admin fan-out query in the services: role: { $in: [...] }. */
  const fanOuts = () => {
    const found: { file: string; roles: string }[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.service.ts')) {
          const text = fs.readFileSync(full, 'utf8');
          for (const m of text.matchAll(/role:\s*\{\s*\$in:\s*\[([^\]]*)\]/g)) {
            if (/OWNER|MANAGER/.test(m[1])) found.push({ file: path.relative(SRC, full), roles: m[1] });
          }
        }
      }
    };
    walk(SRC);
    return found;
  };

  it('finds the notification fan-outs', () => {
    // If this drops to zero the regex no longer matches and the check below
    // proves nothing.
    expect(fanOuts().length).toBeGreaterThanOrEqual(5);
  });

  it('is never among the administrators a notice is sent to', () => {
    // Those notices carry a family's absence excuse and medical note, a
    // teacher's lateness, a supervisor's classroom observations.
    const leaking = fanOuts().filter((f) => f.roles.includes('STAFF'));
    expect(leaking).toEqual([]);
  });
});

describe('staff attendance for a STAFF account', () => {
  const controller = fs.readFileSync(
    path.join(SRC, 'staff-attendance/staff-attendance.controller.ts'),
    'utf8',
  );

  /** method + route -> the @Roles line just above it (or the class default). */
  const rolesOf = (decorator: string) => {
    const lines = controller.split('\n');
    const at = lines.findIndex((l) => l.trim() === decorator);
    expect(at).toBeGreaterThan(-1);
    const above = lines[at - 1].trim();
    return above.startsWith('@Roles(') ? above : '(class default)';
  };

  it('is tracked like the administrators', () => {
    expect(ATTENDANCE_STAFF_ROLES).toContain(Role.STAFF);
  });

  it.each([
    "@Post('check-in')",
    "@Post('check-out')",
    "@Get('me')",
    "@Get('me/late-reason/pending')",
    "@Post('me/late-reason')",
    "@Post('leave-requests')",
  ])('may use %s', (route) => {
    expect(rolesOf(route)).toContain('Role.STAFF');
  });

  it.each([
    "@Get('late-reasons')",
    "@Patch('late-reasons/:id/review')",
    "@Patch('leave-requests/:id/review')",
    "@Get('staff')",
    "@Get('absent')",
    "@Get('summary')",
    "@Get()",
    "@Post()",
    "@Patch(':id')",
  ])('may not use %s', (route) => {
    // Either the class default (OWNER/MANAGER/SUPERVISOR) or an explicit
    // list — neither may name STAFF.
    expect(rolesOf(route)).not.toContain('Role.STAFF');
    expect(controller.match(/@Controller\('staff-attendance'\)\n@Roles\(([^)]*)\)/)?.[1]).not.toContain('STAFF');
  });

  const service = (leaves: any = {}) =>
    new StaffAttendanceService({} as any, {} as any, {} as any, leaves, {} as any);
  const guard = { role: 'STAFF', userId: GUARD, schoolId: SCHOOL };

  it('sees only their own leave requests', async () => {
    let filter: any;
    const leaves = {
      find: (f: any) => { filter = f; return { sort: () => ({ lean: () => ({ exec: async () => [] }) }) }; },
    };
    await service(leaves).listLeaves(guard, { staffId: '6ab0000000000000000000c1' } as any);
    // Asking for someone else's is ignored, not honoured.
    expect(String(filter.staffId)).toBe(GUARD);
  });

  it('cannot file leave in someone else’s name', async () => {
    await expect(
      service().createLeave(guard, { staffId: '6ab0000000000000000000c1', date: '2026-10-01' } as any),
    ).rejects.toThrow('لا يمكنك تقديم استئذان نيابة عن غيرك');
  });
});

describe('managing service staff', () => {
  let created: any;
  let lastFilter: any;

  const build = (taken: any = null) => {
    created = null;
    lastFilter = null;
    const model: any = {
      findOne: (f: any) => {
        lastFilter = f;
        return {
          setOptions: () => ({ select: () => ({ lean: () => ({ exec: async () => taken }) }) }),
          then: undefined,
        };
      },
      create: async (doc: any) => { created = doc; return { ...doc, _id: GUARD }; },
      deleteOne: async (f: any) => { lastFilter = f; return { deletedCount: 0 }; },
    };
    return new StaffMembersService(model);
  };

  it('creates a STAFF account that holds nothing', async () => {
    const service = build();
    await service.create(SCHOOL, { fullName: 'محمد السيد', username: 'guard01', password: 'secret1', jobLabel: 'حارس' });
    expect(created.role).toBe('STAFF');
    expect(created.permissions).toEqual([]);
    expect(created.fullName).toBe('محمد السيد');
    expect(created.jobLabel).toBe('حارس');
  });

  it('keeps a phone number, so the school can reach someone with no email or app', async () => {
    const service = build();
    const res: any = await service.create(SCHOOL, {
      fullName: 'أم محمد', username: 'cleaner01', password: 'secret1', phoneNumber: ' 0501234567 ',
    });
    expect(created.phoneNumber).toBe('0501234567');
    expect(res.data.phoneNumber).toBe('0501234567');

    await service.create(SCHOOL, { fullName: 'م', username: 'guard02', password: 'secret1' });
    expect(created.phoneNumber).toBe('');
  });

  it('gives a guard with no email a placeholder that cannot collide', async () => {
    const service = build();
    await service.create(SCHOOL, { fullName: 'م', username: 'Guard01', password: 'secret1' });
    expect(created.email).toBe(`guard01@${SCHOOL}.staff.local`);
  });

  it('refuses a username already in use anywhere', async () => {
    const service = build({ _id: 'x' });
    await expect(
      service.create(SCHOOL, { fullName: 'م', username: 'guard01', password: 'secret1' }),
    ).rejects.toThrow('مستخدم بالفعل');
  });

  it('can only ever delete a STAFF account', async () => {
    // An id that belongs to a manager or the owner is simply not found.
    const service = build();
    await expect(service.remove('6ab0000000000000000000c1')).rejects.toThrow('الموظف غير موجود');
    expect(lastFilter.role).toBe('STAFF');
  });
});

describe('the platform-only admin routes', () => {
  it('are no longer open to any signed-in account', () => {
    // Any teacher, student or guard could PATCH the owner's password here.
    const text = fs.readFileSync(path.join(SRC, 'admin/admin.controller.ts'), 'utf8');
    for (const summary of ['Get all admins', 'Get an admin by ID', 'Update an admin', 'Delete an admin']) {
      const at = text.indexOf(`summary: '${summary}'`);
      const before = text.slice(Math.max(0, at - 200), at);
      expect(before).toContain('@Roles(Role.SUPER_ADMIN)');
    }
  });
});

describe('routes with no @Roles', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { RolesGuard } = require('../auth/guards/roles.guard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Reflector } = require('@nestjs/core');

  class StudentsController {}
  class NotificationsController {}
  class AuthController {}

  const ctx = (cls: any, user: any, roles?: string[]) => {
    const handler = () => undefined;
    if (roles) Reflect.defineMetadata('roles', roles, handler);
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  };
  const guard = new RolesGuard(new Reflector());
  const staff = { role: 'STAFF' };

  it('stay open to every other role, as before', () => {
    // Teachers and students rely on unguarded reads for their dropdowns.
    expect(guard.canActivate(ctx(StudentsController, { role: 'TEACHER' }))).toBe(true);
    expect(guard.canActivate(ctx(StudentsController, { role: 'STUDENT' }))).toBe(true);
  });

  it('are closed to service staff', () => {
    // A guard signing in found GET /students open — every family's phone
    // number and address.
    expect(guard.canActivate(ctx(StudentsController, staff))).toBe(false);
  });

  it('leave staff their own notices and account', () => {
    expect(guard.canActivate(ctx(NotificationsController, staff))).toBe(true);
    expect(guard.canActivate(ctx(AuthController, staff))).toBe(true);
  });

  it('still let staff through where @Roles names them', () => {
    expect(guard.canActivate(ctx(StudentsController, staff, ['MANAGER', 'STAFF']))).toBe(true);
    expect(guard.canActivate(ctx(StudentsController, staff, ['MANAGER']))).toBe(false);
  });

  it('keep public routes public when nobody is signed in', () => {
    expect(guard.canActivate(ctx(AuthController, undefined))).toBe(true);
  });

  it('lets staff read the school settings their check-in screen needs', () => {
    const text = fs.readFileSync(path.join(SRC, 'platform/schools/schools.controller.ts'), 'utf8');
    const at = text.indexOf("@Get('schools/me/settings')");
    expect(text.slice(Math.max(0, at - 250), at)).toContain('Role.STAFF');
  });
});
