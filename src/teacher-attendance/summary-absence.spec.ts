import { TeacherAttendanceService } from './teacher-attendance.service';

/**
 * Absence in the monthly report.
 *
 * Every other figure in this report is derived from a record that exists:
 * days present, minutes late, minutes short. Absence is the opposite — it is
 * the days with no record at all. So the teacher who never came in had no
 * records, and the report simply did not list them: the one person a monthly
 * review is looking for was the one person missing from it.
 *
 * Which means absence cannot be aggregated out of the collection. It has to
 * be counted against the school's own working week.
 */
describe('Absence in the monthly summary', () => {
  const teacherA = '60d5ecb8b5c9c22b8c8b4001';
  const teacherB = '60d5ecb8b5c9c22b8c8b4002';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';

  let aggregateRows: any[];
  let teachers: any[];
  let workSchedule: any[];
  let holidays: any[];
  let service: TeacherAttendanceService;

  const owner = { userId: 'u1', schoolId, name: 'المالك' };

  /** Sunday to Thursday, which is the Saudi school week. */
  const fiveDayWeek = () =>
    [
      ['sunday', true], ['monday', true], ['tuesday', true],
      ['wednesday', true], ['thursday', true],
      ['friday', false], ['saturday', false],
    ].map(([day, isWorkingDay]) => ({
      day,
      isWorkingDay,
      startTime: isWorkingDay ? '06:45' : null,
      endTime: isWorkingDay ? '13:00' : null,
    }));

  beforeEach(() => {
    workSchedule = fiveDayWeek();
    holidays = [];
    aggregateRows = [];
    teachers = [
      { _id: teacherA, name: 'أ. سارة' },
      { _id: teacherB, name: 'أ. نورة' },
    ];

    const attendanceModel = {
      aggregate: jest.fn().mockImplementation(async () => aggregateRows),
    };
    const teacherModel = {
      find: jest.fn().mockImplementation(() => ({
        select: () => ({ lean: async () => teachers }),
      })),
    };
    const schoolModel = {
      findById: jest.fn().mockImplementation(() => ({
        setOptions: () => ({
          lean: async () => ({ settings: { workSchedule, holidays } }),
        }),
      })),
    };

    service = new TeacherAttendanceService(
      attendanceModel as any, teacherModel as any, schoolModel as any,
      {} as any, {} as any, { notify: jest.fn() } as any,
    );
  });

  /** 2026-09-20 is a Sunday; 2026-09-26 is the Saturday after it. */
  const summary = (dateFrom = '2026-09-20', dateTo = '2026-09-26') =>
    service.getMonthlySummary({ dateFrom, dateTo } as any, owner);

  it('counts the school week, not the calendar week', async () => {
    // Seven days on the calendar, five the school actually works. Reporting
    // two days of absence for every teacher every week is a report nobody
    // reads twice.
    const result = await summary();
    expect(result.workingDays).toBe(5);
  });

  it('lists a teacher who never came in at all', async () => {
    // This is the whole point. They have no attendance records, so the
    // aggregation returns nothing for them, and the report used to answer a
    // question about absence without mentioning the only person who was.
    aggregateRows = [
      { teacherId: teacherA, teacherName: 'أ. سارة', daysPresent: 5, daysPresentOnWorkingDays: 5 },
    ];

    const result = await summary();
    const absent = result.data.find((row: any) => row.teacherName === 'أ. نورة');

    expect(absent).toBeDefined();
    expect(absent.daysAbsent).toBe(5);
    expect(absent.daysPresent).toBe(0);
  });

  it('subtracts the days somebody did come in', async () => {
    aggregateRows = [
      { teacherId: teacherA, teacherName: 'أ. سارة', daysPresent: 3, daysPresentOnWorkingDays: 3 },
    ];

    const result = await summary();
    const row = result.data.find((r: any) => r.teacherName === 'أ. سارة');
    expect(row.daysAbsent).toBe(2);
  });

  it('does not let a Friday cover a Tuesday', async () => {
    // Attendance on a day off is real and recorded, but a teacher who came in
    // on Friday has not thereby attended the Tuesday they missed.
    aggregateRows = [
      {
        teacherId: teacherA, teacherName: 'أ. سارة',
        daysPresent: 4, daysPresentOnWorkingDays: 3, daysOnDayOff: 1,
      },
    ];

    const result = await summary();
    const row = result.data.find((r: any) => r.teacherName === 'أ. سارة');
    expect(row.daysAbsent).toBe(2);
  });

  it('never reports a negative absence', async () => {
    // A school that shortened its week mid-period can leave more attended
    // days on file than the current schedule has working days, and "-2 days
    // absent" is a number nobody can act on.
    aggregateRows = [
      { teacherId: teacherA, teacherName: 'أ. سارة', daysPresent: 9, daysPresentOnWorkingDays: 9 },
    ];

    const result = await summary();
    const row = result.data.find((r: any) => r.teacherName === 'أ. سارة');
    expect(row.daysAbsent).toBe(0);
  });

  it('keeps a teacher who has left the school in the totals', async () => {
    // They are not in the active list any more, but their days happened and
    // dropping them is silent under-reporting of the period.
    teachers = [{ _id: teacherA, name: 'أ. سارة' }];
    aggregateRows = [
      { teacherId: teacherA, teacherName: 'أ. سارة', daysPresent: 5, daysPresentOnWorkingDays: 5 },
      {
        teacherId: '60d5ecb8b5c9c22b8c8b4003', teacherName: 'أ. هند',
        teacherDeleted: true, daysPresent: 2, daysPresentOnWorkingDays: 2,
      },
    ];

    const result = await summary();
    expect(result.data.map((r: any) => r.teacherName)).toContain('أ. هند');
  });

  it('narrows to one teacher when asked for one', async () => {
    aggregateRows = [];
    teachers = [{ _id: teacherB, name: 'أ. نورة' }];

    const result = await service.getMonthlySummary(
      { dateFrom: '2026-09-20', dateTo: '2026-09-26', teacherId: teacherB } as any,
      owner,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0].daysAbsent).toBe(5);
  });

  it('treats a school with no schedule as working every day', async () => {
    // The fallback the rest of the module already uses. Guessing days off the
    // school never declared would invent absences.
    workSchedule = [];
    const result = await summary();
    expect(result.workingDays).toBe(7);
  });

  it('counts a single day as a single day', async () => {
    // An off-by-one here shifts every absence figure in the report by one.
    const result = await summary('2026-09-20', '2026-09-20');
    expect(result.workingDays).toBe(1);
  });

  it('does not count a declared holiday against anybody', async () => {
    // The whole reason holidays exist. A mid-term break used to read as three
    // days of absence for every teacher in the school, and a report that
    // accuses everyone accuses no one.
    holidays = [
      { name: 'إجازة منتصف الفصل', startDate: '2026-09-21', endDate: '2026-09-23' },
    ];
    aggregateRows = [
      { teacherId: teacherA, teacherName: 'أ. سارة', daysPresent: 2, daysPresentOnWorkingDays: 2 },
    ];

    const result = await summary();

    expect(result.workingDays).toBe(2);
    const row = result.data.find((r: any) => r.teacherName === 'أ. سارة');
    expect(row.daysAbsent).toBe(0);
  });

  it('closes a whole week when the break covers it', async () => {
    holidays = [
      { name: 'إجازة العيد', startDate: '2026-09-19', endDate: '2026-09-30' },
    ];
    const result = await summary();
    expect(result.workingDays).toBe(0);
    expect(result.data.every((row: any) => row.daysAbsent === 0)).toBe(true);
  });

  it('returns nothing measurable for a range that runs backwards', async () => {
    const result = await summary('2026-09-26', '2026-09-20');
    expect(result.workingDays).toBe(0);
  });
});
