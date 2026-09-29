import { DailyTrackingService } from './daily-tracking.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

/**
 * سجل المتابعة اليومي — the rules that make the record trustworthy.
 *
 * No database: the models are stubs and what is asserted is the logic. The
 * cases here are the ones where getting it wrong writes something false into
 * a report the school makes decisions from — a fiction about a student who
 * was not there, a failure on a day with no quiz, a lost excuse.
 */
describe('daily tracking', () => {
  const SCHOOL = '6ab0000000000000000000aa';
  const LECTURE = '6ab0000000000000000000bb';
  const CLASS = '6ab0000000000000000000cc';
  const S1 = '6ab000000000000000000001';
  const S2 = '6ab000000000000000000002';

  /** Every bulkWrite op the service issued, in order. */
  let written: any[];
  /** Calls routed to AttendanceService, which is what notifies the family. */
  let attendanceCreated: any[];
  let attendanceDeleted: string[];

  const buildService = (opts: {
    roster?: string[];
    teacherId?: string | null;
    existingAbsences?: { _id: string; studentId: string }[];
    lectureMissing?: boolean;
    createThrows?: boolean;
  } = {}) => {
    const {
      roster = [S1, S2],
      // The ordinary case: the lecture belongs to the teacher saving it.
      teacherId = 'teacher-1',
      existingAbsences = [],
      lectureMissing = false,
      createThrows = false,
    } = opts;

    written = [];
    attendanceCreated = [];
    attendanceDeleted = [];

    const trackingModel: any = {
      bulkWrite: async (ops: any[]) => { written.push(...ops); return {}; },
      find: () => ({
        select: () => ({ lean: () => ({ exec: async () => [] }) }),
      }),
    };

    const lectureModel: any = {
      findById: () => ({
        populate: function () { return this; },
        exec: async () =>
          lectureMissing
            ? null
            : {
                _id: LECTURE,
                teacherId,
                classId: { _id: CLASS, name: '٢/أ' },
                subjectOfferingId: {
                  _id: 'off1',
                  subjectId: { subjectName: 'الرياضيات' },
                },
              },
      }),
    };

    const studentModel: any = {
      find: () => ({
        select: () => ({ exec: async () => roster.map((id) => ({ _id: id })) }),
      }),
    };

    const attendanceModel: any = {
      find: () => ({
        select: () => ({ exec: async () => existingAbsences }),
      }),
    };

    const attendanceService: any = {
      create: async (dto: any) => {
        if (createThrows) throw new Error('notification down');
        attendanceCreated.push(dto);
      },
      delete: async (id: string) => { attendanceDeleted.push(id); },
    };

    return new DailyTrackingService(
      trackingModel, lectureModel, studentModel, attendanceModel, attendanceService,
    );
  };

  /** Runs inside a tenant context, as a real request would. */
  const save = (service: DailyTrackingService, records: any[], user: any = { role: 'TEACHER', userId: 'teacher-1' }) =>
    tenantLocalStorage.run({ schoolId: SCHOOL, isAdminContext: false }, () =>
      service.bulkUpsert(
        { lectureId: LECTURE, date: '2026-09-29', records } as any,
        user,
      ),
    );

  /** The $set the service issued for one student. */
  const setFor = (studentId: string) =>
    written.find((op) => String(op.updateOne.filter.studentId) === studentId)
      ?.updateOne.update.$set;

  describe('the defaults the sheet opens with', () => {
    it('treats an omitted participation and homework as ticked', () => {
      // The teacher only unticks, so silence means present and prepared.
      const r = DailyTrackingService.resolveRecord({ studentId: S1, absent: false } as any);
      expect(r.participation).toBe(true);
      expect(r.homework).toBe(true);
    });

    it('leaves quiz null rather than false when nothing was sent', () => {
      // false would mean "sat the quiz and did not pass", and the monthly
      // report would show failures on days when no quiz was held at all.
      const r = DailyTrackingService.resolveRecord({ studentId: S1, absent: false } as any);
      expect(r.quiz).toBeNull();
    });

    it('keeps an explicit false as a real quiz result', () => {
      const r = DailyTrackingService.resolveRecord({ studentId: S1, absent: false, quiz: false } as any);
      expect(r.quiz).toBe(false);
    });

    it('keeps an explicit unticked participation', () => {
      const r = DailyTrackingService.resolveRecord({ studentId: S1, absent: false, participation: false } as any);
      expect(r.participation).toBe(false);
    });
  });

  describe('a student marked absent', () => {
    it('cannot also have participated or brought her work', () => {
      // Leaving these ticked because nobody unticked them writes a pleasant
      // fiction — she was not in the room.
      const r = DailyTrackingService.resolveRecord({
        studentId: S1, absent: true, participation: true, homework: true, quiz: true,
      } as any);
      expect(r.participation).toBe(false);
      expect(r.homework).toBe(false);
      expect(r.quiz).toBeNull();
    });

    it('is written that way even when the client sends it ticked', async () => {
      const service = buildService();
      await save(service, [{ studentId: S1, absent: true, participation: true, homework: true }]);
      expect(setFor(S1).participation).toBe(false);
      expect(setFor(S1).homework).toBe(false);
    });
  });

  describe('saving the sheet', () => {
    it('upserts so re-saving updates rather than doubling', async () => {
      const service = buildService();
      await save(service, [{ studentId: S1, absent: false }]);
      expect(written).toHaveLength(1);
      expect(written[0].updateOne.upsert).toBe(true);
    });

    it('carries schoolId on every filter — bulkWrite bypasses the tenant plugin', async () => {
      // The plugin hooks queries and documents, not bulkWrite. Without this
      // the write leaks across schools and matches another school's rows.
      const service = buildService();
      await save(service, [{ studentId: S1, absent: false }, { studentId: S2, absent: false }]);
      for (const op of written) {
        expect(String(op.updateOne.filter.schoolId)).toBe(SCHOOL);
        expect(String(op.updateOne.update.$setOnInsert.schoolId)).toBe(SCHOOL);
      }
    });

    it('refuses to write at all with no tenant context', async () => {
      const service = buildService();
      await expect(
        service.bulkUpsert(
          { lectureId: LECTURE, date: '2026-09-29', records: [{ studentId: S1, absent: false }] } as any,
          { role: 'TEACHER', userId: 'teacher-1' },
        ),
      ).rejects.toThrow('لا يمكن تحديد المدرسة الحالية');
    });

    it('denormalises the subject and class onto the row', async () => {
      // The report is read after timetables are rebuilt; a row that reads
      // "— was late to —" is not evidence.
      const service = buildService();
      await save(service, [{ studentId: S1, absent: false }]);
      expect(setFor(S1).subjectName).toBe('الرياضيات');
      expect(setFor(S1).className).toBe('٢/أ');
    });
  });

  describe('who may be written', () => {
    it('refuses a student who is not in this lecture’s class', async () => {
      // Otherwise editing the payload writes a record for any student in
      // the school, including one this teacher does not teach.
      const service = buildService({ roster: [S1] });
      await expect(save(service, [{ studentId: S2, absent: false }]))
        .rejects.toThrow('لا ينتمين إلى فصل هذه الحصة');
      expect(written).toHaveLength(0);
    });

    it('refuses a lecture belonging to another teacher', async () => {
      const service = buildService({ teacherId: 'someone-else' });
      await expect(save(service, [{ studentId: S1, absent: false }]))
        .rejects.toThrow('هذه ليست حصتك');
    });

    it('lets an admin save a lecture they do not teach', async () => {
      const service = buildService({ teacherId: 'someone-else' });
      await save(service, [{ studentId: S1, absent: false }], { role: 'ADMIN', userId: 'admin-1' });
      expect(written).toHaveLength(1);
    });

    it('rejects the same student twice in one payload', async () => {
      // Two rows for one student would let bulkWrite ordering decide which
      // wins, silently and differently on a retry.
      const service = buildService();
      await expect(save(service, [
        { studentId: S1, absent: false, participation: true },
        { studentId: S1, absent: false, participation: false },
      ])).rejects.toThrow('تكرر معرّف طالبة');
    });

    it('404s on a lecture that does not exist', async () => {
      const service = buildService({ lectureMissing: true });
      await expect(save(service, [{ studentId: S1, absent: false }]))
        .rejects.toThrow('الحصة غير موجودة');
    });
  });

  describe('attendance is routed, not copied', () => {
    it('creates an absence through AttendanceService so the family is told', async () => {
      // Writing the model directly here would skip announceAbsence and the
      // excuse the notification asks the family for.
      const service = buildService();
      await save(service, [{ studentId: S1, absent: true }]);
      expect(attendanceCreated).toEqual([
        { studentId: S1, classId: CLASS, date: '2026-09-29' },
      ]);
    });

    it('stores no attendance field on the tracking row itself', async () => {
      const service = buildService();
      await save(service, [{ studentId: S1, absent: true }]);
      expect(setFor(S1)).not.toHaveProperty('absent');
    });

    it('does not re-create an absence that is already recorded', async () => {
      // Re-creating it would destroy the excuse the family wrote and the
      // manager's review of it.
      const service = buildService({ existingAbsences: [{ _id: 'a1', studentId: S1 }] });
      await save(service, [{ studentId: S1, absent: true }]);
      expect(attendanceCreated).toHaveLength(0);
      expect(attendanceDeleted).toHaveLength(0);
    });

    it('lifts an absence when the teacher unticks it', async () => {
      const service = buildService({ existingAbsences: [{ _id: 'a1', studentId: S1 }] });
      await save(service, [{ studentId: S1, absent: false }]);
      expect(attendanceDeleted).toEqual(['a1']);
    });

    it('leaves alone an absence for a student not on this sheet', async () => {
      // Another period may have recorded her. This sheet does not speak for
      // students it was never shown.
      const service = buildService({
        roster: [S1, S2],
        existingAbsences: [{ _id: 'a2', studentId: S2 }],
      });
      await save(service, [{ studentId: S1, absent: false }]);
      expect(attendanceDeleted).toHaveLength(0);
    });

    it('keeps the behavioural rows when a notification fails', async () => {
      // The record is the point. Discarding twenty-nine saved rows because
      // one push failed would lose the teacher's work to a courtesy.
      const service = buildService({ createThrows: true });
      const result: any = await save(service, [{ studentId: S1, absent: true }]);
      expect(written).toHaveLength(1);
      expect(result.data.attendance.failed).toBe(1);
      expect(result.status).toBe(true);
    });
  });

  describe('the date', () => {
    it('refuses anything that is not YYYY-MM-DD', async () => {
      const service = buildService();
      await expect(
        tenantLocalStorage.run({ schoolId: SCHOOL, isAdminContext: false }, () =>
          service.bulkUpsert(
            { lectureId: LECTURE, date: '29/09/2026', records: [{ studentId: S1, absent: false }] } as any,
            { role: 'ADMIN', userId: 'a' },
          ),
        ),
      ).rejects.toThrow('YYYY-MM-DD');
    });

    it('stores midnight UTC, matching how attendance stores its dates', async () => {
      // The two collections must agree on what "the 29th" means, or a sheet
      // saved at 2am Riyadh lands on a day the report never looks at.
      const service = buildService();
      await save(service, [{ studentId: S1, absent: false }]);
      expect(written[0].updateOne.filter.date.toISOString())
        .toBe('2026-09-29T00:00:00.000Z');
    });
  });

  describe('separation from grades', () => {
    it('writes no score of any kind', async () => {
      // The separation is enforced by the absence of a field, not by
      // documentation — there is nowhere to put a number.
      const service = buildService();
      await save(service, [{ studentId: S1, absent: false }]);
      const written1 = setFor(S1);
      for (const key of ['grade', 'points', 'score', 'achievedGrade', 'mark']) {
        expect(written1).not.toHaveProperty(key);
      }
      expect(Object.keys(written1).sort()).toEqual([
        'classId', 'className', 'homework', 'participation', 'quiz',
        'recordedBy', 'subjectName', 'subjectOfferingId', 'teacherId',
      ]);
    });
  });
});
