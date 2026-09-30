import { TimetableService } from './timetable.service';

/**
 * A timetable where two stages run different days.
 *
 * مواهب المملكة: the school runs eight periods, six on Thursday. Its three
 * kindergarten grade levels run fourteen half-hour periods. Before this,
 * capacity was resolved once for the whole school, so the KG classes were
 * measured against the primary's week and no timetable was ever generated
 * for them.
 *
 * No database — the models are stubs and what is asserted is the resolution.
 */
describe('capacity when a stage runs its own day', () => {
  const SCHOOL = '6ab0000000000000000000aa';
  const KG_STAGE = '6ab0000000000000000001aa';
  const PRIMARY_STAGE = '6ab0000000000000000002aa';

  const WEEK = [
    { day: 'sunday', isWorkingDay: true, periodsPerDay: null },
    { day: 'monday', isWorkingDay: true, periodsPerDay: null },
    { day: 'tuesday', isWorkingDay: true, periodsPerDay: null },
    { day: 'wednesday', isWorkingDay: true, periodsPerDay: null },
    // The real short day at مواهب.
    { day: 'thursday', isWorkingDay: true, periodsPerDay: 6 },
    { day: 'friday', isWorkingDay: false, periodsPerDay: null },
    { day: 'saturday', isWorkingDay: false, periodsPerDay: null },
  ];

  /** stages: id -> periodsPerDay (null = follows the school). */
  const build = (
    stages: Record<string, number | null>,
    opts: { schoolPeriods?: number; schedule?: any[] } = {},
  ) => {
    const { schoolPeriods = 8, schedule = WEEK } = opts;

    const schoolModel: any = {
      findById: () => ({
        select: () => ({
          lean: () => ({
            exec: async () => ({
              settings: { workSchedule: schedule, periodsPerDay: schoolPeriods },
            }),
          }),
        }),
      }),
    };

    const stageModel: any = {
      findById: (id: any) => ({
        select: () => ({
          lean: () => ({
            exec: async () =>
              String(id) in stages
                ? { _id: String(id), periodsPerDay: stages[String(id)] }
                : null,
          }),
        }),
      }),
    };

    return new TimetableService(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      schoolModel, {} as any, {} as any, stageModel,
    );
  };

  describe('the school keeps its own day', () => {
    it('with no stage asked for, nothing changes', async () => {
      // The call every existing caller makes. This must not move.
      const c = await build({}).getCapacity(SCHOOL);
      expect(c.periodsPerDay).toBe(8);
      expect(c.periodsByDay.thursday).toBe(6);
      expect(c.slotsPerWeek).toBe(8 * 4 + 6);
    });

    it('a stage that sets nothing follows the school', async () => {
      // Every stage that existed before this feature.
      const c = await build({ [PRIMARY_STAGE]: null }).getCapacity(SCHOOL, PRIMARY_STAGE);
      expect(c.periodsPerDay).toBe(8);
      expect(c.slotsPerWeek).toBe(38);
    });

    it('a stage id that matches nothing falls back rather than failing', async () => {
      // A deleted stage must not take the timetable down with it.
      const c = await build({}).getCapacity(SCHOOL, '6ab0000000000000000009aa');
      expect(c.periodsPerDay).toBe(8);
    });
  });

  describe('a kindergarten on fourteen periods', () => {
    it('gets fourteen, not the school’s eight', async () => {
      const c = await build({ [KG_STAGE]: 14 }).getCapacity(SCHOOL, KG_STAGE);
      expect(c.periodsPerDay).toBe(14);
    });

    it('scales the short Thursday instead of applying it raw', async () => {
      // Thursday is six of eight — three quarters of a day. Three quarters
      // of fourteen is ten and a half, floored to ten. Applying the raw 6
      // would have given the KG a Thursday shorter than its own morning.
      const c = await build({ [KG_STAGE]: 14 }).getCapacity(SCHOOL, KG_STAGE);
      expect(c.periodsByDay.thursday).toBe(10);
      expect(c.periodsByDay.sunday).toBe(14);
    });

    it('never scales a day above the stage’s own length', async () => {
      const c = await build({ [KG_STAGE]: 14 }).getCapacity(SCHOOL, KG_STAGE);
      for (const n of Object.values(c.periodsByDay)) expect(n).toBeLessThanOrEqual(14);
    });

    it('never scales a day below one period', async () => {
      // A one-of-eight day against a two-period stage floors to 0 without
      // the guard, and a zero-length day is a grid with no cells.
      const c = await build({ [KG_STAGE]: 2 }, {
        schedule: [
          { day: 'sunday', isWorkingDay: true, periodsPerDay: 1 },
          { day: 'monday', isWorkingDay: true, periodsPerDay: null },
        ],
      }).getCapacity(SCHOOL, KG_STAGE);
      expect(c.periodsByDay.sunday).toBe(1);
    });

    it('counts a full week of its own', async () => {
      const c = await build({ [KG_STAGE]: 14 }).getCapacity(SCHOOL, KG_STAGE);
      expect(c.slotsPerWeek).toBe(14 * 4 + 10);
    });
  });

  describe('the two stages side by side', () => {
    it('one does not move when the other is set', async () => {
      // The promise the whole design rests on.
      const service = build({ [KG_STAGE]: 14, [PRIMARY_STAGE]: null });
      const kg = await service.getCapacity(SCHOOL, KG_STAGE);
      const primary = await service.getCapacity(SCHOOL, PRIMARY_STAGE);

      expect(kg.periodsPerDay).toBe(14);
      expect(primary.periodsPerDay).toBe(8);
      expect(primary.periodsByDay.thursday).toBe(6);
      expect(primary.slotsPerWeek).toBe(38);
    });
  });

  describe('resolving a whole run of classes at once', () => {
    const KG_CLASS = '6ab000000000000000000a01';
    const PRIMARY_CLASS = '6ab000000000000000000a02';
    const KG_GRADE = '6ab000000000000000000b01';
    const PRIMARY_GRADE = '6ab000000000000000000b02';

    const buildWithClasses = () => {
      const service = build({ [KG_STAGE]: 14, [PRIMARY_STAGE]: null });

      (service as any).classModel = {
        find: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => [
                { _id: KG_CLASS, gradeLevelId: KG_GRADE },
                { _id: PRIMARY_CLASS, gradeLevelId: PRIMARY_GRADE },
              ],
            }),
          }),
        }),
      };
      (service as any).gradeLevelModel = {
        find: () => ({
          select: () => ({
            lean: () => ({
              exec: async () => [
                { _id: KG_GRADE, stageId: KG_STAGE },
                { _id: PRIMARY_GRADE, stageId: PRIMARY_STAGE },
              ],
            }),
          }),
        }),
      };
      return service;
    };

    it('gives each class the week of its own stage', async () => {
      const { byClass } = await buildWithClasses()
        .getCapacityByClass(SCHOOL, [KG_CLASS, PRIMARY_CLASS]);

      expect(byClass.get(KG_CLASS).periodsPerDay).toBe(14);
      expect(byClass.get(PRIMARY_CLASS).periodsPerDay).toBe(8);
    });

    it('answers for a class it could not resolve', async () => {
      // An undefined here would read as a zero-length day in the solver.
      const { byClass } = await buildWithClasses()
        .getCapacityByClass(SCHOOL, [KG_CLASS, '6ab000000000000000000a99']);

      expect(byClass.get('6ab000000000000000000a99').periodsPerDay).toBe(8);
    });

    it('still returns the school’s own capacity alongside', async () => {
      const { school } = await buildWithClasses()
        .getCapacityByClass(SCHOOL, [KG_CLASS]);
      expect(school.periodsPerDay).toBe(8);
    });

    it('handles an empty class list without querying', async () => {
      const { byClass } = await buildWithClasses().getCapacityByClass(SCHOOL, []);
      expect(byClass.size).toBe(0);
    });
  });
});
