import * as fs from 'fs';
import * as path from 'path';

/**
 * Every writing route must carry an authorization decorator.
 *
 * This is a structural check, not a behavioural one. It exists because the
 * failure it catches is invisible in review: a route whose @Roles line drifts
 * onto its neighbour still compiles, still passes every functional test, and
 * silently accepts a student's token. That happened twice while this
 * authorization pass was being written — once when fifty-eight decorators
 * were added with no guard registered, and once when inserting a new route
 * between @Roles and the route it belonged to left the teaching plan open.
 *
 * Reads are deliberately not covered: clients build dropdowns from them and
 * the tenant plugin already keeps schools apart.
 */
const SRC = path.join(__dirname, '..');

/** Public by design — authentication itself, and health. */
const PUBLIC_FILES = [
  'auth/auth.controller.ts',
  'admin/admin.controller.ts',
  'platform/platform-auth.controller.ts',
  'app.controller.ts',
  'common/nationalities.controller.ts',
];

/**
 * Writes that authorize inside the service instead, because the rule is about
 * the row rather than the role — a teacher may edit their own preparation but
 * not a colleague's, a student sets their own password.
 */
const SERVICE_AUTHORIZED = new Set([
  'students/students.controller.ts::POST /request-password-setup',
  'students/students.controller.ts::POST /set-password',
  // A teacher files their own استئذان and cancels it while it is pending.
  // DutyService scopes both to the caller; a role gate here would either lock
  // teachers out of the feature or let one cancel a colleague's.
  'duty/duty.controller.ts::POST /leave-requests',
  'duty/duty.controller.ts::DELETE /leave-requests/:id',
  // Every user reads and clears their own notices. NotificationsService scopes
  // every query and update to recipientId === the caller, so a wrong id and
  // somebody else's id give the same answer: nothing here for you. A role gate
  // would only decide who is allowed to have notices at all.
  'notifications/notifications.controller.ts',
  'attendance/attendance.controller.ts',
  'exams/exams.controller.ts',
  'projects/projects.controller.ts',
  'preparation/preparation.controller.ts',
  'grades-criteria/grades-criteria.controller.ts',
  'teacher-attendance/teacher-attendance.controller.ts',
  'financial/financial-record.controller.ts',
  'expenses/expense.controller.ts',
  'expenses/expense-category.controller.ts',
  'financial/additional-fee.controller.ts',
  'financial/bus-module.controller.ts',
  'financial/bus-plan.controller.ts',
  'financial/bus.controller.ts',
  'financial/discount.controller.ts',
  'financial/fee-config.controller.ts',
  'financial/installment-plan.controller.ts',
  'financial/trip-module.controller.ts',
  'financial/trip.controller.ts',
  'platform/schools/schools.controller.ts',
  'dashboards/dashboards.controller.ts',
  'managers/managers.controller.ts',
]);

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/** Decorators attached to a route: everything between it and the one before. */
function routesOf(file: string) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const classIndex = lines.findIndex((l) => l.startsWith('export class'));
  const classHeader = lines.slice(0, classIndex).join('\n');
  const classGuarded =
    classHeader.includes('@Roles(') || classHeader.includes('@CheckAbilities');

  const routes: { method: string; route: string; guarded: boolean; line: number }[] = [];
  let blockStart = classIndex + 1;

  for (let i = classIndex + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@(Get|Post|Patch|Put|Delete)\((.*)$/);
    if (!m) continue;

    const block = lines.slice(blockStart, i + 1).join('\n');
    const pathMatch = m[2].match(/^\s*\[?\s*['"]([^'"]*)['"]/);
    routes.push({
      method: m[1].toUpperCase(),
      route: '/' + (pathMatch ? pathMatch[1] : ''),
      line: i + 1,
      guarded:
        classGuarded ||
        block.includes('@Roles(') ||
        block.includes('@CheckAbilities') ||
        block.includes('@Public()'),
    });

    // Everything after this route's handler belongs to the next route.
    let end = i;
    while (end < lines.length && !lines[end].includes('}')) end++;
    blockStart = i + 1;
  }

  return routes;
}

describe('authorization coverage', () => {
  const files = controllerFiles(SRC);

  it('finds the controllers', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('leaves no writing route unauthorized', () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (PUBLIC_FILES.includes(rel)) continue;
      if (SERVICE_AUTHORIZED.has(rel)) continue;

      for (const route of routesOf(file)) {
        if (route.method === 'GET') continue;
        const key = `${rel}::${route.method} ${route.route}`;
        if (SERVICE_AUTHORIZED.has(key)) continue;
        if (!route.guarded) unguarded.push(`${rel}:${route.line}  ${route.method} ${route.route}`);
      }
    }

    expect(unguarded).toEqual([]);
  });
});
