import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { GradesCriteriaService } from './grades-criteria.service';
import { GradesCriteria, GradesCriteriaSchema } from './schemas/grades-criteria.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';

dotenv.config();

/**
 * مواهب had 125 subject offerings and no distribution for any of them, so no
 * teacher could create an exam, and the only way in was one form per offering.
 */
describe('GradesCriteriaService.bulkCreate — one distribution for many subjects', () => {
  const contextService = new TenantContextService();
  const schoolId = new mongoose.Types.ObjectId().toString();
  const otherSchool = new mongoose.Types.ObjectId().toString();

  let criteriaModel: any;
  let offeringModel: any;
  let service: GradesCriteriaService;

  const weights = {
    final: 50, assignments: 10, assignmentsCount: 2, activities: 20,
    projects: 10, projectsCount: 1, quizzes: 10, quizzesCount: 2, passingGrade: 50,
  };

  const inSchool = <T>(id: string, fn: () => Promise<T>) => contextService.runWithTenant(id, false, fn);

  const makeOffering = (school = schoolId) =>
    offeringModel.collection
      .insertOne({
        schoolId: new mongoose.Types.ObjectId(school),
        subjectId: new mongoose.Types.ObjectId(),
        gradeLevelId: new mongoose.Types.ObjectId(),
        termId: new mongoose.Types.ObjectId(),
      })
      .then((r: any) => r.insertedId);

  const criteriaOf = (school = schoolId) =>
    criteriaModel.find({ schoolId: new mongoose.Types.ObjectId(school) }).setOptions({ skipTenantScope: true }).lean();

  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test');
    const model = (name: string, schema: any) => mongoose.models[name] || mongoose.model(name, schema);
    criteriaModel = model(GradesCriteria.name, GradesCriteriaSchema);
    offeringModel = model(SubjectOffering.name, SubjectOfferingSchema);
    await criteriaModel.syncIndexes();

    const none = {} as any;
    service = new GradesCriteriaService(
      criteriaModel, none, none, none, none, none, none, none, none, none, none,
      offeringModel, none, none, contextService, none,
    );
  });

  beforeEach(async () => {
    for (const s of [schoolId, otherSchool]) {
      const id = new mongoose.Types.ObjectId(s);
      await criteriaModel.collection.deleteMany({ schoolId: id });
      await offeringModel.collection.deleteMany({ schoolId: id });
    }
  });

  afterAll(async () => {
    for (const s of [schoolId, otherSchool]) {
      const id = new mongoose.Types.ObjectId(s);
      await criteriaModel.collection.deleteMany({ schoolId: id });
      await offeringModel.collection.deleteMany({ schoolId: id });
    }
    await mongoose.disconnect();
  });

  it('gives every chosen subject the same distribution', async () => {
    const ids = [await makeOffering(), await makeOffering(), await makeOffering()];

    const result: any = await inSchool(schoolId, () =>
      service.bulkCreate({ ...weights, subjectOfferingIds: ids.map(String) }),
    );

    expect(result.data).toMatchObject({ created: 3, alreadyHad: 0, notFound: 0 });
    const rows = await criteriaOf();
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => r.final === 50 && r.quizzes === 10 && r.quizzesCount === 2)).toBe(true);
  });

  it('leaves a subject that already has a distribution as it was', async () => {
    const [had, fresh] = [await makeOffering(), await makeOffering()];
    await inSchool(schoolId, () => criteriaModel.create({ ...weights, final: 100, activities: 0, assignments: 0, projects: 0, quizzes: 0, subjectOfferingId: had }));

    const result: any = await inSchool(schoolId, () =>
      service.bulkCreate({ ...weights, subjectOfferingIds: [String(had), String(fresh)] }),
    );

    expect(result.data).toMatchObject({ created: 1, alreadyHad: 1 });
    const kept = (await criteriaOf()).find((r: any) => String(r.subjectOfferingId) === String(had));
    expect(kept.final).toBe(100);
  });

  it('ignores another school\'s subjects', async () => {
    const theirs = await makeOffering(otherSchool);

    const result: any = await inSchool(schoolId, () =>
      service.bulkCreate({ ...weights, subjectOfferingIds: [String(theirs)] }),
    );

    expect(result.data).toMatchObject({ created: 0, notFound: 1 });
    expect(await criteriaOf()).toHaveLength(0);
    expect(await criteriaOf(otherSchool)).toHaveLength(0);
  });

  it('refuses a distribution that does not add up to 100', async () => {
    const id = await makeOffering();
    await expect(
      inSchool(schoolId, () => service.bulkCreate({ ...weights, final: 60, subjectOfferingIds: [String(id)] })),
    ).rejects.toThrow('يجب أن يكون 100');
    expect(await criteriaOf()).toHaveLength(0);
  });
});
