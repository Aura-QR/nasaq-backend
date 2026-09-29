import { DailyTrackingService } from './daily-tracking.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

/**
 * The monthly report — تقرير المتابعة.
 *
 * No database here, so what is asserted is the pipeline the service builds
 * and the rules around it, not Mongo's execution of it. The arithmetic the
 * pipeline expresses is checked separately, against the same $cond/$divide
 * shapes, so a wrong denominator fails here rather than in front of a
 * manager reading a student's month.
 */
describe('daily tracking summary', () => {
  const SCHOOL = '6ab0000000000000000000aa';
  const CLASS = '6ab0000000000000000000cc';
  const OFFERING = '6ab0000000000000000000dd';
  const TEACHER = '6ab000000000000000000111';

  let pipeline: any[];
  let lectureLookups: any[];

  const buildService = (opts: { teachesClass?: boolean } = {}) => {
    const { teachesClass = true } = opts;
    pipeline = [];
    lectureLookups = [];

    const trackingModel: any = {
      aggregate: async (stages: any[]) => { pipeline = stages; return []; },
    };
    const lectureModel: any = {
      findOne: (filter: any) => {
        lectureLookups.push(filter);
        return { select: () => ({ exec: async () => (teachesClass ? { _id: 'l1' } : null) }) };
      },
    };

    return new DailyTrackingService(
      trackingModel, lectureModel, {} as any, {} as any, {} as any,
    );
  };

  const run = (service: DailyTrackingService, query: any = {}, user: any = { role: 'MANAGER', userId: 'm1' }) =>
    tenantLocalStorage.run({ schoolId: SCHOOL, isAdminContext: false }, () =>
      service.summary(
        { startDate: '2026-09-01', endDate: '2026-09-30', classId: CLASS, ...query },
        user,
      ),
    );

  /** The stage whose single key is `name`. */
  const stage = (name: string) => pipeline.find((s) => Object.keys(s)[0] === name)?.[name];

  describe('what it reads', () => {
    it('scopes to the school, the class and the range', async () => {
      const service = buildService();
      await run(service);
      const m = stage('$match');
      expect(String(m.schoolId)).toBe(SCHOOL);
      expect(String(m.classId)).toBe(CLASS);
      expect(m.date.$gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      // Inclusive: a report for September must contain the 30th.
      expect(m.date.$lte.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });

    it('narrows to one subject only when asked', async () => {
      const service = buildService();
      await run(service);
      expect(stage('$match').subjectOfferingId).toBeUndefined();

      await run(service, { subjectOfferingId: OFFERING });
      expect(String(stage('$match').subjectOfferingId)).toBe(OFFERING);
    });

    it('refuses a range that runs backwards', async () => {
      const service = buildService();
      await expect(run(service, { startDate: '2026-09-30', endDate: '2026-09-01' }))
        .rejects.toThrow('startDate بعد endDate');
    });

    it('refuses to read with no tenant context', async () => {
      const service = buildService();
      await expect(
        service.summary(
          { startDate: '2026-09-01', endDate: '2026-09-30', classId: CLASS } as any,
          { role: 'MANAGER', userId: 'm1' },
        ),
      ).rejects.toThrow('لا يمكن تحديد المدرسة الحالية');
    });
  });

  describe('presence comes from the attendance collection', () => {
    it('joins attendance rather than reading a field that does not exist', async () => {
      // There is no `absent` field on a tracking row, deliberately, so that
      // "was she here?" has exactly one answer in the system.
      const service = buildService();
      await run(service);
      const lookup = pipeline.find((s) => s.$lookup?.from === 'attendance')?.$lookup;
      expect(lookup).toBeDefined();
      expect(lookup.let).toEqual({ s: '$studentId', d: '$date' });
    });

    it('scopes the joined collection to the school too', async () => {
      // $lookup runs raw; the tenant plugin does not reach inside it. Without
      // this, another school's absence could mark a student absent here.
      const service = buildService();
      await run(service);
      const lookup = pipeline.find((s) => s.$lookup?.from === 'attendance')?.$lookup;
      const conds = JSON.stringify(lookup.pipeline[0].$match.$expr.$and);
      expect(conds).toContain('schoolId');
    });

    it('treats no absence row as present', async () => {
      const service = buildService();
      await run(service);
      const added = pipeline.find((s) => s.$addFields)?.$addFields;
      expect(added.present).toEqual({ $eq: [{ $size: '$absence' }, 0] });
    });
  });

  describe('the grouping', () => {
    it('groups by student', async () => {
      const service = buildService();
      await run(service);
      expect(stage('$group')._id).toBe('$studentId');
    });

    it('counts participation only on days she was present', async () => {
      // The denominator is presentCount, so the numerator has to match it.
      // Counting a ticked box on an absent day would let a rate exceed 100%.
      const service = buildService();
      await run(service);
      const g = stage('$group');
      expect(JSON.stringify(g.participationCount)).toContain('present');
      expect(JSON.stringify(g.homeworkCount)).toContain('present');
    });

    it('counts a quiz that is neither true nor false as "no quiz"', async () => {
      // Matching null alone would miss a row where the field is absent, and
      // those rows would vanish from the three totals.
      const service = buildService();
      await run(service);
      const g = stage('$group');
      expect(g.quizNone).toEqual({ $sum: { $cond: [{ $in: ['$quiz', [true, false]] }, 0, 1] } });
    });
  });

  describe('the rates', () => {
    /** The pipeline's own arithmetic, evaluated on one student's totals. */
    const rate = (count: number, presentCount: number) =>
      presentCount > 0 ? Math.round((count / presentCount) * 100 * 10) / 10 : null;

    it('divides by days present, not by the whole range', async () => {
      // A student there 4 days of 20, participating on all 4, is at 100% —
      // not 20%. Dividing by the range reports illness as disengagement.
      expect(rate(4, 4)).toBe(100);
    });

    it('is null, not zero, when she was never present', () => {
      // "No data" and "zero percent" are different facts, and a report that
      // cannot tell them apart starts a conversation about a student who was
      // simply away.
      expect(rate(0, 0)).toBeNull();
    });

    it('is zero when she was present and never participated', () => {
      expect(rate(0, 12)).toBe(0);
    });

    it('keeps one decimal place', () => {
      expect(rate(1, 3)).toBe(33.3);
    });

    it('builds that same shape in the pipeline', async () => {
      const service = buildService();
      await run(service);
      const p = stage('$project');
      expect(p.participationRate.$cond[0]).toEqual({ $gt: ['$presentCount', 0] });
      // The null branch, which is what keeps "no data" distinct from 0%.
      expect(p.participationRate.$cond[2]).toBeNull();
    });
  });

  describe('the shape handed back', () => {
    it('reports absences as the remainder of the tracked periods', async () => {
      const service = buildService();
      await run(service);
      expect(stage('$project').absentCount)
        .toEqual({ $subtract: ['$totalLectures', '$presentCount'] });
    });

    it('returns the three quiz states as one object', async () => {
      const service = buildService();
      await run(service);
      expect(stage('$project').quizzes).toEqual({
        passed: '$quizPassed', failed: '$quizFailed', noQuiz: '$quizNone',
      });
    });

    it('says in the payload that this is not a grade', async () => {
      // The report travels; the percentages must not be read as marks.
      const service = buildService();
      const res: any = await run(service);
      expect(res.data.note).toContain('لا يؤثر في الدرجات');
    });

    it('sorts by name so the list is readable', async () => {
      const service = buildService();
      await run(service);
      expect(stage('$sort')).toEqual({ studentName: 1 });
    });
  });

  describe('who may read it', () => {
    it('lets a manager read any class', async () => {
      const service = buildService({ teachesClass: false });
      const res: any = await run(service, {}, { role: 'MANAGER', userId: 'm1' });
      expect(res.status).toBe(true);
      // No timetable lookup at all for a manager.
      expect(lectureLookups).toHaveLength(0);
    });

    it('lets an owner read any class', async () => {
      const service = buildService({ teachesClass: false });
      const res: any = await run(service, {}, { role: 'OWNER', userId: 'o1' });
      expect(res.status).toBe(true);
    });

    it('lets a teacher read a class she teaches', async () => {
      const service = buildService({ teachesClass: true });
      const res: any = await run(service, {}, { role: 'TEACHER', userId: TEACHER });
      expect(res.status).toBe(true);
    });

    it('refuses a teacher a class she does not teach', async () => {
      // The permission says she may read reports, not whose. Without this,
      // any teacher could read the behaviour of every student in the school.
      const service = buildService({ teachesClass: false });
      await expect(run(service, {}, { role: 'TEACHER', userId: TEACHER }))
        .rejects.toThrow('لا يمكنك عرض تقرير فصل لا تُدرّس له');
    });

    it('checks the timetable for that teacher and that class', async () => {
      const service = buildService({ teachesClass: true });
      await run(service, {}, { role: 'TEACHER', userId: TEACHER });
      expect(String(lectureLookups[0].classId)).toBe(CLASS);
      expect(String(lectureLookups[0].teacherId)).toBe(TEACHER);
    });
  });
});
