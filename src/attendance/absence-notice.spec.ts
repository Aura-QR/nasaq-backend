import { AttendanceService } from './attendance.service';

/**
 * Telling a family their child was absent, and hearing back.
 *
 * The parent signs in as their child. Until the notice existed the only way to
 * learn of an absence was to go looking for it on a screen they had no reason
 * to open — so families found out weeks later, on the report, when nothing
 * could be done. And until the excuse existed the notice asked a question the
 * system could not receive an answer to, which is worse than asking nothing.
 */
describe('Recording an absence tells the family', () => {
  const studentId = '60d5ecb8b5c9c22b8c8b4001';
  const classId = '60d5ecb8b5c9c22b8c8b4002';

  let attendanceModel: any;
  let studentModel: any;
  let classModel: any;
  let notifications: any;
  let service: AttendanceService;

  beforeEach(() => {
    attendanceModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (doc: any) => ({
        ...doc,
        _id: 'abs1',
        populate: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ ...doc, _id: 'abs1' }),
      })),
    };

    studentModel = {
      findById: jest.fn().mockResolvedValue({ _id: studentId, name: 'سارة خالد' }),
    };

    classModel = {
      findById: jest.fn().mockResolvedValue({ _id: classId, name: 'الصف الأول/١' }),
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new AttendanceService(
      attendanceModel,
      studentModel,
      classModel,
      {} as any,
      {} as any,
      {} as any,
      notifications,
    );
  });

  const markAbsent = (user?: any) =>
    service.create({ studentId, classId, date: '2026-09-18' } as any, user);

  it('sends the notice to the student’s own account, which is the parent’s way in', async () => {
    await markAbsent();

    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const notice = notifications.notify.mock.calls[0][0];
    expect(String(notice.recipientId)).toBe(studentId);
    expect(notice.type).toBe('student_absent');
  });

  it('names the child in the title, so a parent of two knows which one', async () => {
    // The class is not enough on its own — siblings can share one. The name is.
    await markAbsent();
    expect(notifications.notify.mock.calls[0][0].title).toContain('سارة خالد');
  });

  it('asks for the reason and the medical note, in the school’s own words', async () => {
    await markAbsent();
    const body = notifications.notify.mock.calls[0][0].body;
    expect(body).toContain('نأمل إيضاح سبب غياب');
    expect(body).toContain('العذر الطبي');
  });

  it('carries the date and class as data, since the wording says only “today”', async () => {
    // "لهذا اليوم" is true on the morning it arrives and ambiguous a week
    // later, so the client needs the day itself to label an older notice.
    await markAbsent();
    const notice = notifications.notify.mock.calls[0][0];
    expect(notice.data.date).toBe('2026-09-18');
    expect(notice.data.className).toBe('الصف الأول/١');
    expect(notice.data.excuseRequested).toBe(true);
    expect(notice.data.attendanceId).toBe('abs1');
  });

  it('still records the absence when the notice cannot be sent', async () => {
    // The record is the point. An absence must not be rolled back because a
    // message failed — that would delete a fact to save a courtesy.
    notifications.notify.mockRejectedValue(new Error('push is down'));

    await expect(markAbsent()).resolves.toBeDefined();
    expect(attendanceModel.create).toHaveBeenCalled();
  });
});
