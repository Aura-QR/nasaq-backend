import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { TeacherAssignment, TeacherAssignmentSchema } from './schemas/teacher-assignment.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { SubjectOffering, SubjectOfferingSchema } from '../subject-offerings/schemas/subject-offering.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { TeacherAssignmentsService } from './teacher-assignments.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = (process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test').replace(
  /\/([^/?]+)(\?.*)?$/,
  (_m, db, query = '') => `/${db}-grade-wide-filter${query}`,
);

/**
 * The add-period form asks «who teaches this subject in this class?» with
 * ?subjectOfferingId=&classId=. A teacher assigned to the whole grade
 * (classId null) was left out, so the form said «لا يوجد معلم مسند» for a
 * subject the timetable already showed her on.
 */
describe('teacher assignments filtered by class include grade-wide ones', () => {
  let moduleRef: TestingModule;
  let conn: Connection;
  const m: Record<string, any> = {};
  const schoolId = new Types.ObjectId();
  const ids: Record<string, Types.ObjectId> = {};
  const asSchool = <T>(fn: () => Promise<T>) => tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  beforeAll(async () => {
    const models = [
      [TeacherAssignment.name, TeacherAssignmentSchema], [Teacher.name, TeacherSchema], [Subject.name, SubjectSchema],
      [GradeLevel.name, GradeLevelSchema], [SubjectOffering.name, SubjectOfferingSchema], [Class.name, ClassSchema], [Term.name, TermSchema],
    ] as const;
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(URI), MongooseModule.forFeature(models.map(([name, schema]) => ({ name, schema })))],
    }).compile();
    conn = moduleRef.get(getConnectionToken());
    for (const [name] of models) m[name] = conn.models[name];
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(m)) await model.collection.deleteMany({});
    const termId = (await m.Term.collection.insertOne({ name: 'ترم', status: 'active', schoolId })).insertedId;
    for (const g of ['g1', 'g2']) {
      ids[g] = new Types.ObjectId();
      ids[`${g}Class`] = (await m.Class.collection.insertOne({ name: g, gradeLevelId: ids[g], schoolId })).insertedId;
      ids[`${g}Offering`] = (await m.SubjectOffering.collection.insertOne({ gradeLevelId: ids[g],
        subjectId: new Types.ObjectId(), termId, schoolId })).insertedId;
    }
    ids.teacher = new Types.ObjectId();
    // Grade-wide in grade 1; one class-specific row in grade 2.
    await m.TeacherAssignment.collection.insertOne({ teacherId: ids.teacher, subjectOfferingId: ids.g1Offering, classId: null, schoolId });
    await m.TeacherAssignment.collection.insertOne({ teacherId: new Types.ObjectId(), subjectOfferingId: ids.g2Offering,
      classId: ids.g2Class, schoolId });
  });

  const service = () => new TeacherAssignmentsService(m.TeacherAssignment, m.Teacher, m.Subject, m.GradeLevel, m.SubjectOffering);
  const offeringsOf = (rows: any[]) => rows.map((r: any) => String(r.subjectOfferingId?._id ?? r.subjectOfferingId)).sort();

  it('the add-period query finds the grade-wide teacher', async () => {
    const rows: any[] = await asSchool(() =>
      service().findAll({ subjectOfferingId: String(ids.g1Offering), classId: String(ids.g1Class) }));
    expect(rows).toHaveLength(1);
  });

  it('a class filter alone takes grade-wide rows of its own grade only', async () => {
    const g1: any[] = await asSchool(() => service().findAll({ classId: String(ids.g1Class) }));
    expect(offeringsOf(g1)).toEqual([String(ids.g1Offering)]);
    const g2: any[] = await asSchool(() => service().findAll({ classId: String(ids.g2Class) }));
    expect(offeringsOf(g2)).toEqual([String(ids.g2Offering)]);
  });
});
