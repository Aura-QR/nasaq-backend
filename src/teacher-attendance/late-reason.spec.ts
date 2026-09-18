import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TeacherAttendanceService } from './teacher-attendance.service';

/**
 * Lateness, and the reason for it.
 *
 * A lateness figure on its own is an accusation the teacher cannot answer, and
 * a reason nobody reads is a form. So these cover the pairing: the director is
 * told, the teacher is asked, and the answer comes back to the same people —
 * plus the cases where getting it wrong is expensive, which are all the ones
 * where somebody is told something untrue about a colleague.
 */
describe('Teacher lateness and its reason', () => {
  const schoolId = '60d5ecb8b5c9c22b8c8b4561';
  const teacherId = '60d5ecb8b5c9c22b8c8b4562';
  const ownerId = '60d5ecb8b5c9c22b8c8b4570';
  const managerId = '60d5ecb8b5c9c22b8c8b4571';

  const settings = {
    teacherCheckInEnabled: true,
    location: { lat: 24.7136, lng: 46.6753 },
    checkInRadiusMeters: 150,
    schoolNetworkIps: [],
    timezone: 'Asia/Riyadh',
    workStartTime: '07:00',
  };

  const onSite = { lat: 24.7136, lng: 46.6753 };
  const request = { ip: '203.0.113.5', headers: {} };

  let attendanceModel: any;
  let teacherModel: any;
  let schoolModel: any;
  let leaveRequestModel: any;
  let adminModel: any;
  let notifications: any;
  let service: TeacherAttendanceService;

  /** Whoever the school reports a lateness to. */
  const adminsAre = (...ids: string[]) => {
    adminModel.find.mockReturnValue({
      select: () => ({
        setOptions: () => ({
          lean: () => ({ exec: async () => ids.map((_id) => ({ _id })) }),
        }),
      }),
    });
  };

  const noticesOfType = (type: string) =>
    notifications.notify.mock.calls
      .map((call: any[]) => call[0])
      .filter((notice: any) => notice.type === type);

  beforeEach(() => {
    attendanceModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      findById: jest.fn(),
    };

    teacherModel = {
      findById: jest.fn().mockReturnValue({
        setOptions: () => Promise.resolve({ _id: teacherId, name: 'أحمد سالم' }),
      }),
    };

    schoolModel = {
      findById: jest.fn().mockReturnValue({
        setOptions: () => ({ lean: async () => ({ settings }) }),
      }),
    };

    leaveRequestModel = {
      findOne: jest.fn().mockReturnValue({
        lean: () => ({ exec: async () => null }),
      }),
    };

    adminModel = { find: jest.fn() };
    adminsAre(ownerId, managerId);

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new TeacherAttendanceService(
      attendanceModel,
      teacherModel,
      schoolModel,
      leaveRequestModel,
      adminModel,
      notifications,
    );
  });

  /** A check-in that the school's clock makes `lateMinutes` late. */
  const checkInLateBy = (lateMinutes: number | null) => {
    attendanceModel.create.mockImplementation(async (doc: any) => ({
      ...doc,
      _id: 'att1',
      lateMinutes,
      checkInAt: doc.checkInAt,
    }));
    return service.checkIn(
      { userId: teacherId, schoolId },
      { lat: onSite.lat, lng: onSite.lng },
      request,
    );
  };

  it('tells every admin and asks the teacher, in one go', async () => {
    await checkInLateBy(20);

    const reported = noticesOfType('teacher_late');
    expect(reported.map((notice: any) => String(notice.recipientId)).sort()).toEqual(
      [ownerId, managerId].sort(),
    );
    expect(reported[0].title).toContain('أحمد سالم');
    expect(reported[0].body).toContain('20');

    const asked = noticesOfType('late_reason_required');
    expect(asked).toHaveLength(1);
    expect(String(asked[0].recipientId)).toBe(teacherId);
  });

  it('flags the check-in response so the dialog opens while the phone is still in hand', async () => {
    const response: any = await checkInLateBy(20);
    expect(response.data.lateReasonRequired).toBe(true);
  });

  it('says nothing at all when the teacher was on time', async () => {
    const response: any = await checkInLateBy(0);

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(response.data.lateReasonRequired).toBe(false);
  });

  it('says nothing when the school never configured a start time', async () => {
    // null is "unknown", not "zero minutes late". Announcing it would accuse a
    // teacher of a lateness the school has no way to measure.
    await checkInLateBy(null);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not tell the admin about the lateness they recorded themselves', async () => {
    attendanceModel.create.mockImplementation(async (doc: any) => ({
      ...doc,
      _id: 'att2',
      lateMinutes: 15,
    }));

    await service.createManual(
      { userId: ownerId, schoolId },
      { teacherId, date: '2026-09-17', checkInAt: '07:15' } as any,
    );

    const reported = noticesOfType('teacher_late');
    expect(reported.map((notice: any) => String(notice.recipientId))).toEqual([managerId]);

    // The teacher is still asked — it is their name on the record and they
    // have no other way to answer it.
    expect(noticesOfType('late_reason_required')).toHaveLength(1);
  });

  describe('submitting the reason', () => {
    const record = (overrides: any = {}) => {
      const doc: any = {
        _id: 'att1',
        teacherId,
        name: 'أحمد سالم',
        lateMinutes: 20,
        lateReason: null,
        lateReasonAt: null,
        date: new Date('2026-09-18T00:00:00.000Z'),
        ...overrides,
      };
      doc.save = jest.fn().mockResolvedValue(doc);
      attendanceModel.findOne.mockResolvedValue(doc);
      return doc;
    };

    it('carries the teacher’s own words to every admin', async () => {
      const doc = record();

      await service.submitLateReason(
        { userId: teacherId, schoolId },
        { reason: '  ازدحام مروري على طريق المدرسة  ' },
      );

      expect(doc.lateReason).toBe('ازدحام مروري على طريق المدرسة');
      expect(doc.lateReasonAt).toBeInstanceOf(Date);
      expect(doc.save).toHaveBeenCalled();

      const sent = noticesOfType('late_reason_submitted');
      expect(sent.map((notice: any) => String(notice.recipientId)).sort()).toEqual(
        [ownerId, managerId].sort(),
      );
      expect(sent[0].body).toContain('ازدحام مروري');
      expect(sent[0].data.lateMinutes).toBe(20);
    });

    it('refuses a second reason for the same day', async () => {
      // A reason the director has already read must not change underneath
      // them. A correction is a conversation, not an edit.
      record({ lateReason: 'نمت متأخرًا' });

      await expect(
        service.submitLateReason({ userId: teacherId, schoolId }, { reason: 'ازدحام' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(noticesOfType('late_reason_submitted')).toHaveLength(0);
    });

    it('refuses a reason for a day with no lateness on it', async () => {
      record({ lateMinutes: 0 });

      await expect(
        service.submitLateReason({ userId: teacherId, schoolId }, { reason: 'ازدحام' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a day the teacher has no record for', async () => {
      attendanceModel.findOne.mockResolvedValue(null);

      await expect(
        service.submitLateReason({ userId: teacherId, schoolId }, { reason: 'ازدحام' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('the question the client asks on open', () => {
    const todaysRecord = (row: any) =>
      attendanceModel.findOne.mockReturnValue({
        lean: () => ({ exec: async () => row }),
      });

    it('is pending while a lateness has no reason', async () => {
      todaysRecord({
        _id: 'att1',
        lateMinutes: 25,
        lateReason: null,
        checkInAt: new Date(),
      });

      const result: any = await service.pendingLateReason({ userId: teacherId, schoolId });

      expect(result.data.pending).toBe(true);
      expect(result.data.lateMinutes).toBe(25);
      expect(result.data.attendanceId).toBe('att1');
    });

    it('is not pending once the reason is in, so the dialog stops reappearing', async () => {
      // The query itself excludes answered records; this proves the caller is
      // given a usable "no" rather than an empty object it has to interpret.
      todaysRecord(null);

      const result: any = await service.pendingLateReason({ userId: teacherId, schoolId });

      expect(result.data.pending).toBe(false);
      expect(attendanceModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lateMinutes: { $gt: 0 }, lateReason: null }),
      );
    });
  });
});
