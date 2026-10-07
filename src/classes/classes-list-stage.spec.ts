import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Class, ClassSchema } from './schemas/class.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { ClassesService } from './classes.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-classes-list${query}`,
);

/**
 * The timetable sizes a class's grid from its stage — a KG day of 10
 * periods. GET /classes/list sent a bare grade id, so the page could not find
 * the stage and every KG class showed the school's 8.
 */
describe('GET /classes/list carries the stage', () => {
  let moduleRef: TestingModule;
  let classes: any;
  let grades: any;
  const schoolId = new Types.ObjectId();
  const stageId = new Types.ObjectId();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Class.name, schema: ClassSchema },
          { name: GradeLevel.name, schema: GradeLevelSchema },
        ]),
      ],
    }).compile();
    classes = moduleRef.get(getModelToken(Class.name));
    grades = moduleRef.get(getModelToken(GradeLevel.name));
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('as stageId, and keeps gradeLevelId the bare id clients read', async () => {
    await classes.collection.deleteMany({});
    await grades.collection.deleteMany({});
    const gradeId = (await grades.collection.insertOne({ name: 'مستوي الثاني', stageId, order: 24, schoolId })).insertedId;
    await classes.collection.insertOne({
      name: 'روضه 2-2', gradeLevelId: gradeId, academicYearId: new Types.ObjectId(),
      gender: 'both', maxCapacity: 30, isActive: true, schoolId,
    });

    const service = new ClassesService(classes, {} as any, {} as any, {} as any);
    const rows: any[] = await tenantLocalStorage.run({ schoolId: String(schoolId) } as any, () => service.list());

    expect(rows).toHaveLength(1);
    expect(String(rows[0].stageId)).toBe(String(stageId));
    expect(String(rows[0].gradeLevelId)).toBe(String(gradeId));
    expect(typeof rows[0].gradeLevelId === 'object' && rows[0].gradeLevelId?.name).toBeFalsy();
  });
});
