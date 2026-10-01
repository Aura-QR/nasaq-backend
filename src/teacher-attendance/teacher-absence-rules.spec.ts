import { TeacherAbsenceExcuseService } from './teacher-absence-excuse.service';
import { TeacherAbsenceSweepService } from './teacher-absence-sweep.service';
import {
  schoolDayHasEnded,
  schoolNow,
  worksOn,
} from './teacher-presence.util';

/**
 * Who is asked to explain an absence, and when.
 *
 * The first version asked every teacher at مواهب المملكة to explain the
 * national day — the school had not entered it as a holiday — and asked a
 * teacher who was out on a school trip with the students to explain a day
 * she worked. Each case that went wrong there has a test here by name.
 *
 * The school week below is مواهب's: Sunday to Thursday, the day ending at
 * 13:10, Riyadh time. 2026-10-01 is a Thursday.
 */

const T = '6ab0000000000000000000a1';
const SCHOOL = '6ab0000000000000000000aa';

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(
  (day) => {
    const working = !['friday', 'saturday'].includes(day);
    return {
      day,
      isWorkingDay: working,
      startTime: working ? '06:45' : null,
      endTime: working ? '13:10' : null,
    };
  },
);

const baseSettings = (over: any = {}) => ({
  teacherCheckInEnabled: true,
  timezone: 'Asia/Riyadh',
  workSchedule: WEEK,
  holidays: [
    { name: 'اليوم الوطني', startDate: '2026-09-23', endDate: '2026-09-24' },
  ],
  ...over,
});

/** A Riyadh wall-clock moment, as a UTC instant. */
const riyadh = (date: string, time: string) =>
  new Date(`${date}T${time}:00.000+03:00`);

const d = (label: string) => new Date(`${label}T00:00:00.000Z`);
const label = (x: any) => new Date(x).toISOString().slice(0, 10);

describe('the presence rules', () => {
  it('reads an empty or missing work week as every school day', () => {
    // Every teacher who existed before the field must be unaffected.
    expect(worksOn(null, d('2026-09-29'))).toBe(true);
    expect(worksOn(undefined, d('2026-09-29'))).toBe(true);
    expect(worksOn([], d('2026-09-29'))).toBe(true);
  });

  it('honours a short work week', () => {
    // مناير: Sunday and Monday only.
    const days = ['sunday', 'monday'];
    expect(worksOn(days, d('2026-09-27'))).toBe(true); // Sunday
    expect(worksOn(days, d('2026-09-29'))).toBe(false); // Tuesday
  });

  it('knows the school’s date when the server’s differs', () => {
    // 22:30 UTC on the 1st is 01:30 on the 2nd in Riyadh.
    const now = schoolNow('Asia/Riyadh', new Date('2026-10-01T22:30:00.000Z'));
    expect(now.label).toBe('2026-10-02');
    expect(now.minutes).toBe(90);
  });

  it('treats a day with no end time as not finished', () => {
    expect(schoolDayHasEnded(null, 23 * 60)).toBe(false);
    expect(schoolDayHasEnded('13:10', 13 * 60 + 9)).toBe(false);
    expect(schoolDayHasEnded('13:10', 13 * 60 + 10)).toBe(true);
    expect(schoolDayHasEnded('13:10', 13 * 60 + 39, 30)).toBe(false);
    expect(schoolDayHasEnded('13:10', 13 * 60 + 40, 30)).toBe(true);
  });
});

describe('the days a teacher is asked about', () => {
  const build = (opts: {
    settings?: any;
    attendance?: string[];
    excuses?: string[];
    workDays?: string[] | null;
    hireDate?: string | null;
  } = {}) => {
    const {
      settings = baseSettings(),
      attendance = ['2026-09-17'],
      excuses = [],
      workDays = null,
      hireDate = '2026-08-01',
    } = opts;

    const sorted = [...attendance].sort();
    const inRange = (list: string[], q: any) =>
      list
        .filter((x) => {
          const t = d(x).getTime();
          return t >= q.date.$gte.getTime() && t <= q.date.$lte.getTime();
        })
        .map((x) => ({ date: d(x) }));

    const attendanceModel: any = {
      findOne: () => ({
        sort: () => ({
          select: () => ({
            lean: () => ({ exec: async () => (sorted.length ? { date: d(sorted[0]) } : null) }),
          }),
        }),
      }),
      find: (q: any) => ({
        select: () => ({ lean: () => ({ exec: async () => inRange(attendance, q) }) }),
      }),
    };
    const excuseModel: any = {
      find: (q: any) => ({
        select: () => ({ lean: () => ({ exec: async () => inRange(excuses, q) }) }),
      }),
    };
    const teacherModel: any = {
      findById: () => ({
        select: () => ({
          lean: () => ({
            exec: async () => ({ hireDate: hireDate ? d(hireDate) : undefined, workDays }),
          }),
        }),
      }),
    };
    const schoolModel: any = {
      findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ settings }) }) }) }),
    };

    return new TeacherAbsenceExcuseService(
      excuseModel, attendanceModel, teacherModel, schoolModel, {} as any, {} as any,
    );
  };

  const user = { userId: T, schoolId: SCHOOL };
  const pending = async (service: any, now: Date) =>
    (await service.pendingDays(user, 14, now)).data.map((r: any) => r.date);

  it('never asks about the national day once it is entered as a holiday', async () => {
    // The case that started this: 27 of 27 teachers asked about the 23rd and
    // the 24th, because nobody had told the system they were a holiday.
    const days = await pending(build(), riyadh('2026-10-01', '14:00'));
    expect(days).not.toContain('2026-09-23');
    expect(days).not.toContain('2026-09-24');
    // And the list is not simply empty: the Tuesday before is still asked.
    expect(days).toContain('2026-09-22');
  });

  it('never asks about a Friday or a Saturday', async () => {
    const days = await pending(build(), riyadh('2026-10-01', '14:00'));
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) expect([5, 6]).not.toContain(d(day).getUTCDay());
  });

  it('does not ask about today while the school day is still running', async () => {
    // At 06:30 she may be on her way in. "You are absent" at breakfast is
    // how a school learns to ignore the app.
    const morning = await pending(build(), riyadh('2026-10-01', '06:30'));
    expect(morning).not.toContain('2026-10-01');
  });

  it('asks about today once the school day is over', async () => {
    const afternoon = await pending(build(), riyadh('2026-10-01', '13:15'));
    expect(afternoon).toContain('2026-10-01');
  });

  it('does not ask about a weekday she does not work', async () => {
    // مناير comes in Sunday and Monday. She was asked about Tuesday,
    // Wednesday and Thursday every week.
    const days = await pending(
      build({ workDays: ['sunday', 'monday'] }),
      riyadh('2026-10-01', '14:00'),
    );
    for (const day of days) expect(['sunday', 'monday']).toContain(
      ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
        d(day).getUTCDay()
      ],
    );
    expect(days).toContain('2026-09-28'); // a Monday she missed
  });

  it('does not ask about days before she first used check-in', async () => {
    // Before her first record, a missing one means "not using the system
    // yet". A school switching this on must not hand out two weeks of
    // history to explain.
    const days = await pending(
      build({ attendance: ['2026-09-28'] }),
      riyadh('2026-10-01', '14:00'),
    );
    for (const day of days) expect(day >= '2026-09-28').toBe(true);
    expect(days).toContain('2026-09-29');
  });

  it('does not ask about days before she was hired', async () => {
    const days = await pending(
      build({ hireDate: '2026-09-29', attendance: ['2026-09-01'] }),
      riyadh('2026-10-01', '14:00'),
    );
    for (const day of days) expect(day >= '2026-09-29').toBe(true);
    expect(days).toContain('2026-09-30');
  });

  it('does not ask about a day she attended or already explained', async () => {
    const days = await pending(
      build({ attendance: ['2026-09-17', '2026-09-29'], excuses: ['2026-09-30'] }),
      riyadh('2026-10-01', '14:00'),
    );
    expect(days).not.toContain('2026-09-29');
    expect(days).not.toContain('2026-09-30');
    expect(days).toContain('2026-09-28');
  });

  it('asks nothing at a school that does not use check-in', async () => {
    // With no check-ins, every teacher reads as absent every day.
    const days = await pending(
      build({ settings: baseSettings({ teacherCheckInEnabled: false }) }),
      riyadh('2026-10-01', '14:00'),
    );
    expect(days).toEqual([]);
  });

  it('asks nothing of a teacher who has never recorded attendance', async () => {
    const days = await pending(build({ attendance: [] }), riyadh('2026-10-01', '14:00'));
    expect(days).toEqual([]);
  });
});

describe('the end-of-day notice', () => {
  const ALICE = '6ab0000000000000000000b1'; // absent, uses check-in
  const BEA = '6ab0000000000000000000b2'; // present
  const CARA = '6ab0000000000000000000b3'; // explained already
  const DINA = '6ab0000000000000000000b4'; // works Sun/Mon only
  const EVA = '6ab0000000000000000000b5'; // never used check-in

  let notified: any[];
  let notices: Set<string>;

  const build = () => {
    notified = [];
    notices = new Set();
    const today = '2026-10-01';

    const teachers = [
      { _id: ALICE, name: 'A', workDays: null },
      { _id: BEA, name: 'B', workDays: null },
      { _id: CARA, name: 'C', workDays: null },
      { _id: DINA, name: 'D', workDays: ['sunday', 'monday'] },
      { _id: EVA, name: 'E', workDays: null },
    ];
    const chain = (rows: any[]) => ({
      select: () => ({ lean: () => ({ exec: async () => rows }) }),
    });

    const service = new TeacherAbsenceSweepService(
      {} as any,
      { find: () => chain(teachers) } as any,
      {
        find: () => chain([{ teacherId: BEA }]),
        distinct: () => ({ exec: async () => [ALICE, BEA, CARA, DINA] }),
      } as any,
      { find: () => chain([{ teacherId: CARA }]) } as any,
      {
        find: () => chain([...notices].map((id) => ({ teacherId: id }))),
        create: async (doc: any) => {
          const key = `${doc.teacherId}|${label(doc.date)}`;
          if (notices.has(String(doc.teacherId))) {
            const e: any = new Error('dup');
            e.code = 11000;
            throw e;
          }
          notices.add(String(doc.teacherId));
          return { ...doc, key };
        },
      } as any,
      { notify: async (n: any) => { notified.push(n); } } as any,
    );
    void today;
    return service;
  };

  const school = (over: any = {}) => ({ _id: SCHOOL, settings: baseSettings(over) });

  it('waits for the school day to end, plus half an hour', async () => {
    const service = build();
    expect(await service.sweepSchool(school(), riyadh('2026-10-01', '13:30'))).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it('asks only the teacher who was actually absent', async () => {
    const service = build();
    const sent = await service.sweepSchool(school(), riyadh('2026-10-01', '13:45'));

    expect(sent).toBe(1);
    expect(notified.map((n) => String(n.recipientId))).toEqual([ALICE]);
    expect(notified[0].type).toBe('teacher_absence_excuse_required');
    expect(notified[0].data.date).toBe('2026-10-01');
  });

  it('never asks the same teacher twice for the same day', async () => {
    // Runs every fifteen minutes, and servers restart.
    const service = build();
    await service.sweepSchool(school(), riyadh('2026-10-01', '13:45'));
    await service.sweepSchool(school(), riyadh('2026-10-01', '14:00'));
    expect(notified).toHaveLength(1);
  });

  it('sends nothing on a holiday', async () => {
    const service = build();
    const sent = await service.sweepSchool(
      school({ holidays: [{ name: 'إجازة', startDate: '2026-10-01', endDate: '2026-10-01' }] }),
      riyadh('2026-10-01', '15:00'),
    );
    expect(sent).toBe(0);
  });

  it('sends nothing at a school that does not use check-in', async () => {
    const service = build();
    const sent = await service.sweepSchool(
      school({ teacherCheckInEnabled: false }),
      riyadh('2026-10-01', '15:00'),
    );
    expect(sent).toBe(0);
  });

  it('keeps sweeping other schools when one fails', async () => {
    const service = build();
    const spy = jest.spyOn(service, 'sweepSchool')
      .mockRejectedValueOnce(new Error('bad data'))
      .mockResolvedValueOnce(1);
    (service as any).schoolModel = {
      find: () => ({
        select: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => [{ _id: 1 }, { _id: 2 }] }) }) }),
      }),
    };
    await service.sweep(riyadh('2026-10-01', '15:00'));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('closing an excuse because she was present', () => {
  let saved: any;
  let notified: any[];

  const build = (status = 'pending') => {
    saved = null;
    notified = [];
    const excuse: any = {
      _id: 'ex1', teacherId: T, date: d('2026-09-30'), status,
      save: async function () { saved = this; },
    };
    return new TeacherAbsenceExcuseService(
      { findById: async () => excuse } as any,
      {} as any, {} as any, {} as any, {} as any,
      { notify: async (n: any) => { notified.push(n); } } as any,
    );
  };

  const id = '6ab0000000000000000000ff';
  const admin = { userId: '6ab0000000000000000000c1', name: 'المديرة' };

  it('closes it as present, not as an accepted excuse', async () => {
    // جوهرة was on a trip with the students. Accepting her "excuse" would
    // have recorded an excused absence for a day she worked.
    const service = build();
    const res: any = await service.markPresent(id, admin, 'رحلة مدرسية');
    expect(res.data.status).toBe('marked_present');
    expect(saved.reviewNote).toBe('رحلة مدرسية');
  });

  it('tells the teacher her day is recorded as attended', async () => {
    const service = build();
    await service.markPresent(id, admin);
    expect(notified[0].type).toBe('teacher_absence_excuse_reviewed');
    expect(notified[0].data.status).toBe('marked_present');
  });

  it('refuses an excuse that was already ruled on', async () => {
    const service = build('accepted');
    await expect(service.markPresent(id, admin)).rejects.toThrow('تمت مراجعة هذا العذر بالفعل');
  });

  it('does not let an accepted ruling follow a marked-present one', async () => {
    const service = build('marked_present');
    await expect(service.review(id, admin, { verdict: 'accepted' } as any))
      .rejects.toThrow('تمت مراجعة هذا العذر بالفعل');
  });
});
