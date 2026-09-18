import { AttendanceService } from './attendance.service';

/**
 * Telling a family their child was absent, on the day it happened.
 *
 * The parent signs in as their child, and until this existed the only way to
 * learn of an absence was to go looking for it on a screen they had no reason
 * to open — so families found out weeks later, on the report, when nothing
 * could be done about it.
 */
describe('Recording an absence tells the student', () => {
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
    expect(notice.body).toContain('سارة خالد');
    expect(notice.body).toContain('2026-09-18');
    expect(notice.data.date).toBe('2026-09-18');
  });

  it('names the class, so a parent of two children knows which one', async () => {
    await markAbsent();
    expect(notifications.notify.mock.calls[0][0].body).toContain('الصف الأول/١');
  });

  it('still records the absence when the notice cannot be sent', async () => {
    // The record is the point. An absence must not be rolled back because a
    // message failed — that would delete a fact to save a courtesy.
    notifications.notify.mockRejectedValue(new Error('push is down'));

    await expect(markAbsent()).resolves.toBeDefined();
    expect(attendanceModel.create).toHaveBeenCalled();
  });
});
