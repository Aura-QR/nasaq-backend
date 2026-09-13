import * as mongoose from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { TermSchema } from './schemas/term.schema';
import { TermsService } from './terms.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

/**
 * GET /terms — the list the mobile timetable opens with.
 *
 * The route did not exist. `TimetableCubit.load()` and the teaching-plan cubit
 * both fetch it first and emit an error when it fails, so on the phone those
 * screens showed nothing but the failure. A new list endpoint in a
 * multi-tenant app is also exactly where one school's rows leak into
 * another's, so isolation is the first thing pinned here.
 *
 * Its own database: suites here share one process, and a collection another
 * suite clears is how the preparation specs used to fail in a different place
 * each run.
 */
describe('TermsService.findAll', () => {
  const schoolA = new mongoose.Types.ObjectId().toString();
  const schoolB = new mongoose.Types.ObjectId().toString();
  const yearOld = new mongoose.Types.ObjectId();
  const yearNew = new mongoose.Types.ObjectId();

  let connection: mongoose.Connection;
  let terms: mongoose.Model<any>;
  let service: TermsService;

  // Executed inside the scope, not merely built there: a mongoose query is
  // lazy, and one awaited outside the ALS callback is scoped to schoolId:null.
  const as = <T>(schoolId: string, fn: () => Promise<T>) =>
    tenantLocalStorage.run({ schoolId, isAdminContext: false }, fn);

  const term = (academicYearId: any, order: number, start: string, status = 'closed') => ({
    academicYearId,
    name: `الفصل ${order}`,
    order,
    startDate: new Date(start),
    endDate: new Date(new Date(start).getTime() + 90 * 864e5),
    status,
  });

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(
        process.env.TEST_TERMS_MONGODB_URI ||
          'mongodb://localhost:27017/nasaq-terms-list-test',
      )
      .asPromise();
    terms = connection.model('Term', TermSchema);
    await terms.deleteMany({}).setOptions({ skipTenantScope: true });
    service = new TermsService(terms as any);

    await as(schoolA, async () => {
      await terms.create(term(yearOld, 1, '2025-09-01'));
      await terms.create(term(yearNew, 1, '2026-09-01', 'active'));
      await terms.create(term(yearNew, 2, '2027-01-01', 'upcoming'));
    });
    await as(schoolB, async () => {
      await terms.create(term(yearNew, 1, '2026-09-01', 'active'));
    });
  });

  afterAll(async () => {
    await terms.deleteMany({}).setOptions({ skipTenantScope: true });
    await connection.close();
  });

  it("returns only the caller's school", async () => {
    const a: any[] = await as(schoolA, () => service.findAll());
    const b: any[] = await as(schoolB, () => service.findAll());
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(1);
    expect(a.every((t) => String(t.schoolId) === schoolA)).toBe(true);
  });

  it('lists the most recent first, so an app with no active term picks a current one', async () => {
    const a: any[] = await as(schoolA, () => service.findAll());
    expect(a.map((t) => new Date(t.startDate).getFullYear())).toEqual([2027, 2026, 2025]);
  });

  it('carries status, which the app uses to default to the active term', async () => {
    const a: any[] = await as(schoolA, () => service.findAll());
    expect(a.filter((t) => t.status === 'active')).toHaveLength(1);
  });

  it('narrows to one academic year with ?academicYearId, in term order', async () => {
    const a: any[] = await as(schoolA, () => service.findAll(String(yearNew)));
    expect(a.map((t) => t.order)).toEqual([1, 2]);
  });

  it("does not reach another school's year by its id", async () => {
    const b: any[] = await as(schoolB, () => service.findAll(String(yearOld)));
    expect(b).toEqual([]);
  });

  it('treats an empty academicYearId as no filter', async () => {
    const a: any[] = await as(schoolA, () => service.findAll(''));
    expect(a).toHaveLength(3);
  });

  it('rejects a malformed id with 400, not a 500 from the ObjectId cast', async () => {
    await expect(as(schoolA, () => service.findAll('not-an-id'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
