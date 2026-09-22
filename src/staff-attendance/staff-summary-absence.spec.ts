import { BadRequestException } from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';

/**
 * Absence in the staff monthly report.
 *
 * The same hole the teacher report had, and for the same reason: every figure
 * in it was aggregated from records that exist, and absence is the days with
 * no record at all. A supervisor who never came in all month had no records,
 * so the report did not list them — the one person a review looks for was the
 * one person missing from it.
 */
describe('Absence in the staff summary', () => {
  const supervisorId = '60d5ecb8b5c9c22b8c8b4001';
  const managerId = '60d5ecb8b5c9c22b8c8b4002';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';

  let rows: any[];
  let directory: any[];
  let workSchedule: any[];
  let holidays: any[];
  let service: StaffAttendanceService;

  const owner = { userId: 'u1', schoolId, role: 'OWNER', name: 'المالك' };

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
    rows = [];
    directory = [
      { _id: supervisorId, username: 'أ. بشاير', role: 'SUPERVISOR' },
      { _id: managerId, username: 'أ. هدى', role: 'MANAGER' },
    ];

    const records = { aggregate: jest.fn().mockImplementation(async () => rows) };

    const admins = {
      find: jest.fn().mockReturnValue({
        select: () => ({
          sort: () => ({ lean: async () => directory }),
          setOptions: () => ({ lean: () => ({ exec: async () => [] }) }),
        }),
      }),
    };

    const schools = {
      findById: jest.fn().mockReturnValue({
        setOptions: () => ({
          lean: async () => ({
            settings: { timezone: 'Asia/Riyadh', workSchedule, holidays },
          }),
        }),
      }),
    };

    service = new StaffAttendanceService(
      records as any, admins as any, schools as any, {} as any,
      { notify: jest.fn() } as any,
    );
  });

  /** 2026-09-20 is a Sunday; 2026-09-26 is the Saturday after it. */
  const summary = (dateFrom = '2026-09-20', dateTo = '2026-09-26') =>
    service.getSummary(owner, { dateFrom, dateTo } as any);

  it('counts the school week, not the calendar week', async () => {
    const result = await summary();
    expect(result.workingDays).toBe(5);
  });

  it('lists somebody who never came in at all', async () => {
    rows = [
      { staffId: supervisorId, name: 'أ. بشاير', daysPresent: 5, daysPresentOnWorkingDays: 5 },
    ];

    const result = await summary();
    const missing = result.data.find((row: any) => row.name === 'أ. هدى');

    expect(missing).toBeDefined();
    expect(missing.daysAbsent).toBe(5);
    expect(missing.daysPresent).toBe(0);
  });

  it('subtracts the days somebody did come in', async () => {
    rows = [
      { staffId: supervisorId, name: 'أ. بشاير', daysPresent: 3, daysPresentOnWorkingDays: 3 },
    ];

    const result = await summary();
    const row = result.data.find((r: any) => r.name === 'أ. بشاير');
    expect(row.daysAbsent).toBe(2);
  });

  it('does not let a Friday cover a Tuesday', async () => {
    rows = [
      {
        staffId: supervisorId, name: 'أ. بشاير',
        daysPresent: 4, daysPresentOnWorkingDays: 3, daysOnDayOff: 1,
      },
    ];

    const result = await summary();
    const row = result.data.find((r: any) => r.name === 'أ. بشاير');
    expect(row.daysAbsent).toBe(2);
  });

  it('does not count a declared holiday against anybody', async () => {
    // Holidays reached staff attendance without this module knowing they
    // exist, because the check lives in resolveDaySchedule. This is the test
    // that says so out loud.
    holidays = [
      { name: 'إجازة منتصف الفصل', startDate: '2026-09-21', endDate: '2026-09-23' },
    ];
    rows = [
      { staffId: supervisorId, name: 'أ. بشاير', daysPresent: 2, daysPresentOnWorkingDays: 2 },
    ];

    const result = await summary();

    expect(result.workingDays).toBe(2);
    expect(
      result.data.find((r: any) => r.name === 'أ. بشاير').daysAbsent,
    ).toBe(0);
  });

  it('never reports a negative absence', async () => {
    rows = [
      { staffId: supervisorId, name: 'أ. بشاير', daysPresent: 9, daysPresentOnWorkingDays: 9 },
    ];

    const result = await summary();
    expect(
      result.data.find((r: any) => r.name === 'أ. بشاير').daysAbsent,
    ).toBe(0);
  });

  it('carries the denominator the column is read against', async () => {
    // "3 absences" is not a fact until you know out of how many.
    const result = await summary();
    expect(result.workingDays).toBe(5);
    expect(result.data.every((row: any) => row.workingDays === 5)).toBe(true);
  });

  it('refuses a range that runs backwards', async () => {
    // Stricter than the teacher summary, which answers zero working days for
    // the same input. Rejecting is the better of the two: a report of "0 days"
    // looks like a school that never opened.
    await expect(summary('2026-09-26', '2026-09-20')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
