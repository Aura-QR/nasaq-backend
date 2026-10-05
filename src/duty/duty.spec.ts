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
import { NotificationsService } from '../notifications/notifications.service';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';
import { PushService } from '../notifications/push.service';
import {
  DeviceToken,
  DeviceTokenSchema,
} from '../notifications/schemas/device-token.schema';

import { Admin, AdminSchema } from '../admin/schemas/admin.schema';
import {
  StaffAttendance,
  StaffAttendanceSchema,
} from '../staff-attendance/schemas/staff-attendance.schema';
import {
  StaffLeaveRequest,
  StaffLeaveRequestSchema,
} from '../staff-attendance/schemas/staff-leave-request.schema';

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
          { name: Notification.name, schema: NotificationSchema },
          { name: DeviceToken.name, schema: DeviceTokenSchema },
          { name: Admin.name, schema: AdminSchema },
          { name: StaffAttendance.name, schema: StaffAttendanceSchema },
          { name: StaffLeaveRequest.name, schema: StaffLeaveRequestSchema },
        ]),
      ],
      providers: [DutyService, NotificationsService, PushService],
    }).compile();

    service = moduleRef.get(DutyService);
    for (const name of [
      LeaveRequest.name, DutySupervisor.name, Substitution.name, Teacher.name,
      Lecture.name, TeacherAttendance.name, Term.name, Class.name,
      Subject.name, SubjectOffering.name, Notification.name,
      Admin.name, StaffAttendance.name, StaffLeaveRequest.name,
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
  const coverageOn = (date: string) =>
    asTenant(() => service.getCoverage(date, OWNER));

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

  describe('edge cases a real school hits', () => {
    it('does not mix terms when no term is marked active', async () => {
      // Without an active term the lecture query has no term filter, so a
      // second term's Sunday lectures would be pulled into today's board.
      await models[Term.name].collection.updateMany({}, { $set: { status: 'closed' } });
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();

      expect(board.termId).toBeNull();
      // Still only أروى's two Sunday lectures, not every term's.
      expect(board.stats.needCover).toBe(2);
    });

    it('survives a school with no lectures at all', async () => {
      await models[Lecture.name].collection.deleteMany({});
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();

      expect(board.stats.needCover).toBe(0);
      expect(board.uncovered).toEqual([]);
      expect(board.absentTeachers).toHaveLength(1);
    });

    it('survives a school with no teachers', async () => {
      await models[Teacher.name].collection.deleteMany({});

      const board: any = await coverage();
      expect(board.stats.needCover).toBe(0);
    });

    it('returns an empty roster rather than failing when none is set', async () => {
      const rows: any = await asTenant(() => service.getSupervisors({ date: DATE }));
      expect(rows).toEqual([]);
    });

    it('rejects a malformed date instead of querying on Invalid Date', async () => {
      await expect(coverageOn('not-a-date')).rejects.toMatchObject({ status: 400 });
    });

    it('handles an unassigned lecture without crashing on its null teacher', async () => {
      await models[Lecture.name].collection.updateOne(
        { _id: L1 },
        { $set: { teacherId: null } },
      );
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();

      // The unstaffed slot has no absent owner, so it is not cover work.
      expect(board.uncovered.map((u: any) => u.slot)).toEqual([2]);
    });

    it('reads a day where a teacher is both absent and on leave', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );
      await checkInAllExcept(arabicTeacher);

      const board: any = await coverage();

      // Counted once, not twice.
      expect(board.stats.needCover).toBe(2);
      expect(board.uncovered).toHaveLength(2);
    });
  });

  describe('notifications', () => {
    const unreadFor = async (teacherId: any) =>
      models[Notification.name].collection
        .find({ recipientId: teacherId })
        .toArray();

    it('tells the substitute they are covering', async () => {
      await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L1), substituteTeacherId: String(freeTeacher) },
          OWNER,
        ),
      );

      const notices = await unreadFor(freeTeacher);
      expect(notices).toHaveLength(1);
      expect(notices[0].type).toBe('cover_assigned');
      expect(notices[0].read).toBe(false);
      // The body has to carry enough to act on without opening anything.
      expect(notices[0].body).toContain('الحصة 1');
      expect(notices[0].body).toContain('م١/أ');
      expect(notices[0].body).toContain('أ. أروى');
    });

    it('tells them when the cover is taken away again', async () => {
      const created: any = await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L1), substituteTeacherId: String(freeTeacher) },
          OWNER,
        ),
      );
      await asTenant(() => service.removeSubstitution(String(created.data._id)));

      const notices = await unreadFor(freeTeacher);
      expect(notices.map((n: any) => n.type)).toEqual([
        'cover_assigned',
        'cover_removed',
      ]);
    });

    it('tells the teacher their leave was decided, and carries the note', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '11:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(
          String(filed.data._id),
          { status: 'approved', reviewNote: 'البديل أ. سارة' },
          OWNER,
        ),
      );

      const notices = await unreadFor(arabicTeacher);
      expect(notices).toHaveLength(1);
      expect(notices[0].type).toBe('leave_approved');
      expect(notices[0].body).toContain('البديل أ. سارة');
    });

    it('says so when a request is rejected', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '11:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'rejected' }, OWNER),
      );

      const notices = await unreadFor(arabicTeacher);
      expect(notices[0].type).toBe('leave_rejected');
    });

    it('writes nothing when a request is only put back to pending', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '11:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'pending' }, OWNER),
      );

      expect(await unreadFor(arabicTeacher)).toHaveLength(0);
    });

    it('tells a teacher they are on duty', async () => {
      await asTenant(() =>
        service.setSupervisors(
          { date: DATE, teacherIds: [String(freeTeacher)], notes: 'البوابة الشمالية' },
          OWNER,
        ),
      );

      const notices = await unreadFor(freeTeacher);
      expect(notices).toHaveLength(1);
      expect(notices[0].type).toBe('duty_assigned');
      expect(notices[0].read).toBe(false);
      expect(notices[0].body).toContain(DATE);
      expect(notices[0].body).toContain('البوابة الشمالية');
    });

    it('tells both of them when the day has two supervisors', async () => {
      await asTenant(() =>
        service.setSupervisors(
          { date: DATE, teacherIds: [String(freeTeacher), String(arabicSpecialist)] },
          OWNER,
        ),
      );

      expect(await unreadFor(freeTeacher)).toHaveLength(1);
      expect(await unreadFor(arabicSpecialist)).toHaveLength(1);
    });

    it('only tells whoever actually changed', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      // freeTeacher stays on the roster; arabicSpecialist joins it.
      await asTenant(() =>
        service.setSupervisors(
          { date: DATE, teacherIds: [String(freeTeacher), String(arabicSpecialist)] },
          OWNER,
        ),
      );

      // Not two. Re-saving a roster must not re-announce it.
      expect(await unreadFor(freeTeacher)).toHaveLength(1);
      expect(await unreadFor(arabicSpecialist)).toHaveLength(1);
    });

    it('writes nothing at all when only the notes change', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      await asTenant(() =>
        service.setSupervisors(
          { date: DATE, teacherIds: [String(freeTeacher)], notes: 'الفناء' },
          OWNER,
        ),
      );

      expect(await unreadFor(freeTeacher)).toHaveLength(1);
    });

    it('tells a teacher when their duty is taken off them', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      await asTenant(() => service.setSupervisors({ date: DATE, teacherIds: [] }, OWNER));

      const notices = await unreadFor(freeTeacher);
      expect(notices.map((n: any) => n.type)).toEqual([
        'duty_assigned',
        'duty_removed',
      ]);
    });

    it('tells the one dropped and the one added when a roster is swapped', async () => {
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(freeTeacher)] }, OWNER),
      );
      await asTenant(() =>
        service.setSupervisors({ date: DATE, teacherIds: [String(arabicSpecialist)] }, OWNER),
      );

      expect((await unreadFor(freeTeacher)).map((n: any) => n.type)).toEqual([
        'duty_assigned',
        'duty_removed',
      ]);
      expect((await unreadFor(arabicSpecialist)).map((n: any) => n.type)).toEqual([
        'duty_assigned',
      ]);
    });
  });

  describe('the teacher\'s own day', () => {
    const myDay = (teacherId: any) =>
      asTenant(() => service.getMyDay(String(teacherId), DATE));

    it('lists their own lectures', async () => {
      const day: any = await myDay(arabicTeacher);

      expect(day.stats.own).toBe(2);
      expect(day.stats.cover).toBe(0);
      expect(day.slots.map((s: any) => s.slot)).toEqual([1, 2]);
      expect(day.slots.every((s: any) => s.kind === 'own')).toBe(true);
    });

    it('merges cover into the same timeline, marked as cover', async () => {
      await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L3), substituteTeacherId: String(freeTeacher) },
          OWNER,
        ),
      );

      const day: any = await myDay(freeTeacher);

      expect(day.stats.own).toBe(0);
      expect(day.stats.cover).toBe(1);
      expect(day.slots[0].kind).toBe('cover');
      expect(day.slots[0].coveringFor).toBe('أ. هيا');
      expect(day.slots[0].className).toBe('م١/ب');
    });

    it('sorts own lectures and cover together by period', async () => {
      // أروى teaches slots 1 and 2; give her cover in a slot she is free in.
      const L4 = await mk(models[Lecture.name], {
        classId: classB, subjectOfferingId: (await models[SubjectOffering.name]
          .collection.findOne({}))._id,
        termId, teacherId: mathsTeacher, dayOfWeek: 'sunday', slot: 3,
        preparation: [], schoolId,
      });
      await asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(L4), substituteTeacherId: String(arabicTeacher) },
          OWNER,
        ),
      );

      const day: any = await myDay(arabicTeacher);

      expect(day.slots.map((s: any) => s.slot)).toEqual([1, 2, 3]);
      expect(day.slots.map((s: any) => s.kind)).toEqual(['own', 'own', 'cover']);
    });

    it('flags the periods an approved leave excuses, rather than hiding them', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00', fromSlot: 2 },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );
      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );

      const day: any = await myDay(arabicTeacher);

      // Hiding them is how somebody turns up for a lesson they were signed off.
      expect(day.slots).toHaveLength(2);
      expect(day.slots[0].excusedByLeave).toBe(false);
      expect(day.slots[1].excusedByLeave).toBe(true);
      expect(day.stats.excused).toBe(1);
      expect(day.leave.leaveAt).toBe('10:00');
    });

    it('reports a pending request without excusing anything', async () => {
      await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '10:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );

      const day: any = await myDay(arabicTeacher);

      expect(day.leave.status).toBe('pending');
      expect(day.stats.excused).toBe(0);
    });

    it('returns an empty day for a teacher with nothing on', async () => {
      const day: any = await myDay(arabicSpecialist);
      expect(day.slots).toEqual([]);
      expect(day.leave).toBeNull();
    });
  });

  describe('the cover report', () => {
    const report = (from = DATE, to = DATE) =>
      asTenant(() => service.getCoverReport(from, to));

    const assign = (lectureId: any, substituteId: any) =>
      asTenant(() =>
        service.createSubstitution(
          {
            date: DATE,
            lectureId: String(lectureId),
            substituteTeacherId: String(substituteId),
          },
          OWNER,
        ),
      );

    it('counts what each teacher covered, and what needed covering for them', async () => {
      await assign(L1, freeTeacher);   // أروى's lesson, taken by سارة
      await assign(L2, arabicSpecialist);

      const result: any = await report();

      const sara = result.teachers.find((t: any) => t.name === 'أ. سارة');
      const arwa = result.teachers.find((t: any) => t.name === 'أ. أروى');

      expect(sara.covered).toBe(1);
      expect(sara.neededCover).toBe(0);
      expect(arwa.covered).toBe(0);
      expect(arwa.neededCover).toBe(2);
      expect(result.totals.coverAssigned).toBe(2);
      expect(result.totals.teachersWhoCovered).toBe(2);
    });

    it('sorts by cover taken, heaviest first', async () => {
      await assign(L1, freeTeacher);
      await assign(L2, freeTeacher);
      await assign(L3, arabicSpecialist);

      const result: any = await report();

      expect(result.teachers[0].name).toBe('أ. سارة');
      expect(result.teachers[0].covered).toBe(2);
    });

    it('flags a teacher carrying twice what everyone else is', async () => {
      // سارة takes three, منى takes one. Averaging across both gives two and
      // hides it — سارة's own load drags the baseline up to meet her. Measured
      // against the others she is at three times theirs.
      const L4 = await mk(models[Lecture.name], {
        classId: classB,
        subjectOfferingId: (await models[SubjectOffering.name].collection.findOne({}))._id,
        termId, teacherId: mathsTeacher, dayOfWeek: 'sunday', slot: 4,
        preparation: [], schoolId,
      });
      const L5 = await mk(models[Lecture.name], {
        classId: classA,
        subjectOfferingId: (await models[SubjectOffering.name].collection.findOne({}))._id,
        termId, teacherId: mathsTeacher, dayOfWeek: 'sunday', slot: 5,
        preparation: [], schoolId,
      });

      await assign(L1, freeTeacher);
      await assign(L2, freeTeacher);
      await assign(L4, freeTeacher);
      await assign(L5, arabicSpecialist);

      const result: any = await report();

      expect(result.totals.averagePerCarrier).toBe(2);
      expect(result.overloaded.map((o: any) => o.name)).toEqual(['أ. سارة']);
    });

    it('flags nobody when the load is even', async () => {
      await assign(L1, freeTeacher);
      await assign(L3, arabicSpecialist);

      const result: any = await report();
      expect(result.overloaded).toEqual([]);
    });

    it('does not fire on a week that is not yet a pattern', async () => {
      // Two against one is lopsided arithmetically and meaningless in a
      // school; flagging it would train people to ignore the flag.
      await assign(L1, freeTeacher);
      await assign(L2, freeTeacher);
      await assign(L3, arabicSpecialist);

      const result: any = await report();
      expect(result.overloaded).toEqual([]);
    });

    it('counts approved leaves but not pending ones', async () => {
      const filed: any = await asTenant(() =>
        service.createLeaveRequest(
          { date: DATE, leaveAt: '11:00' },
          { userId: String(arabicTeacher), role: 'TEACHER' },
        ),
      );

      const before: any = await report();
      expect(before.totals.approvedLeaves).toBe(0);

      await asTenant(() =>
        service.reviewLeaveRequest(String(filed.data._id), { status: 'approved' }, OWNER),
      );

      const after: any = await report();
      expect(after.totals.approvedLeaves).toBe(1);
      expect(
        after.teachers.find((t: any) => t.name === 'أ. أروى').approvedLeaves,
      ).toBe(1);
    });

    it('leaves out teachers with nothing to report', async () => {
      await assign(L1, freeTeacher);

      const result: any = await report();

      // هيا neither covered nor needed covering; a fairness report listing her
      // as a row of zeroes is noise.
      expect(result.teachers.map((t: any) => t.name)).not.toContain('أ. هيا');
    });

    it('counts distinct days present, not attendance rows', async () => {
      await checkInAllExcept();
      await assign(L1, freeTeacher);

      const result: any = await report();
      expect(
        result.teachers.find((t: any) => t.name === 'أ. سارة').daysPresent,
      ).toBe(1);
    });

    it('breaks the range down by day', async () => {
      await assign(L1, freeTeacher);
      await assign(L2, arabicSpecialist);

      const result: any = await report(DATE, '2026-11-21');

      expect(result.byDay).toEqual([{ date: DATE, count: 2 }]);
      expect(result.from).toBe(DATE);
      expect(result.to).toBe('2026-11-21');
    });

    it('excludes cover outside the range', async () => {
      await assign(L1, freeTeacher);

      const result: any = await report('2026-11-16', '2026-11-21');
      expect(result.totals.coverAssigned).toBe(0);
    });

    it('rejects a range that runs backwards', async () => {
      await expect(report('2026-11-21', DATE)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('returns an empty report rather than failing on a quiet week', async () => {
      const result: any = await report('2026-12-01', '2026-12-07');

      expect(result.totals.coverAssigned).toBe(0);
      expect(result.teachers).toEqual([]);
      expect(result.byDay).toEqual([]);
    });
  });

  describe('administrative assistants in the cover pool', () => {
    let assistant: any;   // MANAGER — مساعدة إدارية
    let assistant2: any;  // MANAGER without a full name
    let principal: any;   // SUPERVISOR — مدير المدرسة, never a substitute
    let guard: any;
    let owner: any;

    const mkAdmin = (username: string, role: string, fullName = '') =>
      mk(models[Admin.name], {
        username, email: `${username}@x.com`, password: 'x', role, fullName,
        permissions: [], schoolId,
      });

    const checkInStaff = (staffId: any, role: string) =>
      mk(models[StaffAttendance.name], {
        staffId, role, name: 'x',
        date: new Date(`${DATE}T00:00:00.000Z`),
        checkInAt: new Date(`${DATE}T07:00:00.000Z`),
        method: 'manual', schoolId,
      });

    const slot1Suggestions = async () => {
      const board: any = await coverage();
      return board.uncovered.find((u: any) => u.slot === 1).suggestions;
    };

    const assign = (lectureId: any, substituteId: any) =>
      asTenant(() =>
        service.createSubstitution(
          { date: DATE, lectureId: String(lectureId), substituteTeacherId: String(substituteId) },
          OWNER,
        ),
      );

    beforeEach(async () => {
      assistant = await mkAdmin('mgr1', 'MANAGER', 'أ. نورة');
      assistant2 = await mkAdmin('mgr2', 'MANAGER');
      principal = await mkAdmin('sup1', 'SUPERVISOR', 'مدير المدرسة');
      guard = await mkAdmin('guard1', 'STAFF', 'الحارس');
      owner = await mkAdmin('owner1', 'OWNER', 'المالكة');
      await checkInAllExcept(arabicTeacher);
    });

    it('offers administrative assistants, after every free teacher', async () => {
      const suggestions = await slot1Suggestions();
      const types = suggestions.map((s: any) => s.type);

      expect(types.indexOf('Admin')).toBeGreaterThan(types.lastIndexOf('Teacher'));
      const admins = suggestions.filter((s: any) => s.type === 'Admin');
      expect(admins.map((a: any) => a.teacherId).sort()).toEqual(
        [String(assistant), String(assistant2)].sort(),
      );
      expect(admins.find((a: any) => a.teacherId === String(assistant))).toMatchObject({
        name: 'أ. نورة', role: 'MANAGER', sameSubject: false,
      });
      // No fullName: the username stands in.
      expect(admins.find((a: any) => a.teacherId === String(assistant2)).name).toBe('mgr2');
    });

    it('never offers the principal, the owner or a guard', async () => {
      const ids = (await slot1Suggestions()).map((s: any) => s.teacherId);

      expect(ids).not.toContain(String(principal));
      expect(ids).not.toContain(String(owner));
      expect(ids).not.toContain(String(guard));
    });

    it('offers only the assistants who checked in, once any of them has', async () => {
      await checkInStaff(assistant, 'MANAGER');

      const admins = (await slot1Suggestions()).filter((s: any) => s.type === 'Admin');
      expect(admins.map((a: any) => a.teacherId)).toEqual([String(assistant)]);
    });

    it('leaves out an assistant on approved leave that day', async () => {
      await mk(models[StaffLeaveRequest.name], {
        staffId: assistant, staffName: 'أ. نورة', role: 'MANAGER',
        date: new Date(`${DATE}T00:00:00.000Z`), leaveAt: '10:00',
        status: 'approved', schoolId,
      });
      await mk(models[StaffLeaveRequest.name], {
        staffId: assistant2, staffName: 'mgr2', role: 'MANAGER',
        date: new Date(`${DATE}T00:00:00.000Z`), leaveAt: '10:00',
        status: 'pending', schoolId,
      });

      const ids = (await slot1Suggestions()).map((s: any) => s.teacherId);
      expect(ids).not.toContain(String(assistant));
      expect(ids).toContain(String(assistant2));
    });

    it('assigns an assistant, records who she is, and tells her', async () => {
      const result: any = await assign(L1, assistant);

      expect(result.data).toMatchObject({
        substituteTeacherName: 'أ. نورة',
        substituteType: 'Admin',
        substituteRole: 'MANAGER',
      });

      const notes = await models[Notification.name].collection
        .find({ recipientId: assistant, type: 'cover_assigned' }).toArray();
      expect(notes).toHaveLength(1);
      expect(notes[0].title).toBe('لديك حصة احتياط');
    });

    it('records a teacher substitute as a teacher', async () => {
      const result: any = await assign(L1, freeTeacher);

      expect(result.data).toMatchObject({ substituteType: 'Teacher', substituteRole: 'TEACHER' });
    });

    it('refuses the principal, the owner or a guard as substitute', async () => {
      await expect(assign(L1, principal)).rejects.toThrow(/البديل/);
      await expect(assign(L1, owner)).rejects.toThrow(/البديل/);
      await expect(assign(L1, guard)).rejects.toThrow(/البديل/);
    });

    it('stops offering her for that slot once she is covering it', async () => {
      await assign(L1, assistant);

      const board: any = await coverage();
      const covered = board.covered.find((c: any) => c.slot === 1);
      expect(covered).toMatchObject({
        substituteTeacherId: String(assistant),
        substituteType: 'Admin',
        substituteRole: 'MANAGER',
      });

      // Mark هيا absent too, so maths in slot 1 needs cover as well.
      await models[TeacherAttendance.name].collection.deleteMany({ teacherId: mathsTeacher });
      const again: any = await coverage();
      const maths = again.uncovered.find((u: any) => String(u.lectureId) === String(L3));
      expect(maths.suggestions.map((s: any) => s.teacherId)).not.toContain(String(assistant));
    });

    it('refuses her a second room in the same slot', async () => {
      await assign(L1, assistant);

      await expect(assign(L3, assistant)).rejects.toThrow(/مشغول/);
    });

    it('shows the cover on her own day', async () => {
      await assign(L1, assistant);

      const day: any = await asTenant(() => service.getMyDay(String(assistant), DATE));
      expect(day.stats).toMatchObject({ own: 0, cover: 1 });
      expect(day.slots[0]).toMatchObject({
        kind: 'cover', lectureId: String(L1), coveringFor: 'أ. أروى',
      });
    });

    it('counts her in the cover report', async () => {
      await assign(L1, assistant);
      await assign(L2, freeTeacher);

      const result: any = await asTenant(() => service.getCoverReport(DATE, DATE));
      const row = result.teachers.find((t: any) => t.teacherId === String(assistant));
      expect(row).toMatchObject({ name: 'أ. نورة', covered: 1, type: 'Admin', role: 'MANAGER' });
      expect(result.totals.teachersWhoCovered).toBe(2);
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
