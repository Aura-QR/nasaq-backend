import { BadRequestException } from '@nestjs/common';
import { EntityPermission, MANAGER_PERMISSIONS, RolePermissions } from '../default-permissions';

const ALL: EntityPermission = { read: true, add: true, edit: true, delete: true };
const READ: EntityPermission = { read: true, add: false, edit: false, delete: false };
const NONE: EntityPermission = { read: false, add: false, edit: false, delete: false };

const ACTIONS = ['read', 'add', 'edit', 'delete'] as const;

/**
 * The areas a title can grant: exactly the keys a manager's row has. Deriving it
 * keeps titles in step when a release adds a key — it becomes a box on every
 * title, withheld until the owner ticks it.
 */
export const grantableKeys = (): string[] => Object.keys(MANAGER_PERMISSIONS);

/**
 * Boxes no title can tick, whatever is sent.
 *
 * - exams / projects / preparation: creating and editing them is a teacher's own
 *   work, enforced in their services; MANAGER has read + delete only.
 * - academicYears.delete: deleting a year is OWNER / SUPERVISOR by role.
 */
const NEVER_GRANTABLE: Record<string, (keyof EntityPermission)[]> = {
  exams: ['add', 'edit'],
  projects: ['add', 'edit'],
  preparation: ['add', 'edit'],
  academicYears: ['delete'],
};

/**
 * A complete, clean permission map for a title: every grantable key present,
 * four booleans each, the never-grantable boxes forced off.
 *
 * `strict` (used for input from the screen) rejects unknown keys and non-boolean
 * values with a 400 instead of silently dropping them. Stored titles are read
 * non-strict, so a key a later release removes cannot break anyone's login.
 */
export function normalizeTitlePermissions(input: unknown, { strict = false } = {}): RolePermissions {
  const source = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, any>;
  const keys = grantableKeys();

  if (strict) {
    const unknown = Object.keys(source).filter((key) => !keys.includes(key));
    if (unknown.length) {
      throw new BadRequestException(`صلاحيات غير معروفة: ${unknown.join('، ')}`);
    }
  }

  const result: RolePermissions = {};
  for (const key of keys) {
    const value = source[key];
    if (strict && value !== undefined) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException(`صلاحية «${key}» يجب أن تكون كائنًا فيه read و add و edit و delete`);
      }
      const extra = Object.keys(value).filter((action) => !(ACTIONS as readonly string[]).includes(action));
      const nonBoolean = ACTIONS.filter((action) => value[action] !== undefined && typeof value[action] !== 'boolean');
      if (extra.length || nonBoolean.length) {
        throw new BadRequestException(`صلاحية «${key}» تقبل read و add و edit و delete بقيم true أو false فقط`);
      }
    }
    const entry: EntityPermission = { ...NONE };
    for (const action of ACTIONS) entry[action] = value?.[action] === true;
    for (const action of NEVER_GRANTABLE[key] ?? []) entry[action] = false;
    result[key] = entry;
  }
  return result;
}

export interface JobTitleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: RolePermissions;
}

const template = (key: string, name: string, description: string, grants: RolePermissions): JobTitleTemplate => ({
  key,
  name,
  description,
  permissions: normalizeTitlePermissions(grants),
});

/**
 * Starting points on the screen. The owner edits any box after creating a title
 * from one; none of them grants staff attendance, which the owner gives
 * deliberately to whoever follows it.
 */
export const jobTitleTemplates = (): JobTitleTemplate[] => [
  template('finance', 'المالية', 'الرسوم والمدفوعات والخصومات والباص والرحلات والمصروفات، دون تغيير أسعار الرسوم وخطط التقسيط', {
    financial: ALL,
    financialSettings: READ,
    expenses: ALL,
    students: READ,
    classes: READ,
  }),
  template('studentAffairs', 'وكيل شؤون الطلاب', 'كل ما يخص الطلاب: البيانات والتسجيل في الفصول والحسابات والحضور، ومتابعة الدرجات والاختبارات والمشروعات', {
    students: ALL,
    attendance: ALL,
    classes: READ,
    grades: READ,
    exams: READ,
    projects: READ,
    gradesCriteria: READ,
    lectures: READ,
  }),
  template('teacherAffairs', 'وكيل شؤون المعلمين', 'كل ما يخص المعلمين: الحسابات والإسناد والجدول وحضور المعلمين والمناوبة، ومتابعة التحضير والاختبارات والمشروعات', {
    teachers: ALL,
    teacherAttendance: ALL,
    duty: ALL,
    lectures: ALL,
    preparation: READ,
    exams: READ,
    projects: READ,
    subjects: READ,
    classes: READ,
    library: READ,
  }),
  template('academic', 'المسؤول الأكاديمي', 'المراحل والصفوف والترمات والفصول والمواد والمناهج والمكتبة وتوزيع الدرجات', {
    academicStructure: ALL,
    classes: ALL,
    subjects: ALL,
    curriculum: ALL,
    library: ALL,
    gradesCriteria: ALL,
    lectures: READ,
    teachers: READ,
  }),
];
