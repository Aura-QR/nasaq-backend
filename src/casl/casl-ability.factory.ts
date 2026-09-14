import { Injectable } from '@nestjs/common';
import { AbilityBuilder, PureAbility } from '@casl/ability';

export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage';

export type Subjects =
  | 'Exam'
  | 'Project'
  | 'Student'
  | 'Teacher'
  | 'Class'
  | 'Grade'
  | 'Attendance'
  | 'TeacherAttendance'
  | 'StaffAttendance'
  | 'Lecture'
  | 'GradesCriteria'
  | 'Preparation'
  | 'Curriculum'
  | 'Financial'
  | 'FinancialSettings'
  | 'Expense'
  | 'Subject'
  | 'Library'
  | 'Duty'
  | 'AcademicStructure'
  | 'AcademicYear'
  | 'SchoolSettings'
  | 'Messaging'
  | 'all';

export type AppAbility = PureAbility<[Actions, Subjects]>;

const ENTITY_TO_SUBJECT_MAP: Record<string, Subjects> = {
  students: 'Student',
  teachers: 'Teacher',
  classes: 'Class',
  lectures: 'Lecture',
  attendance: 'Attendance',
  teacherAttendance: 'TeacherAttendance',
  staffAttendance: 'StaffAttendance',
  gradesCriteria: 'GradesCriteria',
  exams: 'Exam',
  projects: 'Project',
  grades: 'Grade',
  preparation: 'Preparation',
  curriculum: 'Curriculum',
  financial: 'Financial',
  financialSettings: 'FinancialSettings',
  expenses: 'Expense',
  // subjects and library were stored and shown on the permissions screen but
  // missing here, so their boxes were dropped before any check could read them.
  subjects: 'Subject',
  library: 'Library',
  duty: 'Duty',
  academicStructure: 'AcademicStructure',
  academicYears: 'AcademicYear',
  schoolSettings: 'SchoolSettings',
  messaging: 'Messaging',
};

@Injectable()
export class CaslAbilityFactory {
  async defineAbilitiesFor(user: any): Promise<AppAbility> {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(PureAbility);

    if (!user) {
      cannot('manage', 'all');
      return build();
    }

    // Platform Super Admin gets access to all subjects
    if (user.role === 'SUPER_ADMIN') {
      can('manage', 'all');
      return build();
    }

    // School Owner gets access to all school-scoped subjects
    if (user.permissions && user.permissions.includes('*')) {
      can('manage', 'all');
      return build();
    }

    // Map flat permission strings (e.g. school.students.read) to CASL rules
    if (user.permissions && Array.isArray(user.permissions)) {
      user.permissions.forEach((perm: string) => {
        const parts = perm.split('.');
        if (parts.length === 3 && parts[0] === 'school') {
          const entity = parts[1];
          const action = parts[2]; // 'read', 'create', 'update', 'delete', 'manage'
          const subject = ENTITY_TO_SUBJECT_MAP[entity];
          if (subject) {
            can(action as any, subject);
          }
        }
      });
    }

    if (user.role === 'MANAGER' && !(Number(user.permissionsVersion) >= 2)) {
      grantPreVersion2ManagerReach(can, user.permissions);
    }

    return build();
  }
}

/**
 * A manager token signed before PERMISSIONS_VERSION 2 carries no key for the
 * areas that release started checking — they were role-only, so every manager
 * reached them. Without this, everyone still logged in at deploy would hit 403
 * there until they signed in again.
 *
 * Grants exactly the pre-release reach and nothing more: the role-only areas in
 * full, and expenses mirroring whatever the token says about financial, which is
 * what expense routes checked before. Tokens expire (JWT_EXPIRE_IN), so this
 * only ever applies for one token lifetime after deploy.
 */
const PRE_V2_ROLE_ONLY_SUBJECTS: Subjects[] = [
  'TeacherAttendance',
  'Duty',
  'Curriculum',
  'AcademicStructure',
  'AcademicYear',
  'SchoolSettings',
  'Messaging',
];

function grantPreVersion2ManagerReach(can: AbilityBuilder<AppAbility>['can'], permissions: unknown) {
  for (const subject of PRE_V2_ROLE_ONLY_SUBJECTS) can('manage', subject);
  if (!Array.isArray(permissions)) return;
  for (const perm of permissions) {
    const [scope, entity, action] = String(perm).split('.');
    if (scope === 'school' && entity === 'financial' && action) can(action as Actions, 'Expense');
  }
}
