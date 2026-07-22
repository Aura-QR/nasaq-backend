import { Schema, model, Types, connect, disconnect } from 'mongoose';
import { tenantScopedPlugin } from './plugins/tenant-scoped.plugin';
import { TenantContextService } from './tenant-context.service';
import * as dotenv from 'dotenv';

dotenv.config();

describe('Tenant Scoped Mongoose Plugin', () => {
  let DummyModel: any;
  const contextService = new TenantContextService();
  const schoolIdA = new Types.ObjectId().toString();

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';
    await connect(mongoUri);

    const DummySchema = new Schema({
      name: String,
    });
    DummySchema.plugin(tenantScopedPlugin);
    DummyModel = model('DummyScopedModel', DummySchema);
  });

  afterAll(async () => {
    try {
      await DummyModel.deleteMany({}).setOptions({ skipTenantScope: true });
    } catch {}
    await disconnect();
  });

  it('should automatically scope find queries to active tenant context', async () => {
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const query = DummyModel.find({ name: 'test' });
      await query.exec().catch(() => {});
      const conditions = query.getQuery();
      expect(conditions.schoolId).toEqual(new Types.ObjectId(schoolIdA));
    });
  });

  it('should scope to null when no tenant context exists', async () => {
    const query = DummyModel.find({ name: 'test' });
    await query.exec().catch(() => {});
    const conditions = query.getQuery();
    expect(conditions.schoolId).toBeNull();
  });

  it('should bypass scoping when skipTenantScope option is set', async () => {
    const query = DummyModel.find({ name: 'test' }).setOptions({ skipTenantScope: true });
    await query.exec().catch(() => {});
    const conditions = query.getQuery();
    expect(conditions.schoolId).toBeUndefined();
  });

  it('should auto-inject schoolId on document save', async () => {
    await contextService.runWithTenant(schoolIdA, false, async () => {
      const doc = new DummyModel({ name: 'Document A' });
      await doc.save();
      expect(doc.schoolId.toString()).toEqual(schoolIdA);
    });
  });
});
