import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TimetableService } from './timetable.service';
import { Lecture, LectureSchema } from './schemas/lecture.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import {
  TeacherAssignment,
  TeacherAssignmentSchema,
} from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import { School, SchoolSchema } from '../platform/schools/schemas/school.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';

describe('TimetableService', () => {
  let moduleRef: TestingModule;
  let service: TimetableService;
  let models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const academicYearId = new Types.ObjectId();
  const termId = new Types.ObjectId();

  let gradeFour: Types.ObjectId;
  let gradeFive: Types.ObjectId;
  let maths: any;
  let science: any;
  let arabic: any;
  let classes: Record<string, any> = {};
  let teachers: Record<string, any> = {};

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const mk = async (model: any, doc: any) =>
    (await model.collection.insertOne(doc)).insertedId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: Lecture.name, schema: LectureSchema },
          { name: Class.name, schema: ClassSchema },
          { name: SubjectOffering.name, schema: SubjectOfferingSchema },
          { name: TeacherAssignment.name, schema: TeacherAssignmentSchema },
          { name: Term.name, schema: TermSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Subject.name, schema: SubjectSchema },
          { name: School.name, schema: SchoolSchema },
        ]),
      ],
      providers: [TimetableService],
    }).compile();

    service = moduleRef.get(TimetableService);
    for (const name of [
      Lecture.name, Class.name, SubjectOffering.name, TeacherAssignment.name,
      Term.name, Teacher.name, Subject.name, School.name,
    ]) {
      models[name] = moduleRef.get(getModelToken(name));
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** A five-day week of seven periods = 35 slots per class. */
  const setSchoolWeek = async (periodsPerDay = 7, workingDays = 5) => {
    const all = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    await models[School.name].collection.updateOne(
      { _id: schoolId },
      {
        $set: {
          'settings.periodsPerDay': periodsPerDay,
          'settings.workSchedule': all.map((day, i) => ({
            day,
            isWorkingDay: i < workingDays,
            startTime: null,
            endTime: null,
          })),
        },
      },
      { upsert: true },
    );
  };

  beforeEach(async () => {
    for (const model of Object.values(models)) {
      await model.collection.deleteMany({});
    }

    await mk(models[School.name], {
      _id: schoolId,
      name: 'مدرسة الاختبار',
      slug: `test-${Date.now()}`,
      settings: {},
    });
    await setSchoolWeek();

    await mk(models[Term.name], {
      _id: termId, academicYearId, name: 'الترم الأول', order: 1,
      startDate: new Date(), endDate: new Date(), status: 'active', schoolId,
    });

    gradeFour = new Types.ObjectId();
    gradeFive = new Types.ObjectId();

    const mkSubject = async (name: string) =>
      mk(models[Subject.name], { subjectName: name, isRequiredForPromotion: true, schoolId });

    const mkOffering = async (subjectId: any, gradeLevelId: any, periodsPerWeek: number) => {
      const _id = await mk(models[SubjectOffering.name], {
        subjectId, gradeLevelId, termId, periodsPerWeek, schoolId,
      });
      return { _id, subjectId, gradeLevelId, periodsPerWeek };
    };

    maths = await mkOffering(await mkSubject('رياضيات'), gradeFour, 6);
    science = await mkOffering(await mkSubject('علوم'), gradeFour, 4);
    arabic = await mkOffering(await mkSubject('لغتي'), gradeFive, 6);

    const mkClass = async (name: string, gradeLevelId: any) =>
      mk(models[Class.name], {
        name, gradeLevelId, academicYearId, gender: 'male',
        maxCapacity: 30, isActive: true, schoolId,
      });

    classes = {
      a: await mkClass('٤/١', gradeFour),
      b: await mkClass('٤/٢', gradeFour),
      c: await mkClass('٥/١', gradeFive),
    };

    const mkTeacher = async (name: string, specialization: string) =>
      mk(models[Teacher.name], { name, email: `${name}@x.com`, specialization, schoolId });

    teachers = {
      fatima: await mkTeacher('أ. فاطمة', 'رياضيات'),
      jihan: await mkTeacher('أ. جيهان', 'علوم'),
      marwa: await mkTeacher('أ. مروة', 'لغتي'),
    };
  });

  const assign = (teacherId: any, offering: any, classId: any = null) =>
    mk(models[TeacherAssignment.name], {
      teacherId, subjectOfferingId: offering._id, classId, schoolId,
    });

  const feasibility = () =>
    asTenant(() => service.getFeasibility(String(termId), schoolId));

  describe('capacity', () => {
    it('multiplies working days by periods per day', async () => {
      const capacity = await asTenant(() => service.getCapacity(schoolId));
      expect(capacity.workingDays).toHaveLength(5);
      expect(capacity.periodsPerDay).toBe(7);
      expect(capacity.slotsPerWeek).toBe(35);
    });

    it('counts only working days', async () => {
      await setSchoolWeek(7, 4);
      const capacity = await asTenant(() => service.getCapacity(schoolId));
      expect(capacity.slotsPerWeek).toBe(28);
    });

    it('falls back to a five-day week when nothing is configured', async () => {
      await models[School.name].collection.updateOne(
        { _id: schoolId },
        { $set: { 'settings.workSchedule': [] }, $unset: { 'settings.periodsPerDay': '' } },
      );
      const capacity = await asTenant(() => service.getCapacity(schoolId));
      expect(capacity.scheduleConfigured).toBe(false);
      expect(capacity.slotsPerWeek).toBe(35);
    });
  });

  describe('buildRequirements', () => {
    it('expands a grade plan across every section of that grade', async () => {
      await assign(teachers.fatima, maths);

      const { requirements } = await asTenant(() =>
        service.buildRequirements(String(termId)),
      );

      // Maths is planned once for grade 4 but grade 4 has two classes.
      const mathRows = requirements.filter((r) => r.subjectName === 'رياضيات');
      expect(mathRows).toHaveLength(2);
      expect(mathRows.every((r) => r.teacherName === 'أ. فاطمة')).toBe(true);
      expect(mathRows.every((r) => r.periodsPerWeek === 6)).toBe(true);
    });

    it('does not leak a grade plan into another grade', async () => {
      const { requirements } = await asTenant(() =>
        service.buildRequirements(String(termId)),
      );
      const arabicRows = requirements.filter((r) => r.subjectName === 'لغتي');
      expect(arabicRows).toHaveLength(1);
      expect(arabicRows[0].className).toBe('٥/١');
    });

    it('prefers a teacher pinned to the class over the grade-wide one', async () => {
      await assign(teachers.fatima, maths);              // whole grade
      await assign(teachers.jihan, maths, classes.b);    // except 4/2

      const { requirements } = await asTenant(() =>
        service.buildRequirements(String(termId)),
      );

      const four2 = requirements.find(
        (r) => r.className === '٤/٢' && r.subjectName === 'رياضيات',
      );
      const four1 = requirements.find(
        (r) => r.className === '٤/١' && r.subjectName === 'رياضيات',
      );
      expect(four2.teacherName).toBe('أ. جيهان');
      expect(four1.teacherName).toBe('أ. فاطمة');
    });

    it('splits sections between teachers who share a grade, and does it the same way twice', async () => {
      await assign(teachers.fatima, maths);
      await assign(teachers.jihan, maths);

      const first = await asTenant(() => service.buildRequirements(String(termId)));
      const second = await asTenant(() => service.buildRequirements(String(termId)));

      const names = (result: any) =>
        result.requirements
          .filter((r: any) => r.subjectName === 'رياضيات')
          .map((r: any) => `${r.className}:${r.teacherName}`)
          .sort();

      expect(new Set(names(first)).size).toBe(2); // not both on one teacher
      // A generator that reshuffles teachers between runs is unusable.
      expect(names(first)).toEqual(names(second));
      expect(first.sharedOfferings).toHaveLength(1);
    });

    it('leaves the teacher null when nobody is assigned', async () => {
      const { requirements } = await asTenant(() =>
        service.buildRequirements(String(termId)),
      );
      expect(requirements.every((r) => r.teacherId === null)).toBe(true);
    });

    it('refuses a term with no active classes rather than reporting a happy empty plan', async () => {
      await models[Class.name].collection.deleteMany({});
      await expect(
        asTenant(() => service.buildRequirements(String(termId))),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('feasibility', () => {
    it('passes a plan that fits', async () => {
      await assign(teachers.fatima, maths);
      await assign(teachers.jihan, science);
      await assign(teachers.marwa, arabic);

      const report = await feasibility();

      expect(report.feasible).toBe(true);
      expect(report.slotsPerWeek).toBe(35);
      // (6 + 4) × two grade-4 classes + 6 × one grade-5 class
      expect(report.totalPeriodsNeeded).toBe(26);
      expect(report.problems.filter((p) => p.blocking)).toHaveLength(0);
    });

    it('reports a class whose plan exceeds its week', async () => {
      await models[SubjectOffering.name].collection.updateOne(
        { _id: maths._id },
        { $set: { periodsPerWeek: 20 } },
      );
      await models[SubjectOffering.name].collection.updateOne(
        { _id: science._id },
        { $set: { periodsPerWeek: 20 } },
      );

      const report = await feasibility();

      expect(report.feasible).toBe(false);
      const problem = report.problems.find((p) => p.type === 'class_overbooked');
      expect(problem.required).toBe(40);
      expect(problem.capacity).toBe(35);
      expect(problem.message).toContain('40');
    });

    it('names the overloaded teacher and the two numbers', async () => {
      // One teacher taking maths and science across both grade-4 classes:
      // (6 + 4) × 2 = 20. Push maths up so the total clears 35.
      await models[SubjectOffering.name].collection.updateOne(
        { _id: maths._id },
        { $set: { periodsPerWeek: 15 } },
      );
      await assign(teachers.fatima, maths);
      await assign(teachers.fatima, science);

      const report = await feasibility();

      const problem = report.problems.find((p) => p.type === 'teacher_overloaded');
      expect(problem).toBeDefined();
      expect(problem.required).toBe(38); // (15 + 4) × 2
      expect(problem.capacity).toBe(35);
      expect(problem.teacherName).toBe('أ. فاطمة');
      expect(problem.message).toContain('أ. فاطمة');
      expect(report.feasible).toBe(false);
    });

    it('ranks teachers by load, heaviest first', async () => {
      await assign(teachers.fatima, maths);    // 6 × 2 = 12
      await assign(teachers.jihan, science);   // 4 × 2 = 8

      const report = await feasibility();

      expect(report.teachers[0].name).toBe('أ. فاطمة');
      expect(report.teachers[0].load).toBe(12);
      expect(report.teachers[1].load).toBe(8);
      expect(report.teachers[0].free).toBe(23);
    });

    it('flags unstaffed subjects without blocking — they schedule as gaps', async () => {
      await assign(teachers.fatima, maths);

      const report = await feasibility();

      const problem = report.problems.find((p) => p.type === 'subject_unassigned');
      expect(problem.blocking).toBe(false);
      expect(report.feasible).toBe(true);
      // science × 2 classes + arabic × 1
      expect(report.unassignedSubjects).toHaveLength(3);
    });

    it('warns when two teachers share a grade with nobody pinned', async () => {
      await assign(teachers.fatima, maths);
      await assign(teachers.jihan, maths);

      const report = await feasibility();

      const problem = report.problems.find((p) => p.type === 'assignment_shared');
      expect(problem.blocking).toBe(false);
      expect(problem.teacherCount).toBe(2);
    });

    it('blocks when nothing has been planned', async () => {
      await models[SubjectOffering.name].collection.updateMany(
        {},
        { $set: { periodsPerWeek: 0 } },
      );

      const report = await feasibility();

      expect(report.feasible).toBe(false);
      expect(report.problems.some((p) => p.type === 'nothing_planned')).toBe(true);
    });

    it('blocks when the week has no working days', async () => {
      await setSchoolWeek(7, 0);
      await assign(teachers.fatima, maths);

      const report = await feasibility();

      expect(report.feasible).toBe(false);
      expect(report.problems.some((p) => p.type === 'no_working_days')).toBe(true);
    });

    it('reports free slots per class', async () => {
      const report = await feasibility();
      const four1 = report.classes.find((c) => c.name === '٤/١');
      expect(four1.demand).toBe(10);   // maths 6 + science 4
      expect(four1.free).toBe(25);
      expect(four1.ok).toBe(true);
    });

    it('ignores another school entirely', async () => {
      const otherSchool = new Types.ObjectId();
      await mk(models[Class.name], {
        name: 'غريب/١', gradeLevelId: gradeFour, academicYearId, gender: 'male',
        maxCapacity: 30, isActive: true, schoolId: otherSchool,
      });

      const report = await feasibility();

      expect(report.classes.map((c) => c.name)).not.toContain('غريب/١');
      expect(report.classes).toHaveLength(3);
    });
  });

  describe('generate', () => {
    /** A staffed, comfortably-fitting school: 10 + 10 + 6 = 26 periods. */
    const staffEverything = async () => {
      await assign(teachers.fatima, maths);
      await assign(teachers.jihan, science);
      await assign(teachers.marwa, arabic);
    };

    const generate = (overrides: any = {}) =>
      asTenant(() =>
        service.generate({ termId: String(termId), ...overrides }, schoolId),
      );

    it('places every planned period', async () => {
      await staffEverything();

      const result: any = await generate();

      // (6 maths + 4 science) × two grade-4 classes + 6 arabic × one grade-5
      expect(result.placed).toBe(26);
      expect(result.unplaced).toBe(0);
      expect(result.problems.filter((p: any) => p.blocking)).toHaveLength(0);
    });

    it('writes nothing in preview mode', async () => {
      await staffEverything();

      const result: any = await generate();

      expect(result.mode).toBe('preview');
      expect(result.written).toBe(false);
      expect(await models[Lecture.name].collection.countDocuments({})).toBe(0);
    });

    it('never books a class into two lessons at once', async () => {
      await staffEverything();

      const result: any = await generate();

      const seen = new Set<string>();
      for (const cls of result.classes) {
        for (const day of cls.days) {
          for (const slot of day.slots) {
            if (!slot.subjectOfferingId) continue;
            const cell = `${cls.classId}|${day.dayOfWeek}|${slot.slot}`;
            expect(seen.has(cell)).toBe(false);
            seen.add(cell);
          }
        }
      }
    });

    it('never books a teacher into two classes at once', async () => {
      await staffEverything();

      const result: any = await generate();

      const seen = new Set<string>();
      for (const cls of result.classes) {
        for (const day of cls.days) {
          for (const slot of day.slots) {
            if (!slot.teacherId) continue;
            const cell = `${slot.teacherId}|${day.dayOfWeek}|${slot.slot}`;
            expect(seen.has(cell)).toBe(false);
            seen.add(cell);
          }
        }
      }
    });

    it('gives each class exactly the periods its plan asks for', async () => {
      await staffEverything();

      const result: any = await generate();

      const four1 = result.classes.find((c: any) => c.className === '٤/١');
      expect(four1.periods).toBe(10);

      const counts = new Map<string, number>();
      for (const day of four1.days) {
        for (const slot of day.slots) {
          if (!slot.subjectName) continue;
          counts.set(slot.subjectName, (counts.get(slot.subjectName) ?? 0) + 1);
        }
      }
      expect(counts.get('رياضيات')).toBe(6);
      expect(counts.get('علوم')).toBe(4);
    });

    it('spreads a subject as evenly as the week allows', async () => {
      await staffEverything();

      const result: any = await generate();

      const four1 = result.classes.find((c: any) => c.className === '٤/١');
      const perDay = four1.days.map(
        (day: any) => day.slots.filter((s: any) => s.subjectName === 'رياضيات').length,
      );

      // Six maths periods over five working days cannot fit one a day — by
      // pigeonhole some day takes two. The point is that it is two and not
      // six: an evenly spread week, not a Sunday of nothing but maths.
      expect(Math.max(...perDay)).toBe(2);
      expect(perDay.filter((n: number) => n > 0)).toHaveLength(5);
      expect(perDay.reduce((a: number, b: number) => a + b, 0)).toBe(6);
    });

    it('honours maxSamePerDay when asked for doubles', async () => {
      await staffEverything();

      const result: any = await generate({ maxSamePerDay: 2 });

      const four1 = result.classes.find((c: any) => c.className === '٤/١');
      for (const day of four1.days) {
        const maths = day.slots.filter((s: any) => s.subjectName === 'رياضيات');
        expect(maths.length).toBeLessThanOrEqual(2);
      }
    });

    it('schedules unstaffed subjects as visible gaps', async () => {
      await assign(teachers.fatima, maths); // science and arabic have nobody

      const result: any = await generate();

      expect(result.placed).toBe(26);
      const unstaffed: any[] = [];
      for (const cls of result.classes) {
        for (const day of cls.days) {
          for (const slot of day.slots) {
            if (slot.subjectOfferingId && !slot.teacherId) unstaffed.push(slot);
          }
        }
      }
      expect(unstaffed.length).toBe(14); // science 4×2 + arabic 6
    });

    it('can be told to leave unstaffed subjects out entirely', async () => {
      await assign(teachers.fatima, maths);

      const result: any = await generate({ includeUnstaffed: false });

      expect(result.placed).toBe(12); // maths only, both grade-4 classes
    });

    it('is deterministic — two previews match', async () => {
      await staffEverything();

      const first: any = await generate();
      const second: any = await generate();

      expect(JSON.stringify(first.classes)).toBe(JSON.stringify(second.classes));
    });

    it('commits real lectures', async () => {
      await staffEverything();

      const result: any = await generate({ mode: 'commit' });

      expect(result.mode).toBe('commit');
      expect(result.written).toBe(26);
      expect(result.failed).toBe(0);
      expect(await models[Lecture.name].collection.countDocuments({})).toBe(26);

      const one = await models[Lecture.name].collection.findOne({});
      expect(one.termId).toBeDefined();
      expect(one.preparation).toEqual([]);
    });

    it('leaves a hand-built timetable alone by default', async () => {
      await staffEverything();
      await models[Lecture.name].collection.insertOne({
        classId: classes.a, subjectOfferingId: maths._id, termId,
        teacherId: teachers.fatima, dayOfWeek: 'sunday', slot: 1,
        preparation: [], schoolId,
      });

      const result: any = await generate({ mode: 'commit' });

      // 4/1 is skipped whole; 4/2 and 5/1 are still built.
      expect(result.skippedClasses).toBe(1);
      expect(result.classes.map((c: any) => c.className)).not.toContain('٤/١');
      const fourOne = await models[Lecture.name].collection.countDocuments({
        classId: classes.a,
      });
      expect(fourOne).toBe(1); // untouched
    });

    it('rebuilds when told to replace', async () => {
      await staffEverything();
      await models[Lecture.name].collection.insertOne({
        classId: classes.a, subjectOfferingId: maths._id, termId,
        teacherId: teachers.fatima, dayOfWeek: 'sunday', slot: 1,
        preparation: [], schoolId,
      });

      const result: any = await generate({ mode: 'commit', onExisting: 'replace' });

      expect(result.deleted).toBe(1);
      expect(result.written).toBe(26);
      expect(await models[Lecture.name].collection.countDocuments({})).toBe(26);
    });

    it('reports what it could not place instead of failing the whole run', async () => {
      // One teacher for everything: (6 + 4) × 2 + 6 = 26 periods for one
      // person, which fits, so push maths up until it cannot.
      await models[SubjectOffering.name].collection.updateOne(
        { _id: maths._id }, { $set: { periodsPerWeek: 18 } },
      );
      await assign(teachers.fatima, maths);
      await assign(teachers.fatima, science);
      await assign(teachers.fatima, arabic);

      const result: any = await generate();

      // 18×2 + 4×2 + 6 = 50 periods for a 35-slot week.
      expect(result.unplaced).toBeGreaterThan(0);
      expect(result.placed).toBeGreaterThan(0); // the rest still got built
      const problem = result.problems.find((p: any) => p.type === 'no_slot_left');
      expect(problem.blocking).toBe(false);
      expect(problem.className).toBeDefined();
      expect(problem.subjectName).toBeDefined();
    });

    it('handles a realistic school — 6 grades, 12 classes, 8 subjects', async () => {
      // 6 grades × 8 subjects = 48 offerings, 30 periods a week each, across
      // 12 classes = 360 periods. A real school, not a toy.
      const plan = [
        ['لغتي', 6], ['رياضيات', 6], ['دراسات إسلامية', 5], ['علوم', 4],
        ['إنجليزي', 4], ['تربية بدنية', 2], ['مهارات رقمية', 2], ['تربية فنية', 1],
      ] as [string, number][];

      const grades = Array.from({ length: 6 }, () => new Types.ObjectId());

      // One teacher per subject per two grades, so nobody is over 35 periods:
      // 30 periods a grade / 8 subjects, two classes each.
      for (const [subjectName, periods] of plan) {
        const subjectId = await mk(models[Subject.name], {
          subjectName, isRequiredForPromotion: true, schoolId,
        });

        for (let g = 0; g < grades.length; g++) {
          const offeringId = await mk(models[SubjectOffering.name], {
            subjectId, gradeLevelId: grades[g], termId,
            periodsPerWeek: periods, schoolId,
          });

          const teacherId = await mk(models[Teacher.name], {
            name: `${subjectName}-${g}`, email: `${subjectName}${g}@x.com`,
            specialization: subjectName, schoolId,
          });

          await mk(models[TeacherAssignment.name], {
            teacherId, subjectOfferingId: offeringId, classId: null, schoolId,
          });
        }
      }

      for (let g = 0; g < grades.length; g++) {
        for (const section of [1, 2]) {
          await mk(models[Class.name], {
            name: `${g + 1}/${section}`, gradeLevelId: grades[g], academicYearId,
            gender: 'male', maxCapacity: 30, isActive: true, schoolId,
          });
        }
      }

      const started = Date.now();
      const result: any = await generate();
      const elapsed = Date.now() - started;

      // 12 new classes × 30 periods, plus the 26 from the base fixture.
      expect(result.placed).toBe(386);
      expect(result.unplaced).toBe(0);
      expect(elapsed).toBeLessThan(10_000);

      // And nothing conflicts.
      const classCells = new Set<string>();
      const teacherCells = new Set<string>();
      for (const cls of result.classes) {
        for (const day of cls.days) {
          for (const slot of day.slots) {
            if (!slot.subjectOfferingId) continue;
            const c = `${cls.classId}|${day.dayOfWeek}|${slot.slot}`;
            expect(classCells.has(c)).toBe(false);
            classCells.add(c);
            if (slot.teacherId) {
              const t = `${slot.teacherId}|${day.dayOfWeek}|${slot.slot}`;
              expect(teacherCells.has(t)).toBe(false);
              teacherCells.add(t);
            }
          }
        }
      }
    }, 30_000);

    it('refuses a week with no working days', async () => {
      await setSchoolWeek(7, 0);
      await staffEverything();

      await expect(generate()).rejects.toMatchObject({ status: 400 });
    });

    it('says so when there is nothing planned', async () => {
      await models[SubjectOffering.name].collection.updateMany(
        {}, { $set: { periodsPerWeek: 0 } },
      );

      const result: any = await generate();

      expect(result.placed).toBe(0);
      expect(result.problems[0].type).toBe('nothing_planned');
      expect(result.problems[0].blocking).toBe(true);
    });

    it('splits a shared grade between both teachers', async () => {
      await assign(teachers.fatima, maths);
      await assign(teachers.jihan, maths);

      const result: any = await generate();

      const mathTeachers = new Set<string>();
      for (const cls of result.classes) {
        for (const day of cls.days) {
          for (const slot of day.slots) {
            if (slot.subjectName === 'رياضيات' && slot.teacherId) {
              mathTeachers.add(slot.teacherId);
            }
          }
        }
      }
      expect(mathTeachers.size).toBe(2);
    });

    it('only touches the classes it was asked for', async () => {
      await staffEverything();

      const result: any = await generate({
        mode: 'commit',
        classIds: [String(classes.c)],
      });

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0].className).toBe('٥/١');
      expect(await models[Lecture.name].collection.countDocuments({})).toBe(6);
    });

    it('produces a timetable the database accepts', async () => {
      // The unique indexes are the real guarantee. If the search were wrong,
      // the commit would report failures rather than silently double-booking.
      await models[Lecture.name].createIndexes();
      await staffEverything();

      const result: any = await generate({ mode: 'commit' });

      expect(result.failed).toBe(0);
      expect(result.written).toBe(result.placed);
    });
  });

  describe('the DB is the safety net', () => {
    it('rejects a second lecture in the same class slot', async () => {
      await models[Lecture.name].createIndexes();
      const base = {
        classId: classes.a, subjectOfferingId: maths._id, termId,
        teacherId: teachers.fatima, dayOfWeek: 'sunday', slot: 1,
        preparation: [], schoolId,
      };
      await models[Lecture.name].collection.insertOne({ ...base });

      await expect(
        models[Lecture.name].collection.insertOne({
          ...base, teacherId: teachers.jihan, subjectOfferingId: science._id,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('rejects the same teacher in two classes at once', async () => {
      await models[Lecture.name].createIndexes();
      const base = {
        subjectOfferingId: maths._id, termId, teacherId: teachers.fatima,
        dayOfWeek: 'sunday', slot: 1, preparation: [], schoolId,
      };
      await models[Lecture.name].collection.insertOne({ ...base, classId: classes.a });

      await expect(
        models[Lecture.name].collection.insertOne({ ...base, classId: classes.b }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('still allows two unstaffed slots at the same time', async () => {
      await models[Lecture.name].createIndexes();
      const base = {
        subjectOfferingId: maths._id, termId, teacherId: null,
        dayOfWeek: 'monday', slot: 2, preparation: [], schoolId,
      };
      await models[Lecture.name].collection.insertOne({ ...base, classId: classes.a });
      // The teacher index is partial on teacherId != null, so "needs a
      // teacher" does not collide with itself across classes.
      await expect(
        models[Lecture.name].collection.insertOne({ ...base, classId: classes.b }),
      ).resolves.toBeDefined();
    });
  });

  describe('teacher assignment uniqueness', () => {
    it('allows one teacher on two sections of the same grade', async () => {
      await models[TeacherAssignment.name].createIndexes();
      // The old key was (schoolId, teacherId, subjectOfferingId), which made
      // this impossible — the very case classId exists for.
      await assign(teachers.fatima, maths, classes.a);
      await expect(assign(teachers.fatima, maths, classes.b)).resolves.toBeDefined();
    });

    it('still rejects the exact same assignment twice', async () => {
      await models[TeacherAssignment.name].createIndexes();
      await assign(teachers.fatima, maths, classes.a);
      await expect(assign(teachers.fatima, maths, classes.a)).rejects.toMatchObject({
        code: 11000,
      });
    });
  });
});
