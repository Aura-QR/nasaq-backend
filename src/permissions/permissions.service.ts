import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from './schemas/permission.schema';
import { getDefaultPermissionsForRole } from './default-permissions';

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectModel(Permission.name) private permissionModel: Model<Permission>,
  ) {}

  async onModuleInit() {
    try {
      const collection = this.permissionModel.collection;
      const indexes = await collection.indexes();
      const legacyRoleIndex = indexes.find((idx) => idx.name === 'role_1');
      if (legacyRoleIndex) {
        this.logger.log('Dropping legacy unique index "role_1" from permissions collection...');
        await collection.dropIndex('role_1');
        this.logger.log('Legacy index "role_1" dropped successfully.');
      }
      await this.permissionModel.syncIndexes();
      await this.backfillAllPermissions();
    } catch (err: any) {
      if (err?.codeName !== 'NamespaceNotFound') {
        this.logger.warn(`Permission index sync warning: ${err?.message}`);
      }
    }
  }

  /**
   * Backfill missing permission keys from defaults across all existing permission documents.
   */
  async backfillAllPermissions() {
    try {
      const docs = await this.permissionModel.find({}).setOptions({ skipTenantScope: true }).exec();
      for (const doc of docs) {
        if (doc.role) {
          await this.ensureDefaultsMerged(doc, doc.role);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Permission backfill warning: ${err?.message}`);
    }
  }

  /**
   * Checks a permission document against default permissions for the role,
   * merging and saving any missing keys (e.g. newly added modules like financial/financialSettings).
   */
  async ensureDefaultsMerged(permissionDoc: any, role: string): Promise<any> {
    if (!permissionDoc || !permissionDoc.permissions) return permissionDoc;
    const defaults = this.getDefaultPermissions(role);
    if (!defaults) return permissionDoc;

    let hasMissing = false;
    const currentPermissions = { ...permissionDoc.permissions };

    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (currentPermissions[key] === undefined || currentPermissions[key] === null) {
        currentPermissions[key] = defaultVal;
        hasMissing = true;
      }
    }

    if (hasMissing) {
      this.logger.log(`Backfilling missing default permissions for role ${role} (id: ${permissionDoc._id})`);
      permissionDoc.permissions = currentPermissions;
      if (permissionDoc.markModified) {
        permissionDoc.markModified('permissions');
        await permissionDoc.save();
      } else if (permissionDoc._id) {
        await this.permissionModel.updateOne(
          { _id: permissionDoc._id },
          { $set: { permissions: currentPermissions } },
        );
      }
    }

    return permissionDoc;
  }

  async findAll() {
    return this.permissionModel.find().lean();
  }

  async getPermissionsByRole(role: string, schoolId?: string) {
    let query: any = { role, userId: null };
    if (schoolId && Types.ObjectId.isValid(schoolId)) {
      query.schoolId = new Types.ObjectId(schoolId);
    } else {
      query.schoolId = null;
    }

    let permission = await this.permissionModel.findOne(query).setOptions({ skipTenantScope: true });

    if (!permission) {
      const defaultPermissions = this.getDefaultPermissions(role);
      permission = await this.permissionModel.create({
        role,
        schoolId: schoolId && Types.ObjectId.isValid(schoolId) ? new Types.ObjectId(schoolId) : null,
        userId: null,
        permissions: defaultPermissions,
      });
    } else {
      permission = await this.ensureDefaultsMerged(permission, role);
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

    if (!permissionDoc && schoolId && Types.ObjectId.isValid(schoolId)) {
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
    } else {
      permissionDoc = await this.ensureDefaultsMerged(permissionDoc, role);
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

  /**
   * Replace one role's permissions for one school.
   *
   * The read side (GET /permissions) has always existed with no write side, so
   * a school could look at its defaults and never change them. Upserts, so a
   * school registered before its row existed gets one on first edit.
   *
   * OWNER and SUPERVISOR are rejected by the caller: they authenticate with
   * ['*'] by role, so a stored row for them would be read by nobody and would
   * only look like it worked.
   */
  async updateRolePermissions(role: string, permissions: any, schoolId?: string) {
    const query: any = { role, userId: null };
    query.schoolId = schoolId ? new Types.ObjectId(schoolId) : null;

    await this.permissionModel.updateOne(
      query,
      { $set: { permissions } },
      { upsert: true },
    );

    const updated = await this.permissionModel.findOne(query).lean();
    return {
      message: 'تم تحديث الصلاحيات بنجاح',
      role,
      permissions: updated?.permissions ?? permissions,
      note: 'الصلاحيات محفوظة في التوكن، فلن تسري على من هو مسجّل دخوله الآن حتى يعيد تسجيل الدخول',
    };
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
    const query = (role: string) => (schoolId ? { role, schoolId: sId } : { role });

    const results = await Promise.all([
      this.permissionModel.updateMany(
        query('SUPERVISOR'),
        {
          $set: {
            'permissions.financial': { read: true, add: true, edit: true, delete: true },
            'permissions.financialSettings': { read: true, add: true, edit: true, delete: true },
          },
        },
        { upsert: true },
      ),
      this.permissionModel.updateMany(
        query('MANAGER'),
        {
          $set: {
            'permissions.financial': { read: true, add: true, edit: true, delete: true },
            'permissions.financialSettings': { read: true, add: false, edit: false, delete: false },
          },
        },
        { upsert: true },
      ),
      this.permissionModel.updateMany(
        query('TEACHER'),
        {
          $set: {
            'permissions.financial': { read: false, add: false, edit: false, delete: false },
            'permissions.financialSettings': { read: false, add: false, edit: false, delete: false },
          },
        },
        { upsert: true },
      ),
      this.permissionModel.updateMany(
        query('STUDENT'),
        {
          $set: {
            'permissions.financial': { read: false, add: false, edit: false, delete: false },
            'permissions.financialSettings': { read: false, add: false, edit: false, delete: false },
          },
        },
        { upsert: true },
      ),
    ]);

    return {
      message: 'Financial permissions synced successfully',
      data: {
        SUPERVISOR: results[0],
        MANAGER: results[1],
        TEACHER: results[2],
        STUDENT: results[3],
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
    // Single source of truth — shared with SchoolsService.register(), which seeds
    // the per-school documents. See src/permissions/default-permissions.ts.
    return getDefaultPermissionsForRole(role);
  }
}
