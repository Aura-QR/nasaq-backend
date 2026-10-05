import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { adminsWhoCanRead } from './admin-audience';
import { PermissionsService } from '../permissions/permissions.service';
import { Permission, PermissionSchema } from '../permissions/schemas/permission.schema';
import { JobTitle, JobTitleSchema } from '../permissions/job-titles/job-title.schema';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-admin-audience${query}`,
);

/**
 * Notices to administrators follow the permissions screen.
 *
 * The school shut a manager out of «حضور المعلمين» and she still got every
 * notice about it, then a 403 when she tapped one. A manager now hears about
 * an area only if her job title — or the MANAGER row when she has none —
 * lets her read it. Owners and supervisors hold everything.
 */
describe('Who among the administrators hears about what', () => {
  let moduleRef: TestingModule;
  let permissions: PermissionsService;
  let permissionModel: any;
  let titleModel: any;

  const schoolId = new Types.ObjectId();
  const owner = { _id: new Types.ObjectId(), role: 'OWNER' };
  const supervisor = { _id: new Types.ObjectId(), role: 'SUPERVISOR' };
  const plainManager = { _id: new Types.ObjectId(), role: 'MANAGER', jobTitleId: null };
  let financeManager: any; // job title «المالية»: students only
  let hrManager: any;      // job title «شؤون الموظفين»: staff attendance

  const row = (overrides: Record<string, any>) => ({
    students: { read: true, add: true, edit: true, delete: true },
    teacherAttendance: { read: true, add: true, edit: true, delete: true },
    staffAttendance: { read: false, add: false, edit: false, delete: false },
    ...overrides,
  });

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Permission.name, schema: PermissionSchema },
          { name: JobTitle.name, schema: JobTitleSchema },
        ]),
      ],
    }).compile();
    permissionModel = moduleRef.get(getModelToken(Permission.name));
    titleModel = moduleRef.get(getModelToken(JobTitle.name));
    // Built by hand so its boot-time backfill does not run against the test DB.
    permissions = new PermissionsService(permissionModel, titleModel);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    await permissionModel.collection.deleteMany({});
    await titleModel.collection.deleteMany({});

    await permissionModel.collection.insertOne({
      role: 'MANAGER', schoolId, userId: null, permissions: row({}),
    });
    const finance = await titleModel.collection.insertOne({
      name: 'المالية', schoolId,
      permissions: { students: { read: true, add: false, edit: false, delete: false } },
    });
    const hr = await titleModel.collection.insertOne({
      name: 'شؤون الموظفين', schoolId,
      permissions: { staffAttendance: { read: true, add: false, edit: true, delete: false } },
    });
    financeManager = { _id: new Types.ObjectId(), role: 'MANAGER', jobTitleId: finance.insertedId };
    hrManager = { _id: new Types.ObjectId(), role: 'MANAGER', jobTitleId: hr.insertedId };
  });

  const all = () => [owner, supervisor, plainManager, financeManager, hrManager];
  const ids = (...people: any[]) => people.map((p) => String(p._id)).sort();
  const readers = async (entity: string, people = all()) =>
    (await adminsWhoCanRead(people, entity, schoolId, permissions)).sort();

  it('owners and supervisors always hear', async () => {
    expect(await readers('staffAttendance')).toEqual(
      expect.arrayContaining(ids(owner, supervisor)),
    );
  });

  it('a manager with no title follows the MANAGER row', async () => {
    expect(await readers('teacherAttendance')).toContain(String(plainManager._id));
    expect(await readers('staffAttendance')).not.toContain(String(plainManager._id));
  });

  it('a manager with a title follows the title only, not the MANAGER row', async () => {
    // The MANAGER row grants teacherAttendance; «المالية» does not.
    expect(await readers('teacherAttendance')).toEqual(ids(owner, supervisor, plainManager));
    expect(await readers('staffAttendance')).toEqual(ids(owner, supervisor, hrManager));
    expect(await readers('students')).toEqual(ids(owner, supervisor, plainManager, financeManager));
  });

  it('a manager whose title was deleted falls back to the MANAGER row', async () => {
    await titleModel.collection.deleteOne({ _id: financeManager.jobTitleId });
    expect(await readers('teacherAttendance')).toContain(String(financeManager._id));
  });

  it('unticking the box on the screen stops the notice', async () => {
    await permissionModel.collection.updateOne(
      { role: 'MANAGER', schoolId },
      { $set: { 'permissions.teacherAttendance.read': false } },
    );
    expect(await readers('teacherAttendance')).toEqual(ids(owner, supervisor));
  });

  it('without a permissions service nobody is filtered out', async () => {
    expect((await adminsWhoCanRead(all(), 'staffAttendance', schoolId)).sort()).toEqual(
      ids(...all()),
    );
  });
});
