import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permission } from './schemas/permission.schema';

@Injectable()
export class PermissionsService {
  constructor(
    @InjectModel(Permission.name) private permissionModel: Model<Permission>,
  ) {}

  async findAll() {
    return this.permissionModel.find().lean();
  }

  async getPermissionsByRole(role: string) {
    let permission = await this.permissionModel.findOne({ role });

    if (!permission) {
      const defaultPermissions = this.getDefaultPermissions(role);
      permission = await this.permissionModel.create({
        role,
        permissions: defaultPermissions,
      });
    }

    return permission?.permissions || null;
  }
async updateAttendancePermissionByRole(role: string, data: any , entity : string ) {
  const res = await this.permissionModel.updateOne(
    { role },
    {
      $set: {
         [`permissions.${entity}`]: data,
      },
    },
    { upsert: true },
  );

  const updatedPermission = await this.permissionModel.findOne({ role }).lean();

  console.log('UPDATED PERMISSION:', updatedPermission);

  return res;
}


async syncFinancialPermissions() {
  const results = await Promise.all([
    this.permissionModel.updateOne(
      { role: 'ADMIN' },
      { $set: { 'permissions.financial': { read: true, add: true, edit: true, delete: true } } },
      { upsert: true },
    ),
    this.permissionModel.updateOne(
      { role: 'TEACHER' },
      { $set: { 'permissions.financial': { read: false, add: false, edit: false, delete: false } } },
      { upsert: true },
    ),
    this.permissionModel.updateOne(
      { role: 'STUDENT' },
      { $set: { 'permissions.financial': { read: false, add: false, edit: false, delete: false } } },
      { upsert: true },
    ),
  ]);

  return {
    message: 'Financial permissions synced successfully',
    data: {
      ADMIN: results[0],
      TEACHER: results[1],
      STUDENT: results[2],
    },
  };
}

async setAllAdminPermissionsToTrue() {
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
    { role: 'ADMIN' },
    {
      $set: {
        permissions: allTruePermissions,
      },
    },
    { upsert: true },
  );

  console.log('TEMPORARY: All admin permissions set to true');
  return res;
}



  private getDefaultPermissions(role: string) {
    switch (role) {
      case 'ADMIN':
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
