import { AttendanceService } from './attendance.service';

/**
 * Splitting a student's absences by what the school decided, without moving
 * the number of them.
 *
 * The school was asked directly and was explicit: an accepted excuse is still
 * an absence, never a present. So the breakdown sits beside the total and
 * never inside it — the day the two disagree is the day a report contradicts
 * the rule the school set.
 */
describe("A student's absences, split by verdict", () => {
  const studentId = '60d5ecb8b5c9c22b8c8b4001';

  let records: any[];
  let attendanceModel: any;
  let service: AttendanceService;

  const row = (excuseStatus: string | null) => ({
    _id: `a${Math.random()}`,
    studentId,
    date: new Date('2026-09-18T00:00:00.000Z'),
    excuseStatus,
    toObject: () => ({ excuseStatus }),
  });

  beforeEach(() => {
    records = [];

    attendanceModel = {
      find: jest.fn().mockReturnValue({
        populate: () => ({
          sort: () => ({ exec: async () => records }),
        }),
      }),
    };

    service = new AttendanceService(
      attendanceModel,
      { findById: jest.fn().mockResolvedValue({ _id: studentId }) } as any,
      {} as any, {} as any, {} as any, {} as any,
      { notify: jest.fn() } as any,
    );
  });

  it('counts each verdict, and the parts add up to the whole', async () => {
    records = [
      row('accepted'), row('accepted'),
      row('rejected'),
      row('pending'),
      row(null), row(null), row(null),
    ];

    const result = await service.getMyAttendance(studentId);
    const { excused, refused, awaiting, unanswered } = result.breakdown;

    expect(excused).toBe(2);
    expect(refused).toBe(1);
    expect(awaiting).toBe(1);
    expect(unanswered).toBe(3);
    expect(excused + refused + awaiting + unanswered).toBe(result.total);
  });

  it('leaves the total alone when an excuse is accepted', async () => {
    // The whole point. Seven absences with every excuse accepted are still
    // seven absences, because that is what the school said.
    records = [row('accepted'), row('accepted'), row('accepted')];

    const result = await service.getMyAttendance(studentId);

    expect(result.total).toBe(3);
    expect(result.breakdown.excused).toBe(3);
  });

  it('treats an absence nobody answered as unanswered, not refused', async () => {
    // Silence is not a rejection. Counting it as one would put a mark on a
    // family that was never asked or never saw the notice.
    records = [row(null)];

    const result = await service.getMyAttendance(studentId);

    expect(result.breakdown.unanswered).toBe(1);
    expect(result.breakdown.refused).toBe(0);
  });

  it('reports zeroes for a student who has never been absent', async () => {
    const result = await service.getMyAttendance(studentId);

    expect(result.total).toBe(0);
    expect(result.breakdown).toEqual({
      excused: 0, refused: 0, awaiting: 0, unanswered: 0,
    });
  });
});
