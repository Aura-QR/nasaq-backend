import { coversClass, coversLecture } from './substitute-access.util';
import { DailyTrackingService } from '../daily-tracking/daily-tracking.service';
import { tenantLocalStorage } from '../tenancy/tenant-storage';

/**
 * A substitute acting on the period she covers.
 *
 * نورة is absent; the cover board sends سارة to period 3 of ٢/أ. Before this,
 * سارة opening that period's sheet was told «هذه ليست حصتك», so a covered
 * period could never have its daily tracking recorded by anyone.
 */
const SARA = '6ab0000000000000000000a1';
const NOURA = '6ab0000000000000000000a2';
const OTHER = '6ab0000000000000000000a3';
const LECTURE = '6ab0000000000000000000b1';
const CLASS = '6ab0000000000000000000c1';
const SCHOOL = '6ab0000000000000000000aa';
const DAY = '2026-10-04';

/** One cover row: سارة on LECTURE on DAY. */
const substitutions: any = {
  exists: async (q: any) =>
    String(q.substituteTeacherId) === SARA &&
    String(q.lectureId) === LECTURE &&
    q.date.toISOString() === `${DAY}T00:00:00.000Z`
      ? { _id: 's1' }
      : null,
  find: (q: any) => ({
    select: () => ({
      lean: () => ({
        exec: async () =>
          String(q.substituteTeacherId) === SARA && q.date.toISOString() === `${DAY}T00:00:00.000Z`
            ? [{ lectureId: LECTURE }]
            : [],
      }),
    }),
  }),
};
const lectures: any = {
  exists: async (q: any) =>
    q._id.$in.map(String).includes(LECTURE) && String(q.classId) === CLASS ? { _id: LECTURE } : null,
};

describe('who covers a period', () => {
  it('the substitute, on the day', async () => {
    expect(await coversLecture(substitutions, SARA, LECTURE, DAY)).toBe(true);
  });

  it('not the next day — the period goes back to its teacher', async () => {
    expect(await coversLecture(substitutions, SARA, LECTURE, '2026-10-05')).toBe(false);
  });

  it('not another teacher', async () => {
    expect(await coversLecture(substitutions, OTHER, LECTURE, DAY)).toBe(false);
  });

  it('answers false, not a BSONError, for a malformed id', async () => {
    expect(await coversLecture(substitutions, 'not-an-id', LECTURE, DAY)).toBe(false);
  });

  it('answers false when the model is absent', async () => {
    expect(await coversLecture(undefined, SARA, LECTURE, DAY)).toBe(false);
  });

  it('lets the substitute record the class’s day-level attendance', async () => {
    expect(await coversClass(substitutions, lectures, SARA, CLASS, DAY)).toBe(true);
    expect(await coversClass(substitutions, lectures, SARA, '6ab0000000000000000000c9', DAY)).toBe(false);
    expect(await coversClass(substitutions, lectures, OTHER, CLASS, DAY)).toBe(false);
  });
});

describe('daily tracking on a covered period', () => {
  let written: any[];
  const build = () => {
    written = [];
    return new DailyTrackingService(
      { bulkWrite: async (ops: any[]) => { written.push(...ops); return {}; } } as any,
      {
        findById: () => ({
          populate: function () { return this; },
          exec: async () => ({
            _id: LECTURE, teacherId: NOURA,
            classId: { _id: CLASS, name: '٢/أ' },
            subjectOfferingId: { _id: 'o1', subjectId: { subjectName: 'الرياضيات' } },
          }),
        }),
      } as any,
      { find: () => ({ select: () => ({ exec: async () => [{ _id: '6ab000000000000000000001' }] }) }) } as any,
      { find: () => ({ select: () => ({ exec: async () => [] }) }) } as any,
      { create: async () => undefined, delete: async () => undefined } as any,
      substitutions,
    );
  };
  const save = (teacherId: string, date = DAY, extra: any = { role: 'TEACHER' }) =>
    tenantLocalStorage.run({ schoolId: SCHOOL, isAdminContext: false }, () =>
      build().bulkUpsert(
        { lectureId: LECTURE, date, records: [{ studentId: '6ab000000000000000000001', absent: false }] } as any,
        { ...extra, userId: teacherId },
      ),
    );

  // The bulk route lets MANAGER past its guard; the service decides. Managers
  // have dailyTracking.add off by default.
  const MANAGER_NO_ADD = { role: 'MANAGER', permissionsVersion: 2, permissions: ['school.dailyTracking.read'] };
  const MANAGER_WITH_ADD = { role: 'MANAGER', permissionsVersion: 2, permissions: ['school.dailyTracking.create'] };

  it('a manager covering the period can save it without the permission', async () => {
    const res: any = await save(SARA, DAY, MANAGER_NO_ADD);
    expect(res.status).toBe(true);
  });

  it('a manager without the permission is refused on a period she is not covering', async () => {
    await expect(save(OTHER, DAY, MANAGER_NO_ADD)).rejects.toThrow('ليس لديك صلاحية');
    await expect(save(SARA, '2026-10-05', MANAGER_NO_ADD)).rejects.toThrow('ليس لديك صلاحية');
  });

  it('a manager the school gave the permission still saves any period', async () => {
    const res: any = await save(OTHER, DAY, MANAGER_WITH_ADD);
    expect(res.status).toBe(true);
  });

  it('the substitute can save it', async () => {
    const res: any = await save(SARA);
    expect(res.status).toBe(true);
    expect(written).toHaveLength(1);
  });

  it('the substitute cannot save it on another day', async () => {
    await expect(save(SARA, '2026-10-05')).rejects.toThrow('هذه ليست حصتك');
  });

  it('a teacher who is neither its teacher nor its substitute is still refused', async () => {
    await expect(save(OTHER)).rejects.toThrow('هذه ليست حصتك');
  });

  it('its own teacher still can', async () => {
    const res: any = await save(NOURA);
    expect(res.status).toBe(true);
  });
});
