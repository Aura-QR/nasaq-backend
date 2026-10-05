import type { PermissionsService } from '../permissions/permissions.service';

/**
 * Which of these administrators should hear about something in `entity`.
 *
 * A notice used to go to every owner, manager and supervisor by role. The
 * permissions screen could shut a manager out of a page — «حضور المعلمين»,
 * say — and they still got every notice about it, then a 403 when they
 * tapped it. Now the notice follows the same box: a MANAGER receives it only
 * if their permissions (their job title's, or the school's MANAGER row when
 * they have none) include reading `entity`. OWNER and SUPERVISOR always hold
 * every permission, so they always receive it.
 *
 * Without a PermissionsService (a hand-built service in a unit test) nobody
 * is filtered out, which is the old behaviour.
 */
export async function adminsWhoCanRead(
  admins: Array<{ _id: unknown; role?: string; jobTitleId?: unknown }>,
  entity: string,
  schoolId: unknown,
  permissions?: PermissionsService,
): Promise<string[]> {
  if (!permissions) return admins.map((a) => String(a._id));

  const needed = `school.${entity}.read`;
  // Managers sharing a job title (or sharing none) share an answer.
  const byTitle = new Map<string, Promise<boolean>>();

  const canRead = (admin: { role?: string; jobTitleId?: unknown }) => {
    if (admin.role !== 'MANAGER') return Promise.resolve(true);
    const key = admin.jobTitleId ? String(admin.jobTitleId) : '';
    if (!byTitle.has(key)) {
      byTitle.set(
        key,
        permissions
          .resolveManagerPermissions(schoolId ? String(schoolId) : undefined, key || null)
          .then((r) => r.permissions.includes(needed))
          // A lookup failure must not silence the school: fall back to sending.
          .catch(() => true),
      );
    }
    return byTitle.get(key)!;
  };

  const verdicts = await Promise.all(admins.map(canRead));
  return admins.filter((_, i) => verdicts[i]).map((a) => String(a._id));
}
