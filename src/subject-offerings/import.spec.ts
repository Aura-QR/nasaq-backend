import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SubjectOfferingsService } from './subject-offerings.service';
import { SubjectOffering, SubjectOfferingSchema } from './schemas/subject-offering.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { TeacherAssignmentsService } from '../teacher-assignments/teacher-assignments.service';
import {
  TeacherAssignment,
  TeacherAssignmentSchema,
} from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { GradeLevel, GradeLevelSchema } from '../grade-levels/schemas/grade-level.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';

describe('pasted-sheet imports', () => {
  let moduleRef: TestingModule;
  let offeringsService: SubjectOfferingsService;
  let assignmentsService: TeacherAssignmentsService;
  const models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const academicYearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  let gradeFour: Types.ObjectId;
  let gradeFive: Types.ObjectId;

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const mk = async (model: any, doc: any) =>
    (await model.collection.insertOne(doc)).insertedId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: SubjectOffering.name, schema: SubjectOfferingSchema },
          { name: Term.name, schema: TermSchema },
          { name: Subject.name, schema: SubjectSchema },
          { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: GradeLevel.name, schema: GradeLevelSchema },
        ]),
      ],
      providers: [SubjectOfferingsService, TeacherAssignmentsService],
    }).compile();

    offeringsService = moduleRef.get(SubjectOfferingsService);
    assignmentsService = moduleRef.get(TeacherAssignmentsService);
    for (const name of [
      SubjectOffering.name, Term.name, Subject.name,
      TeacherAssignment.name, Teacher.name, GradeLevel.name,
    ]) {
      models[name] = moduleRef.get(getModelToken(name));
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(async () => {
    for (const model of Object.values(models)) {
      await model.collection.deleteMany({});
    }

    await mk(models[Term.name], {
      _id: termId, academicYearId, name: 'الترم الأول', order: 1,
      startDate: new Date(), endDate: new Date(), status: 'active', schoolId,
    });

    gradeFour = await mk(models[GradeLevel.name], {
      name: 'الصف الرابع', order: 4, stageId: new Types.ObjectId(), schoolId,
    });
    gradeFive = await mk(models[GradeLevel.name], {
      name: 'الصف الخامس', order: 5, stageId: new Types.ObjectId(), schoolId,
    });

    for (const name of ['لغتي', 'رياضيات', 'علوم', 'دراسات إسلامية', 'تربية فنية']) {
      await mk(models[Subject.name], {
        subjectName: name, isRequiredForPromotion: true, schoolId,
      });
    }
  });

  describe('teaching plan', () => {
    /** What actually lands on the clipboard from Excel. */
    const PASTE = [
      '# خطة الصف الرابع',
      'لغتي\t6',
      'رياضيات\t6',
      'دراسات إسلامية\t5',
      '',
      'علوم\t4',
      'تربية فنية 1',
    ].join('\n');

    const importPlan = (overrides: any = {}) =>
      asTenant(() =>
        offeringsService.importPlan({
          termId: String(termId),
          gradeLevelId: String(gradeFour),
          text: PASTE,
          ...overrides,
        }),
      );

    it('writes nothing unless told to', async () => {
      const report: any = await importPlan();

      expect(report.dryRun).toBe(true);
      expect(report.written).toBe(0);
      expect(await models[SubjectOffering.name].collection.countDocuments({})).toBe(0);
    });

    it('parses every shape a paste arrives in', async () => {
      const report: any = await importPlan();

      // Five subjects: tabs, a bare trailing number, a comment and two blanks.
      expect(report.totalLines).toBe(5);
      expect(report.errors).toBe(0);
      expect(report.totalPeriods).toBe(22);
    });

    it('creates the offerings when committed', async () => {
      const report: any = await importPlan({ dryRun: false });

      expect(report.written).toBe(5);
      expect(report.created).toBe(5);
      expect(await models[SubjectOffering.name].collection.countDocuments({})).toBe(5);

      const rows = await models[SubjectOffering.name].collection.find({}).toArray();
      expect(rows.every((r: any) => r.periodsPerWeek > 0)).toBe(true);
    });

    it('updates an existing offering rather than duplicating it', async () => {
      const maths = await models[Subject.name].collection.findOne({ subjectName: 'رياضيات' });
      await mk(models[SubjectOffering.name], {
        subjectId: maths._id, gradeLevelId: gradeFour, termId,
        periodsPerWeek: 3, schoolId,
      });

      const report: any = await importPlan({ dryRun: false });

      expect(report.updated).toBe(1);
      expect(report.created).toBe(4);
      const row = report.results.find((r: any) => r.subjectName === 'رياضيات');
      expect(row.from).toBe(3);
      expect(row.periodsPerWeek).toBe(6);
      expect(await models[SubjectOffering.name].collection.countDocuments({})).toBe(5);
    });

    it('is idempotent — importing twice does not double anything', async () => {
      await importPlan({ dryRun: false });
      const second: any = await importPlan({ dryRun: false });

      expect(second.created).toBe(0);
      expect(second.updated).toBe(5);
      expect(await models[SubjectOffering.name].collection.countDocuments({})).toBe(5);
    });

    it('quotes back the line it could not read', async () => {
      const report: any = await importPlan({ text: 'لغتي\t6\nمادة مش موجودة\t4\nرياضيات\tكتير' });

      expect(report.errors).toBe(2);
      const unknown = report.results.find((r: any) => r.line === 2);
      expect(unknown.reason).toContain('مادة مش موجودة');
      const badNumber = report.results.find((r: any) => r.line === 3);
      expect(badNumber.reason).toContain('كتير');
    });

    it('matches a subject written with different alef and ta-marbuta spelling', async () => {
      const report: any = await importPlan({ text: 'دراسات اسلاميه\t5\nتربيه فنيه\t1' });

      expect(report.errors).toBe(0);
      expect(report.results[0].subjectName).toBe('دراسات إسلامية');
      expect(report.results[1].subjectName).toBe('تربية فنية');
    });
  });

  describe('assignment sheet', () => {
    beforeEach(async () => {
      const subjects = await models[Subject.name].collection.find({}).toArray();
      for (const subject of subjects) {
        for (const grade of [gradeFour, gradeFive]) {
          await mk(models[SubjectOffering.name], {
            subjectId: subject._id, gradeLevelId: grade, termId,
            periodsPerWeek: 4, schoolId,
          });
        }
      }

      for (const name of ['فاطمة الدهاسي', 'جيهان العتيبي', 'مروة العتيبي']) {
        await mk(models[Teacher.name], {
          name, email: `${name}@x.com`, specialization: '', schoolId,
        });
      }
    });

    const importAssignments = (text: string, overrides: any = {}) =>
      asTenant(() =>
        assignmentsService.importAssignments({
          termId: String(termId), text, ...overrides,
        }),
      );

    it('reads the sheet as schools actually write it', async () => {
      const report: any = await importAssignments(
        [
          '# أنصبة المعلمات',
          'أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع + الصف الخامس',
          'أ/ جيهان العتيبي\tعلوم\tالصف الرابع',
          'مروة العتيبي | لغتي | الصف الخامس',
        ].join('\n'),
      );

      // Row one names two grades, so it becomes two assignments.
      expect(report.assigned).toBe(4);
      expect(report.errors).toBe(0);
      expect(report.written).toBe(0); // still a dry run
    });

    it('writes when committed', async () => {
      const report: any = await importAssignments(
        'أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع + الصف الخامس',
        { dryRun: false },
      );

      expect(report.written).toBe(2);
      expect(await models[TeacherAssignment.name].collection.countDocuments({})).toBe(2);
      const rows = await models[TeacherAssignment.name].collection.find({}).toArray();
      expect(rows.every((r: any) => r.classId === null)).toBe(true);
    });

    it('refuses to guess between two teachers with the same surname', async () => {
      const report: any = await importAssignments('العتيبي\tعلوم\tالصف الرابع');

      expect(report.errors).toBe(1);
      expect(report.results[0].reason).toContain('2 teachers');
      expect(report.results[0].reason).toContain('جيهان العتيبي');
    });

    it('skips a row that is already assigned', async () => {
      await importAssignments('أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع', { dryRun: false });
      const second: any = await importAssignments(
        'أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع',
        { dryRun: false },
      );

      expect(second.skipped).toBe(1);
      expect(second.written).toBe(0);
      expect(await models[TeacherAssignment.name].collection.countDocuments({})).toBe(1);
    });

    it('skips a row repeated inside the same paste', async () => {
      const report: any = await importAssignments(
        [
          'أ. فاطمة الدهاسي\tرياضيات\tالصف الرابع',
          'فاطمة الدهاسي\tرياضيات\tالصف الرابع',
        ].join('\n'),
        { dryRun: false },
      );

      expect(report.assigned).toBe(1);
      expect(report.skipped).toBe(1);
      expect(await models[TeacherAssignment.name].collection.countDocuments({})).toBe(1);
    });

    it('says when a subject is not offered to that grade', async () => {
      await models[SubjectOffering.name].collection.deleteMany({ gradeLevelId: gradeFive });

      const report: any = await importAssignments('فاطمة الدهاسي\tرياضيات\tالصف الخامس');

      expect(report.errors).toBe(1);
      expect(report.results[0].reason).toContain('not offered');
    });

    it('names the unknown teacher, subject or grade', async () => {
      const report: any = await importAssignments(
        [
          'سعاد\tرياضيات\tالصف الرابع',
          'فاطمة الدهاسي\tفلسفة\tالصف الرابع',
          'فاطمة الدهاسي\tرياضيات\tالصف العاشر',
        ].join('\n'),
      );

      expect(report.errors).toBe(3);
      expect(report.results[0].reason).toContain('سعاد');
      expect(report.results[1].reason).toContain('فلسفة');
      expect(report.results[2].reason).toContain('الصف العاشر');
    });

    it('rejects a row that is missing a column', async () => {
      const report: any = await importAssignments('فاطمة الدهاسي\tرياضيات');
      expect(report.errors).toBe(1);
      expect(report.results[0].reason).toContain('three columns');
    });

    it('keeps another school out of the match', async () => {
      const otherSchool = new Types.ObjectId();
      await mk(models[Teacher.name], {
        name: 'فاطمة الدهاسي', email: 'other@x.com', schoolId: otherSchool,
      });

      // Two teachers share the name across schools, but only one is visible.
      const report: any = await importAssignments('فاطمة الدهاسي\tرياضيات\tالصف الرابع');
      expect(report.errors).toBe(0);
      expect(report.assigned).toBe(1);
    });
  });
});
