import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from './schemas/permission.schema';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(Permission.name) private permissionModel: Model<Permission>,
  ) {}

  async findAll() {
    return this.permissionModel.find().lean();
  }

  async getPermissionsByRole(role: string, schoolId?: string) {
    let query: any = { role, userId: null };
    if (schoolId) {
      query.schoolId = new Types.ObjectId(schoolId);
    } else {
      query.schoolId = null;
    }

    let permission = await this.permissionModel.findOne(query).setOptions({ skipTenantScope: true });

    if (!permission) {
      const defaultPermissions = this.getDefaultPermissions(role);
      permission = await this.permissionModel.create({
        role,
        schoolId: schoolId ? new Types.ObjectId(schoolId) : null,
        userId: null,
        permissions: defaultPermissions,
      });
    }

    return permission?.permissions || null;
  }

  async getFlatPermissions(role: string, schoolId?: string, userId?: string): Promise<string[]> {
    if (role === 'OWNER') {
      return ['*'];
    }

    let permissionDoc: any = null;

    if (userId) {
      permissionDoc = await this.permissionModel.findOne({ userId })
        .setOptions({ skipTenantScope: true });
    }

    if (!permissionDoc && schoolId) {
      permissionDoc = await this.permissionModel.findOne({
        schoolId: new Types.ObjectId(schoolId),
        role,
      }).setOptions({ skipTenantScope: true });
    }

    if (!permissionDoc) {
      permissionDoc = await this.permissionModel.findOne({
        schoolId: null,
        userId: null,
        role,
      }).setOptions({ skipTenantScope: true });
    }

    if (!permissionDoc) {
      const defaultPermissionsObj = this.getDefaultPermissions(role);
      permissionDoc = await this.permissionModel.create({
        role,
        schoolId: null,
        userId: null,
        permissions: defaultPermissionsObj,
      });
    }

    return this.convertPermissionsToStrings(permissionDoc.permissions);
  }

  private convertPermissionsToStrings(permissionsObj: any): string[] {
    const list: string[] = [];
    if (!permissionsObj) return list;

    Object.entries(permissionsObj).forEach(([entity, perms]: [string, any]) => {
      if (perms.read) list.push(`school.${entity}.read`);
      if (perms.add) list.push(`school.${entity}.create`);
      if (perms.edit) list.push(`school.${entity}.update`);
      if (perms.delete) list.push(`school.${entity}.delete`);
    });
    return list;
  }

  async updateAttendancePermissionByRole(role: string, data: any, entity: string, schoolId?: string) {
    const query: any = { role };
    if (schoolId) {
      query.schoolId = new Types.ObjectId(schoolId);
    } else {
      query.schoolId = null;
    }

    const res = await this.permissionModel.updateOne(
      query,
      {
        $set: {
          [`permissions.${entity}`]: data,
        },
      },
      { upsert: true },
    );

    const updatedPermission = await this.permissionModel.findOne(query).lean();
    console.log('UPDATED PERMISSION:', updatedPermission);
    return res;
  }

  async syncFinancialPermissions(schoolId?: string) {
    const sId = schoolId ? new Types.ObjectId(schoolId) : null;
    const results = await Promise.all([
      this.permissionModel.updateOne(
        { role: 'SUPERVISOR', schoolId: sId },
        { $set: { 'permissions.financial': { read: true, add: true, edit: true, delete: true } } },
        { upsert: true },
      ),
      this.permissionModel.updateOne(
        { role: 'TEACHER', schoolId: sId },
        { $set: { 'permissions.financial': { read: false, add: false, edit: false, delete: false } } },
        { upsert: true },
      ),
      this.permissionModel.updateOne(
        { role: 'STUDENT', schoolId: sId },
        { $set: { 'permissions.financial': { read: false, add: false, edit: false, delete: false } } },
        { upsert: true },
      ),
    ]);

    return {
      message: 'Financial permissions synced successfully',
      data: {
        SUPERVISOR: results[0],
        TEACHER: results[1],
        STUDENT: results[2],
      },
    };
  }

  async setAllAdminPermissionsToTrue(schoolId?: string) {
    const sId = schoolId ? new Types.ObjectId(schoolId) : null;
    const allTruePermissions = {
      students: { read: true, add: true, edit: true, delete: true },
      teachers: { read: true, add: true, edit: true, delete: true },
      classes: { read: true, add: true, edit: true, delete: true },
      subjects: { read: true, add: true, edit: true, delete: true },
      lectures: { read: true, add: true, edit: true, delete: true },
      library: { read: true, add: true, edit: true, delete: true },
      attendance: { read: true, add: true, edit: true, delete: true },
      gradesCriteria: { read: true, add: true, edit: true, delete: true },
      exams: { read: true, add: true, edit: true, delete: true },
      projects: { read: true, add: true, edit: true, delete: true },
      grades: { read: true, add: true, edit: true, delete: true },
      preparation: { read: true, add: true, edit: true, delete: true },
      financial: { read: true, add: true, edit: true, delete: true },
    };

    const res = await this.permissionModel.updateOne(
      { role: 'SUPERVISOR', schoolId: sId },
      {
        $set: {
          permissions: allTruePermissions,
        },
      },
      { upsert: true },
    );

    console.log('TEMPORARY: All supervisor permissions set to true');
    return res;
  }

  private getDefaultPermissions(role: string) {
    switch (role) {
      case 'SUPERVISOR':
      case 'OWNER':
        return {
          students: { read: true, add: true, edit: true, delete: true },
          teachers: { read: true, add: true, edit: true, delete: true },
          classes: { read: true, add: true, edit: true, delete: true },
          subjects: { read: true, add: true, edit: true, delete: true },
          lectures: { read: true, add: true, edit: true, delete: true },
          library: { read: true, add: true, edit: true, delete: true },
          attendance: { read: true, add: true, edit: true, delete: true },
          gradesCriteria: { read: true, add: true, edit: true, delete: true },
          exams: { read: true, add: false, edit: false, delete: true },
          projects: { read: true, add: false, edit: false, delete: true },
          grades: { read: true, add: true, edit: true, delete: true },
          preparation: { read: true, add: false, edit: false, delete: true },
          financial: { read: true, add: true, edit: true, delete: true },
        };

      case 'TEACHER':
        return {
          students: { read: true, add: false, edit: false, delete: false },
          teachers: { read: false, add: false, edit: false, delete: false },
          classes: { read: true, add: false, edit: false, delete: false },
          subjects: { read: false, add: false, edit: false, delete: false },
          lectures: { read: true, add: false, edit: false, delete: false },
          library: { read: true, add: false, edit: false, delete: false },
          attendance: { read: false, add: true, edit: true, delete: false },
          gradesCriteria: { read: true, add: false, edit: false, delete: false },
          exams: { read: true, add: true, edit: true, delete: true },
          projects: { read: true, add: true, edit: true, delete: true },
          grades: { read: true, add: true, edit: true, delete: false },
          preparation: { read: true, add: true, edit: true, delete: true },
          financial: { read: false, add: false, edit: false, delete: false },
        };

      case 'STUDENT':
        return {
          students: { read: false, add: false, edit: false, delete: false },
          teachers: { read: false, add: false, edit: false, delete: false },
          classes: { read: false, add: false, edit: false, delete: false },
          subjects: { read: false, add: false, edit: false, delete: false },
          lectures: { read: false, add: false, edit: false, delete: false },
          library: { read: true, add: false, edit: false, delete: false },
          attendance: { read: true, add: false, edit: false, delete: false },
          gradesCriteria: { read: false, add: false, edit: false, delete: false },
          exams: { read: false, add: false, edit: false, delete: false },
          projects: { read: false, add: false, edit: false, delete: false },
          grades: { read: false, add: false, edit: false, delete: false },
          preparation: { read: false, add: false, edit: false, delete: false },
          financial: { read: false, add: false, edit: false, delete: false },
        };

      default:
        return {};
    }
  }
}
