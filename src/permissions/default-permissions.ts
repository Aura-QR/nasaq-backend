/**
 * THE single source of truth for default role permissions.
 *
 * This table used to exist twice — once in PermissionsService.getDefaultPermissions()
 * and once inlined in SchoolsService.register(). Registration seeded the per-school
 * document from its own copy, so the copy in PermissionsService only ever ran as a
 * fallback for schools that predated it. Editing that one changed nothing for any
 * real school, silently.
 *
 * Import from here in both places. Do not inline another copy.
 */

export type EntityPermission = {
  read: boolean;
  add: boolean;
  edit: boolean;
  delete: boolean;
};

export type RolePermissions = Record<string, EntityPermission>;

const ALL: EntityPermission = { read: true, add: true, edit: true, delete: true };
const NONE: EntityPermission = { read: false, add: false, edit: false, delete: false };

export const OWNER_PERMISSIONS: RolePermissions = {
  students: ALL,
  teachers: ALL,
  classes: ALL,
  subjects: ALL,
  lectures: ALL,
  library: ALL,
  attendance: ALL,
  gradesCriteria: ALL,
  exams: { read: true, add: false, edit: false, delete: true },
  projects: { read: true, add: false, edit: false, delete: true },
  grades: ALL,
  preparation: { read: true, add: false, edit: false, delete: true },
  financial: ALL,
};

/**
 * MANAGER — the school's administrative staff account.
 *
 * There was no entry here at all, so getDefaultPermissionsForRole('MANAGER')
 * fell through to `{}` and no school was ever seeded with a manager row. Each
 * manager instead carried its own hand-written array on its admin document,
 * which meant two managers in the same school could differ arbitrarily and
 * there was nowhere to look up "what a manager can do".
 *
 * It is a real role now, defined once, exactly like TEACHER and STUDENT.
 *
 * Deliberately the same operational reach as the OWNER: a manager runs the
 * school day to day. What separates them is not this table — it is the
 * explicit role checks in ManagersController, which keep the owner-only
 * actions (creating a supervisor, editing another admin, removing the owner)
 * out of a manager's hands no matter what is written here.
 *
 * exams / projects / preparation stay read+delete for the same reason they do
 * on OWNER: creation is a teacher-only action enforced in the services.
 */
export const MANAGER_PERMISSIONS: RolePermissions = {
  students: ALL,
  teachers: ALL,
  classes: ALL,
  subjects: ALL,
  lectures: ALL,
  library: ALL,
  attendance: ALL,
  gradesCriteria: ALL,
  exams: { read: true, add: false, edit: false, delete: true },
  projects: { read: true, add: false, edit: false, delete: true },
  grades: ALL,
  preparation: { read: true, add: false, edit: false, delete: true },
  financial: ALL,
};

export const TEACHER_PERMISSIONS: RolePermissions = {
  students: { read: true, add: false, edit: false, delete: false },
  teachers: NONE,
  classes: { read: true, add: false, edit: false, delete: false },
  subjects: NONE,
  lectures: { read: true, add: false, edit: false, delete: false },
  library: { read: true, add: false, edit: false, delete: false },

  // `delete` is the UNDO for a mistaken absence. Attendance is absence-based, so
  // removing the record is what marks a student present again — a teacher who can
  // record but not delete cannot fix their own mistake.
  //
  // Safe because AttendanceService.assertMayTouchRecord() scopes a teacher's edit
  // and delete to classes they actually teach on that record's own date, exactly
  // like recording. Do not grant this without that check.
  attendance: { read: false, add: true, edit: true, delete: true },

  gradesCriteria: { read: true, add: false, edit: false, delete: false },

  // `add` is intentionally true, but exam creation is additionally restricted to
  // teachers inside ExamsService — OWNER and SUPERVISOR log in with ['*'], which
  // CASL expands to can('manage','all') and which no stored permission can stop.
  exams: ALL,

  projects: ALL,
  grades: { read: true, add: true, edit: true, delete: false },
  preparation: ALL,
  financial: NONE,
};

export const STUDENT_PERMISSIONS: RolePermissions = {
  students: NONE,
  teachers: NONE,
  classes: NONE,
  subjects: NONE,
  lectures: NONE,
  library: { read: true, add: false, edit: false, delete: false },
  attendance: { read: true, add: false, edit: false, delete: false },
  gradesCriteria: NONE,
  exams: NONE,
  projects: NONE,
  grades: NONE,
  preparation: NONE,
  financial: NONE,
};

export function getDefaultPermissionsForRole(role: string): RolePermissions | {} {
  switch (role) {
    case 'SUPERVISOR':
    case 'OWNER':
      return OWNER_PERMISSIONS;
    case 'MANAGER':
      return MANAGER_PERMISSIONS;
    case 'TEACHER':
      return TEACHER_PERMISSIONS;
    case 'STUDENT':
      return STUDENT_PERMISSIONS;
    default:
      return {};
  }
}
