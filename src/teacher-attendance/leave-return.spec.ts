import { TeacherAttendanceService } from './teacher-attendance.service';

/**
 * Coming back from an approved استئذان: the day she closed on leaving is
 * reopened, the time she left is kept on the leave, and the school is told.
 */
describe('Teacher back from leave', () => {
  const schoolId = '60d5ecb8b5c9c22b8c8b4561';
  const teacherId = '60d5ecb8b5c9c22b8c8b4562';
  const ownerId = '60d5ecb8b5c9c22b8c8b4570';
  const onSite = { lat: 24.7136, lng: 46.6753 };
  const req = { ip: '203.0.113.5', headers: {} };
  const teacher = { userId: teacherId, schoolId, role: 'TEACHER' };
  const leftAt = new Date('2026-09-22T07:00:00.000Z'); // 10:00 Riyadh

  const build = (leave: any, record: any) => {
    const settings = {
      teacherCheckInEnabled: true,
      location: onSite,
      checkInRadiusMeters: 150,
      schoolNetworkIps: [],
      timezone: 'Asia/Riyadh',
    };
    const attendanceModel = { findOne: jest.fn().mockResolvedValue(record) };
    const schoolModel = {
      findById: jest.fn().mockReturnValue({ setOptions: () => ({ lean: async () => ({ settings }) }) }),
    };
    const leaveRequestModel = { findOne: jest.fn().mockResolvedValue(leave) };
    const adminModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => [{ _id: ownerId }] }) }) }),
      }),
    };
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const service = new TeacherAttendanceService(
      attendanceModel as any,
      {} as any,
      schoolModel as any,
      leaveRequestModel as any,
      adminModel as any,
      notifications as any,
      { excusedByTeacher: jest.fn() } as any,
    );
    return { service, notifications };
  };

  const approvedLeave = () => ({
    _id: 'leave1', teacherId, teacherName: 'أ. أروى', leaveAt: '10:00', status: 'approved', returnedAt: null, save: jest.fn(),
  });

  it('reopens the day, keeps when she left, and tells the school', async () => {
    const leave: any = approvedLeave();
    const record: any = {
      checkInAt: new Date(), checkOutAt: leftAt, workMinutes: 180, earlyLeaveMinutes: 240,
      earlyLeaveApproved: true, approvedLeaveAt: '10:00', save: jest.fn(),
    };
    const { service, notifications } = build(leave, record);

    const result: any = await service.returnFromLeave(teacher, onSite as any, req);

    expect(record.checkOutAt).toBeNull();
    expect(record.workMinutes).toBeNull();
    expect(record.earlyLeaveApproved).toBe(false);
    expect(record.save).toHaveBeenCalled();
    expect(leave.departedAt).toBe(leftAt);
    expect(leave.returnedAt).toBeInstanceOf(Date);
    expect(leave.returnVerification).toEqual({ gps: true, network: false });
    expect(result.message).toBe('تم تسجيل عودتك من الاستئذان');
    const notice = notifications.notify.mock.calls[0][0];
    expect(notice).toMatchObject({ recipientId: ownerId, type: 'leave_returned', title: 'عادت أ. أروى من الاستئذان' });
    expect(notice.body).toContain('خرجت الساعة 10:00');
  });

  it('works when she left without recording a check-out', async () => {
    const leave: any = approvedLeave();
    const { service } = build(leave, { checkInAt: new Date(), checkOutAt: null, save: jest.fn() });
    await service.returnFromLeave(teacher, onSite as any, req);
    expect(leave.departedAt).toBeUndefined();
    expect(leave.returnedAt).toBeInstanceOf(Date);
  });

  it('refuses without an approved leave today, a second return, and off site', async () => {
    await expect(build(null, null).service.returnFromLeave(teacher, onSite as any, req)).rejects.toThrow('لا يوجد استئذان معتمد');
    await expect(
      build({ ...approvedLeave(), returnedAt: new Date() }, null).service.returnFromLeave(teacher, onSite as any, req),
    ).rejects.toThrow('بالفعل');
    await expect(
      build(approvedLeave(), null).service.returnFromLeave(teacher, { lat: 21.5, lng: 39.2 } as any, req),
    ).rejects.toThrow('خارج نطاق المدرسة');
  });
});
