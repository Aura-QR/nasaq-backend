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
  | 'Lecture'
  | 'GradesCriteria'
  | 'Preparation'
  | 'Financial'
  | 'Expense'
  | 'all';

export type AppAbility = PureAbility<[Actions, Subjects]>;

const ENTITY_TO_SUBJECT_MAP: Record<string, Subjects> = {
  students: 'Student',
  teachers: 'Teacher',
  classes: 'Class',
  lectures: 'Lecture',
  attendance: 'Attendance',
  teacherAttendance: 'TeacherAttendance',
  gradesCriteria: 'GradesCriteria',
  exams: 'Exam',
  projects: 'Project',
  grades: 'Grade',
  preparation: 'Preparation',
  financial: 'Financial',
  expenses: 'Expense',
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

    return build();
  }
}