import { Injectable } from '@nestjs/common';
import { AbilityBuilder, PureAbility } from '@casl/ability';
import { PermissionsService } from 'src/permissions/permissions.service';

export type Actions = 'create' | 'read' | 'update' | 'delete' | 'manage';


export type Subjects = | 'Exam' | 'Project' | 'Student' | 'Teacher' | 'Class' | 'Grade' | 'Attendance' | 'Lecture' | 'GradesCriteria' | 'Preparation' | 'Financial' | 'Expense' | 'all';


export type AppAbility = PureAbility<[Actions, Subjects]>;


const ENTITY_TO_SUBJECT_MAP: Record<string, Subjects> = {
  students: 'Student',
  teachers: 'Teacher',
  classes: 'Class',
  lectures: 'Lecture',
  attendance: 'Attendance',
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
  constructor(private readonly permissionsService: PermissionsService) {}

  async defineAbilitiesFor(user: any): Promise<AppAbility> {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(PureAbility);


    const permissions = await this.permissionsService.getPermissionsByRole(user.role);

    if (!permissions) {
      cannot('manage', 'all');
      return build();
    }

  
    Object.entries(permissions).forEach(([entity, perms]: [string, any]) => {
      const subject = ENTITY_TO_SUBJECT_MAP[entity];
      if (!subject) return;

      if (perms.read) can('read', subject);
      if (perms.add) can('create', subject);
      if (perms.edit) can('update', subject);
      if (perms.delete) can('delete', subject);
    });

    return build();
  }
}