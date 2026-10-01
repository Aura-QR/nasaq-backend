import { TeacherAbsenceExcuseService } from './teacher-absence-excuse.service';

/**
 * عذر غياب المعلم.
 *
 * A teacher who arrives late can already explain herself. One who missed a
 * whole day could not, so the school saw a name on the absence report and
 * had to ask by phone — or not ask at all.
 *
 * The design decision these tests exist to protect: an absent teacher has no
 * attendance row. Presence is written at check-in and absence is derived by
 * subtraction, so the excuse lives in its own collection and nothing in the
 * attendance calculation reads it. An excused absence is still an absence.
 *
 * No database — the models are stubs and the logic is what is asserted.
 */
describe('a teacher explaining a day she missed', () => {
  const TEACHER = '6ab000000000000000000t01'.replace(/t/g, 'a');
  const SCHOOL = '6ab0000000000000000000aa';

  // Sun–Thu working, Fri/Sat off. 2026-09-27 is a Sunday.
  const SETTINGS = {
    workSchedule: [
      { day: 'sunday', isWorkingDay: true },
      { day: 'monday', isWorkingDay: true },
      { day: 'tuesday', isWorkingDay: true },
      { day: 'wednesday', isWorkingDay: true },
      { day: 'thursday', isWorkingDay: true },
      { day: 'friday', isWorkingDay: false },
      { day: 'saturday', isWorkingDay: false },
    ],
  };

  let created: any[];
  let notified: any[];
  let saved: any;

  const build = (opts: {
    attendanceOn?: string[];
    existingExcuse?: any;
    excuseById?: any;
  } = {}) => {
    const { attendanceOn = [], existingExcuse = null, excuseById = null } = opts;
    created = [];
    notified = [];
    saved = null;

    const day = (d: any) => new Date(d).toISOString().slice(0, 10);

    const excuseModel: any = {
      create: async (doc: any) => { created.push(doc); return { ...doc, _id: 'ex1' }; },
      findOne: () => ({
        select: () => ({ lean: () => ({ exec: async () => existingExcuse }) }),
      }),
      findById: async () => excuseById,
      find: () => ({
        select: () => ({ lean: () => ({ exec: async () => [] }) }),
        sort: () => ({ lean: () => ({ exec: async () => [] }) }),
      }),
    };

    const attendanceModel: any = {
      findOne: (q: any) => ({
        select: () => ({
          lean: () => ({
            exec: async () =>
              attendanceOn.includes(day(q.date)) ? { _id: 'att1' } : null,
          }),
        }),
      }),
      find: () => ({
        select: () => ({
          lean: () => ({
            exec: async () => attendanceOn.map((d) => ({ date: new Date(`${d}T00:00:00.000Z`) })),
          }),
        }),
      }),
    };

    const service = new TeacherAbsenceExcuseService(
      excuseModel,
      attendanceModel,
      { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ name: 'أ. سارة' }) }) }) }) } as any,
      { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ settings: SETTINGS }) }) }) }) } as any,
      { find: () => ({ select: () => ({ lean: () => ({ exec: async () => [{ _id: 'admin1' }, { _id: 'admin2' }] }) }) }) } as any,
      { notify: async (n: any) => { notified.push(n); } } as any,
    );
    return service;
  };

  const user = { userId: TEACHER, schoolId: SCHOOL, name: 'أ. سارة' };
  const submit = (service: any, dto: any) => service.submit(user, dto);

  describe('what may be explained', () => {
    it('accepts a working day she missed', async () => {
      const service = build();
      const res: any = await submit(service, { date: '2026-09-27', reason: 'وعكة صحية' });
      expect(res.status).toBe(true);
      expect(created).toHaveLength(1);
      expect(created[0].status).toBe('pending');
    });

    it('refuses a day she actually attended', async () => {
      // She was here. If she arrived late, the lateness flow is the one that
      // takes an explanation — two records for one day would contradict.
      const service = build({ attendanceOn: ['2026-09-27'] });
      await expect(submit(service, { date: '2026-09-27', reason: 'x' }))
        .rejects.toThrow('عذر التأخير هو المناسب هنا');
    });

    it('refuses a day the school does not work', async () => {
      // 2026-09-25 is a Friday. Nobody is absent on a day off, and asking a
      // teacher to explain one is how a feature loses its credibility.
      const service = build();
      await expect(submit(service, { date: '2026-09-25', reason: 'x' }))
        .rejects.toThrow('ليس يوم عمل');
    });

    it('refuses a day that has not happened', async () => {
      // Leaving before a future day is استئذان, which has its own flow with
      // its own approval and its own cover screen.
      const service = build();
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 7);
      await expect(submit(service, { date: future.toISOString().slice(0, 10), reason: 'x' }))
        .rejects.toThrow('استخدم طلب الاستئذان');
    });

    it('refuses a second excuse for the same day', async () => {
      // Written once: an explanation a manager has already ruled on must not
      // be quietly rewritten underneath them.
      const service = build({ existingExcuse: { _id: 'ex0', status: 'accepted' } });
      await expect(submit(service, { date: '2026-09-27', reason: 'x' }))
        .rejects.toThrow('بالفعل');
    });
  });

  describe('what is written', () => {
    it('trims the reason and stamps the day at midnight', async () => {
      const service = build();
      await submit(service, { date: '2026-09-27', reason: '  وعكة صحية  ' });
      expect(created[0].reason).toBe('وعكة صحية');
      expect(created[0].date.toISOString()).toBe('2026-09-27T00:00:00.000Z');
    });

    it('keeps the attachment path when one was uploaded', async () => {
      const service = build();
      await submit(service, {
        date: '2026-09-27', reason: 'تقرير طبي',
        attachment: '/uploads/absence-excuses/1-a.jpg',
      });
      expect(created[0].attachment).toBe('/uploads/absence-excuses/1-a.jpg');
    });

    it('denormalises the teacher name so the queue reads without a populate', async () => {
      const service = build();
      await submit(service, { date: '2026-09-27', reason: 'x' });
      expect(created[0].teacherName).toBe('أ. سارة');
    });
  });

  describe('telling the school', () => {
    it('notifies every admin', async () => {
      const service = build();
      await submit(service, { date: '2026-09-27', reason: 'وعكة' });
      expect(notified).toHaveLength(2);
      expect(notified[0].type).toBe('teacher_absence_excuse_submitted');
    });

    it('saves the excuse even when the notice fails', async () => {
      // The record is the point. Losing a written explanation because a push
      // failed would be trading the thing for the courtesy.
      const service = build();
      (service as any).notifications = { notify: async () => { throw new Error('push down'); } };
      const res: any = await submit(service, { date: '2026-09-27', reason: 'وعكة' });
      expect(res.status).toBe(true);
      expect(created).toHaveLength(1);
    });
  });

  describe('the school ruling on it', () => {
    const pending = () => ({
      _id: 'ex1', teacherId: TEACHER, date: new Date('2026-09-27T00:00:00.000Z'),
      status: 'pending', reason: 'وعكة',
      save: async function () { saved = this; },
    });

    it('accepts, and tells the teacher', async () => {
      const service = build({ excuseById: pending() });
      const res: any = await service.review('6ab0000000000000000000ex'.replace(/ex/g, 'ff'), user, { verdict: 'accepted' });
      expect(res.data.status).toBe('accepted');
      expect(notified[0].type).toBe('teacher_absence_excuse_reviewed');
    });

    it('refuses a rejection with no reason', async () => {
      // A refusal a teacher cannot answer is the one thing this must not do.
      const service = build({ excuseById: pending() });
      await expect(
        service.review('6ab0000000000000000000ff', user, { verdict: 'rejected' }),
      ).rejects.toThrow('اذكر سبب رفض العذر');
    });

    it('accepts a rejection that carries one', async () => {
      const service = build({ excuseById: pending() });
      const res: any = await service.review('6ab0000000000000000000ff', user, {
        verdict: 'rejected', note: 'لم يُرفق تقرير',
      });
      expect(res.data.status).toBe('rejected');
      expect(saved.reviewNote).toBe('لم يُرفق تقرير');
    });

    it('refuses to rule twice', async () => {
      const already = { ...pending(), status: 'accepted' };
      const service = build({ excuseById: already });
      await expect(
        service.review('6ab0000000000000000000ff', user, { verdict: 'rejected', note: 'x' }),
      ).rejects.toThrow('تمت مراجعة هذا العذر بالفعل');
    });

    it('keeps the ruling when the notice fails', async () => {
      const service = build({ excuseById: pending() });
      (service as any).notifications = { notify: async () => { throw new Error('down'); } };
      const res: any = await service.review('6ab0000000000000000000ff', user, { verdict: 'accepted' });
      expect(res.data.status).toBe('accepted');
    });

    it('rejects an id that will not cast rather than throwing a BSONError', async () => {
      const service = build();
      await expect(service.review('not-an-id', user, { verdict: 'accepted' }))
        .rejects.toThrow('معرّف العذر غير صالح');
    });
  });

  describe('which days she is asked about', () => {
    it('skips days she attended and days already explained', async () => {
      const service = build({ attendanceOn: [] });
      const res: any = await service.pendingDays(user, 7);
      // Weekends are excluded by workingDatesBetween, so only Sun–Thu appear.
      for (const row of res.data) {
        const weekday = new Date(`${row.date}T00:00:00.000Z`).getUTCDay();
        expect([5, 6]).not.toContain(weekday); // never a Friday or Saturday
      }
    });

    it('lists the newest day first', async () => {
      const service = build();
      const res: any = await service.pendingDays(user, 10);
      const dates = res.data.map((r: any) => r.date);
      expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
    });
  });

  describe('counting excused absences', () => {
    it('counts only accepted excuses, per teacher', async () => {
      const service = build();
      (service as any).excuseModel = {
        find: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => [
                { teacherId: 'a' }, { teacherId: 'a' }, { teacherId: 'b' },
              ],
            }),
          }),
        }),
      };
      const counts = await service.excusedByTeacher(
        new Date('2026-09-01'), new Date('2026-09-30'),
      );
      expect(counts.get('a')).toBe(2);
      expect(counts.get('b')).toBe(1);
    });
  });
});
