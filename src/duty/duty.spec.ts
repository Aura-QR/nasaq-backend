import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DutyService } from './duty.service';
import { LeaveRequest, LeaveRequestSchema } from './schemas/leave-request.schema';
import { DutySupervisor, DutySupervisorSchema } from './schemas/duty-supervisor.schema';
import { Substitution, SubstitutionSchema } from './schemas/substitution.schema';
import { Teacher, TeacherSchema } from '../teachers/schemas/teacher.schema';
import { Lecture, LectureSchema } from '../lectures/schemas/lecture.schema';
import {
  TeacherAttendance,
  TeacherAttendanceSchema,
} from '../teacher-attendance/schemas/teacher-attendance.schema';
import { Term, TermSchema } from '../terms/schemas/term.schema';
import { Class, ClassSchema } from '../classes/schemas/class.schema';
import { Subject, SubjectSchema } from '../subjects/schemas/subject.schema';
import {
  SubjectOffering,
  SubjectOfferingSchema,
} from '../subject-offerings/schemas/subject-offering.schema';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';

/** A Sunday, so the weekday is fixed however the suite is run. */
const DATE = '2026-11-15';

describe('DutyService', () => {
  let moduleRef: TestingModule;
  let service: DutyService;
  const models: Record<string, any> = {};

  const schoolId = new Types.ObjectId();
  const academicYearId = new Types.ObjectId();
  const termId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();

  let classA: any;
  let classB: any;
  let arabicTeacher: any;   // teaches slot 1 and 2
  let mathsTeacher: any;    // teaches slot 1 only
  let freeTeacher: any;     // teaches nothing
  let arabicSpecialist: any;
  let L1: any;              // arabic, classA, sunday slot 1
  let L2: any;              // arabic, classA, sunday slot 2
  let L3: any;              // maths,  classB, sunday slot 1

  const OWNER = { userId: String(new Types.ObjectId()), role: 'OWNER', schoolId, name: 'المالك' };

  const asTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantLocalStorage.run({ schoolId: String(schoolId) } as any, fn);

  const mk = async (model: any, doc: any) =>
    (await model.collection.insertOne(doc)).insertedId;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(URI),
        MongooseModule.forFeature([
          { name: LeaveRequest.name, schema: LeaveRequestSchema },
          { name: DutySupervisor.name, schema: DutySupervisorSchema },
          { name: Substitution.name, schema: SubstitutionSchema },
          { name: Teacher.name, schema: TeacherSchema },
          { name: Lecture.name, schema: LectureSchema },
          { name: TeacherAttendance.name, schema: TeacherAttendanceSchema },
          { name: Term.name, schema: TermSchema },
          { name: Class.name, schema: ClassSchema },
          { name: Subject.name, schema: SubjectSchema },
          { name: SubjectOffering.name, schema: SubjectOfferingSchema },
        ]),
      ],
      providers: [DutyService],
    }).compile();

    service = moduleRef.get(DutyService);
    for (const name of [
      LeaveRequest.name, DutySupervisor.name, Substitution.name, Teacher.name,
      Lecture.name, TeacherAttendance.name, Term.name, Class.name,
      Subject.name, SubjectOffering.name,
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

    const arabicSubject = await mk(models[Subject.name], {
      subjectName: 'اللغة العربية', isRequiredForPromotion: true, schoolId,
    });
    const mathsSubject = await mk(models[Subject.name], {
      subjectName: 'الرياضيات', isRequiredForPromotion: true, schoolId,
    });
    const arabicOffering = await mk(models[SubjectOffering.name], {
      subjectId: arabicSubject, gradeLevelId: gradeId, termId,
      periodsPerWeek: 6, schoolId,
    });
    const mathsOffering = await mk(models[SubjectOffering.name], {
      subjectId: mathsSubject, gradeLevelId: gradeId, termId,
      periodsPerWeek: 6, schoolId,
    });

    const mkClass = async (name: string) => mk(models[Class.name], {
      name, gradeLevelId: gradeId, academicYearId, gender: 'male',
      maxCapacity: 30, isActive: true, schoolId,
    });
    classA = await mkClass('م١/أ');
    classB = await mkClass('م١/ب');

    const mkTeacher = async (name: string, specialization = '') =>
      mk(models[Teacher.name], {
        name, email: `${name}@x.com`, specialization, isActive: true, schoolId,
      });

    arabicTeacher = await mkTeacher('أ. أروى', 'اللغة العربية');
    mathsTeacher = await mkTeacher('أ. هيا', 'الرياضيات');
    freeTeacher = await mkTeacher('أ. سارة', 'علوم');
    arabicSpecialist = await mkTeacher('أ. منى', 'اللغة العربية');

    const lec = (classId: any, offering: any, teacherId: any, slot: number) =>
      mk(models[Lecture.name], {
        classId, subjectOfferingId: offering, termId, teacherId,
        dayOfWeek: 'sunday', slot, preparation: [], schoolId,
      });

    L1 = await lec(classA, arabicOffering, arabicTeacher, 1);
    L2 = await lec(classA, arabicOffering, arabicTeacher, 2);
    L3 = await lec(classB, mathsOffering, mathsTeacher, 1);
  });

  /** Everyone checks in except the ones named. */
  const checkInAllExcept = async (...absentIds: any[]) => {
    const absent = absentIds.map(String);
    const teachers = await models[Teacher.name].collection.find({}).toArray();
    for (const teacher of teachers) {
      if (absent.includes(String(teacher._id))) continue;
      await mk(models[TeacherAttendance.name], {
        teacherId: teacher._id,
        date: new Date(`${DATE}T00:00:00.000Z`),
        checkInAt: new Date(`${DATE}T07:00:00.000Z`),
        method: 'manual', schoolId, isWorkingDay: true,
      });
    }
  };

  const coverage = () => asTenant(() => service.getCoverage(DATE, OWNER));

  describe('leave requests', () => {
    const file = (overrides: any = {}) =>
      asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '11:30', ...overrides },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );

    it('files a request for the teacher making it', async () => {
      const result: any = await file({ reason: 'ظرف عائلي' });

      expect(String(result.data.teacherId)).toBe(String(arabicTeacher));
      expect(result.data.teacherName).toBe('أ. أروى');
      expect(result.data.status).toBe('pending');
      expect(result.data.leaveAt).toBe('11:30');
    });

    it('ignores a teacherId sent by a teacher', async () => {
      const result: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00', teacherId: String(mathsTeacher) },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      expect(String(result.data.teacherId)).toBe(String(arabicTeacher));
    });

    it('treats a second request for the same day as an edit', async () => {
      await file({ leaveAt: '11:30' });
      const second: any = await file({ leaveAt: '10:00', fromSlot: 2 });

      expect(second.data.leaveAt).toBe('10:00');
      expect(second.data.fromSlot).toBe(2);
      expect(await models[LeaveRequest.name].collection.countDocuments({})).toBe(1);
    });

    it('refuses to silently rewrite a request already reviewed', async () => {
      const filed: any = await file();
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );

      await expect(file({ leaveAt: '09:00' })).rejects.toMatchObject({ status: 400 });
    });

    it('records who approved it and when', async () => {
      const filed: any = await file();
      const reviewed: any = await asTenant(() =>
        service.reviewLeaveRequest(
          String(filed.data._id),
          { status: 'approved', reviewNote: 'موافق' },
          OWNER,
        ),
      );

      expect(reviewed.data.status).toBe('approved');
      expect(String(reviewed.data.reviewedBy)).toBe(OWNER.userId);
      expect(reviewed.data.reviewedByName).toBe('المالك');
      expect(reviewed.data.reviewedAt).toBeTruthy();
    });

    it('does not let a teacher approve their own', async () => {
      const filed: any = await file();
      await expect(
        asTenant(() =>
          service.reviewLeaveRequest(
            String(filed.data._id),
            { status: 'approved' },
            { userId: String(arabicTeacher), role: 'TEACHER' },
          ),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('shows a teacher only their own', async () => {
      await file();
      await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '12:00' },
          { userId: String(mathsTeacher), role: 'TEACHER' },
        ),
      );

      const mine: any = await asTenant(() =>
        service.listLeaveRequests({}, { userId: String(arabicTeacher), role: 'TEACHER' }),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].teacherName).toBe('أ. أروى');

      const all: any = await asTenant(() => service.listLeaveRequests({}, OWNER));
      expect(all).toHaveLength(2);
    });

    it('lets a teacher cancel their own while pending, but not after review', async () => {
      const filed: any = await file();
      const teacher = { userId: String(arabicTeacher), role: 'TEACHER' };

      await asTenant(() => service.cancelLeaveRequest(String(filed.data._id), teacher));
      expect(await models[LeaveRequest.name].collection.countDocuments({})).toBe(0);

      const again: any = await file();
      await asTenant(() =>
        service.reviewLeaveRequest(String(again.data._id), { status: 'approved' }, OWNER),
      );
      await expect(
        asTenant(() => service.cancelLeaveRequest(String(again.data._id), teacher)),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('does not let a teacher cancel somebody else\'s', async () => {
      const filed: any = await file();
      await expect(
        asTenant(() =>
          service.cancelLeaveRequest(String(filed.data._id), {
            userId: String(mathsTeacher),
            role: 'TEACHER',
          }),
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('duty supervisors', () => {
    it('stores names alongside ids so a roster reads without populating', async () => {
      const result: any = await asTenant(() =>
        service.setSupervisors(
          { date: DATE, teacherIds: [String(freeTeacher), String(mathsTeacher)] },
          OWNER,
        ),
      );

      expect(result.data.teacherNames).toEqual(['أ. سارة', 'أ. هيا']);
      expect(result.data.date).toBe(DATE);
    });

    it('replaces the day rather than appending', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(mathsTeacher)] }, OWNER),
      );

      const rows: any = await asTenant(() => service.getSupervisors({ date: DATE }));
      expect(rows).toHaveLength(1);
      expect(rows[0].teacherNames).toEqual(['أ. هيا']);
    });

    it('clears the day with an empty list', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      await asTenant(() => service.setSupervisors({ date: DATE, teacherIds: [] }, OWNER));

      const rows: any = await asTenant(() => service.getSupervisors({ date: DATE }));
      expect(rows[0].teacherIds).toHaveLength(0);
    });

    it('refuses an unknown teacher instead of storing a dangling id', async () => {
      await expect(
        asTenant(() =>
          service.setSupervisors(
            { date: DATE, teacherIds: [String(new Types.ObjectId())] },
            OWNER,
          ),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('the cover board', () => {
    it('lists the absent teacher\'s lectures, and nobody else\'s', async () => {
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();

      expect(board.stats.needCover).toBe(2);   // أروى teaches slots 1 and 2
      expect(board.uncovered.map((u: any) => u.slot).sort()).toEqual([1, 2]);
      expect(board.uncovered.every((u: any) => u.reason === 'absent')).toBe(true);
      expect(board.absentTeachers.map((t: any) => t.name)).toEqual(['أ. أروى']);
    });

    it('suggests only teachers who are free in that exact slot', async () => {
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();
      const slot1 = board.uncovered.find((u: any) => u.slot === 1);
      const names = slot1.suggestions.map((s: any) => s.name);

      // هيا teaches her own class in slot 1, so she cannot cover it.
      expect(names).not.toContain('أ. هيا');
      expect(names).toContain('أ. سارة');
      expect(names).toContain('أ. منى');
      // أروى is the one being covered for.
      expect(names).not.toContain('أ. أروى');
    });

    it('puts a specialist in the subject first', async () => {
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();
      const slot1 = board.uncovered.find((u: any) => u.slot === 1);

      // Both are free; منى teaches Arabic, سارة teaches science.
      expect(slot1.suggestions[0].name).toBe('أ. منى');
      expect(slot1.suggestions[0].sameSubject).toBe(true);
    });

    it('does not offer somebody who is also off today', async () => {
      await checkInAllExcept(arabicTeacher, freeTeacher);

      const board: any = await coverage();
      const slot1 = board.uncovered.find((u: any) => u.slot === 1);

      expect(slot1.suggestions.map((s: any) => s.name)).not.toContain('أ. سارة');
    });

    it('flags nothing when nobody has checked in yet', async () => {
      // Early morning, or a school not using check-in at all. Treating the
      // whole staff as absent would be noise, not information.
      const board: any = await coverage();

      expect(board.checkInInUse).toBe(false);
      expect(board.absentTeachers).toHaveLength(0);
      expect(board.stats.needCover).toBe(0);
    });

    it('covers only the periods an approved leave actually touches', async () => {
      await checkInAllExcept();
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00', fromSlot: 2 },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );

      const board: any = await coverage();

      // أروى teaches slots 1 and 2; she leaves before the second.
      expect(board.stats.needCover).toBe(1);
      expect(board.uncovered[0].slot).toBe(2);
      expect(board.uncovered[0].reason).toBe('leave');
      expect(board.uncovered[0].leaveAt).toBe('10:00');
    });

    it('offers the whole day when the leave names no slot', async () => {
      await checkInAllExcept();
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );

      const board: any = await coverage();
      expect(board.stats.needCover).toBe(2);
    });

    it('ignores a leave request that was never approved', async () => {
      await checkInAllExcept();
      await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );

      const board: any = await coverage();
      expect(board.stats.needCover).toBe(0);
    });

    it('moves a lecture to covered once somebody is assigned', async () => {
      await checkInAllExcept(arabicTeacher);
      await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L1), substituteTeacherId: String(freeTeacher) },
          OWNER,
        ),
      );

      const board: any = await coverage();

      expect(board.stats.covered).toBe(1);
      expect(board.stats.uncovered).toBe(1);
      expect(board.covered[0].substituteTeacherName).toBe('أ. سارة');
    });

    it('stops offering a teacher already covering that slot', async () => {
      await checkInAllExcept(arabicTeacher, mathsTeacher);
      await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L1), substituteTeacherId: String(freeTeacher) },
          OWNER,
        ),
      );

      const board: any = await coverage();
      const otherSlot1 = board.uncovered.find(
        (u: any) => u.slot === 1 && u.lectureId === String(L3),
      );
      expect(otherSlot1.suggestions.map((s: any) => s.name)).not.toContain('أ. سارة');
    });

    it('reports the day\'s supervisors alongside the board', async () => {
      await checkInAllExcept();
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );

      const board: any = await coverage();
      expect(board.supervisors.teacherNames).toEqual(['أ. سارة']);
    });
  });

  describe('assigning cover', () => {
    const assign = (lectureId: any, substituteId: any, date = DATE) =>
      asTenant(() =>
        service.createSubstitution(
          { date, lectureId: String(lectureId), substituteTeacherId: String(substituteId) },
          OWNER,
        ),
      );

    it('assigns and names the teacher taking it', async () => {
      const result: any = await assign(L1, freeTeacher);

      expect(result.data.substituteTeacherName).toBe('أ. سارة');
      expect(result.data.absentTeacherName).toBe('أ. أروى');
      expect(result.data.date).toBe(DATE);
    });

    it('refuses a substitute who teaches their own class in that slot', async () => {
      // هيا has her own lecture at sunday slot 1.
      await expect(assign(L1, mathsTeacher)).rejects.toMatchObject({ status: 400 });
    });

    it('refuses a substitute already covering another lecture in that slot', async () => {
      await assign(L1, freeTeacher);
      await expect(assign(L3, freeTeacher)).rejects.toMatchObject({ status: 400 });
    });

    it('allows the same substitute in a different slot', async () => {
      await assign(L1, freeTeacher);
      await expect(assign(L2, freeTeacher)).resolves.toBeDefined();
    });

    it('refuses a date whose weekday is not the lecture\'s', async () => {
      // 2026-11-16 is a Monday; these lectures are on Sunday.
      await expect(assign(L1, freeTeacher, '2026-11-16')).rejects.toMatchObject({
        status: 400,
      });
    });

    it('refuses the lecture\'s own teacher as their own substitute', async () => {
      await expect(assign(L1, arabicTeacher)).rejects.toMatchObject({ status: 400 });
    });

    it('replaces rather than duplicates when reassigned', async () => {
      await assign(L1, freeTeacher);
      const second: any = await assign(L1, arabicSpecialist);

      expect(second.data.substituteTeacherName).toBe('أ. منى');
      expect(await models[Substitution.name].collection.countDocuments({})).toBe(1);
    });

    it('gives a teacher only their own cover list', async () => {
      await assign(L1, freeTeacher);
      await assign(L3, arabicSpecialist);

      const mine: any = await asTenant(() =>
        service.listSubstitutions({ date: DATE }, {
          userId: String(freeTeacher), role: 'TEACHER',
        }),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].substituteTeacherName).toBe('أ. سارة');
    });
  });

  describe('tenant isolation', () => {
    it('keeps another school out of the cover board', async () => {
      const otherSchool = new Types.ObjectId();
      await mk(models[Teacher.name], {
        name: 'غريب', email: 'g@x.com', isActive: true, schoolId: otherSchool,
      });
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();
      const names = board.uncovered.flatMap((u: any) =>
        u.suggestions.map((s: any) => s.name),
      );
      expect(names).not.toContain('غريب');
    });
  });
});
