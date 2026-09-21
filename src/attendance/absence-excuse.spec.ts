import { ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

/**
 * The family's answer to an absence, and the school's verdict on it.
 *
 * The notice asks why. Before this there was nowhere to reply, so the question
 * was decoration — and a form that collects nothing teaches people to ignore
 * the next one. Three things have to hold: only the right family can answer,
 * the answer cannot be rewritten after a manager has acted on it, and the
 * verdict travels back.
 */
describe('Explaining an absence', () => {
  const studentId = '60d5ecb8b5c9c22b8c8b4001';
  const otherStudent = '60d5ecb8b5c9c22b8c8b4009';
  const adminId = '60d5ecb8b5c9c22b8c8b4100';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';

  let record: any;
  let attendanceModel: any;
  let studentModel: any;
  let adminModel: any;
  let notifications: any;
  let service: AttendanceService;

  const family = { userId: studentId, schoolId };
  const manager = { userId: adminId, schoolId, name: 'أ. هدى' };

  beforeEach(() => {
    record = {
      _id: 'abs1',
      studentId,
      date: new Date('2026-09-18T00:00:00.000Z'),
      excuse: null,
      excuseAt: null,
      excuseAttachment: null,
      excuseStatus: null,
      excuseReviewNote: '',
      save: jest.fn().mockResolvedValue(undefined),
    };

    attendanceModel = { findById: jest.fn().mockResolvedValue(record) };
    studentModel = {
      findById: jest.fn().mockReturnValue({
        select: () => ({ lean: () => ({ exec: async () => ({ name: 'سارة خالد' }) }) }),
      }),
    };
    adminModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({
          setOptions: () => ({ lean: () => ({ exec: async () => [{ _id: adminId }] }) }),
        }),
      }),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new AttendanceService(
      attendanceModel, studentModel, {} as any, {} as any, {} as any,
      adminModel, notifications,
    );
  });

  const submit = (user = family, dto: any = { attendanceId: 'abs1', reason: 'وعكة صحية' }) =>
    service.submitExcuse(user, dto);

  describe('who may answer', () => {
    it('refuses a record that belongs to another child', async () => {
      // Without this any signed-in family could explain away someone else's
      // absence, and the register would quietly stop meaning anything.
      await expect(submit({ userId: otherStudent, schoolId }))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(record.save).not.toHaveBeenCalled();
    });
  });

  describe('the answer', () => {
    it('is stored with its timestamp and marked as waiting', async () => {
      await submit();
      expect(record.excuse).toBe('وعكة صحية');
      expect(record.excuseAt).toBeInstanceOf(Date);
      expect(record.excuseStatus).toBe('pending');
    });

    it('keeps the medical note when one is attached, and null when not', async () => {
      await submit(family, {
        attendanceId: 'abs1', reason: 'حمى', attachment: '/uploads/absence-excuses/a.pdf',
      });
      expect(record.excuseAttachment).toBe('/uploads/absence-excuses/a.pdf');

      record.excuse = null;
      record.excuseAttachment = null;
      await submit();
      expect(record.excuseAttachment).toBeNull();
    });

    it('cannot be sent twice', async () => {
      // An explanation a manager has already read and acted on must not be
      // rewritten underneath them. A correction is a conversation, not an edit.
      await submit();
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
    });

    it('reaches the school, naming the child and the day', async () => {
      await submit();
      const notice = notifications.notify.mock.calls[0][0];
      expect(String(notice.recipientId)).toBe(adminId);
      expect(notice.type).toBe('absence_excuse_submitted');
      expect(notice.title).toContain('سارة خالد');
      expect(notice.body).toContain('2026-09-18');
      expect(notice.body).toContain('وعكة صحية');
    });

    it('is still saved when the school cannot be notified', async () => {
      // Telling a family to write it again because a push failed is how you
      // teach them to stop writing.
      notifications.notify.mockRejectedValue(new Error('down'));
      await expect(submit()).resolves.toBeDefined();
      expect(record.excuse).toBe('وعكة صحية');
    });
  });

  describe('the school’s verdict', () => {
    beforeEach(async () => {
      await submit();
      notifications.notify.mockClear();
    });

    it('accepts, and tells the family', async () => {
      await service.reviewExcuse('abs1', manager, { verdict: 'accepted' } as any);
      expect(record.excuseStatus).toBe('accepted');
      expect(record.excuseReviewedByName).toBe('أ. هدى');

      const notice = notifications.notify.mock.calls[0][0];
      expect(String(notice.recipientId)).toBe(studentId);
      expect(notice.type).toBe('absence_excuse_reviewed');
      expect(notice.title).toContain('قبول');
    });

    it('will not refuse without saying why', async () => {
      // A rejection with no reason is the school declining to explain itself,
      // which is how a form becomes a grievance.
      await expect(
        service.reviewExcuse('abs1', manager, { verdict: 'rejected' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(record.excuseStatus).toBe('pending');
    });

    it('passes the refusal’s reason on to the family', async () => {
      await service.reviewExcuse('abs1', manager, {
        verdict: 'rejected', note: 'التقرير لا يغطي هذا اليوم',
      } as any);
      expect(notifications.notify.mock.calls[0][0].body)
        .toContain('التقرير لا يغطي هذا اليوم');
    });

    it('cannot be given twice', async () => {
      await service.reviewExcuse('abs1', manager, { verdict: 'accepted' } as any);
      await expect(
        service.reviewExcuse('abs1', manager, { verdict: 'rejected', note: 'x' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a record with no excuse on it', async () => {
      record.excuse = null;
      record.excuseStatus = null;
      await expect(
        service.reviewExcuse('abs1', manager, { verdict: 'accepted' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

/**
 * The absence nobody answered.
 *
 * The three states a manager sees are all states of an excuse — and an
 * absence with no excuse has none of them. Filtering on a field that was
 * never written returns nothing, so until this existed those absences were
 * outside every screen the school had: recorded, unexplained, and invisible
 * to the person whose job is to notice.
 */
describe('Listing absences nobody explained', () => {
  let attendanceModel: any;
  let service: AttendanceService;
  let lastQuery: any;

  beforeEach(() => {
    lastQuery = null;

    attendanceModel = {
      countDocuments: jest.fn().mockImplementation((query: any) => {
        lastQuery = query;
        return { exec: async () => 0 };
      }),
      find: jest.fn().mockReturnValue({
        populate: () => ({
          populate: () => ({
            sort: () => ({
              skip: () => ({
                limit: () => ({ lean: () => ({ exec: async () => [] }) }),
              }),
            }),
          }),
        }),
      }),
    };

    service = new AttendanceService(
      attendanceModel, {} as any, {} as any, {} as any, {} as any, {} as any,
      { notify: jest.fn() } as any,
    );
  });

  it('asks for records with no excuse on them', async () => {
    await service.listExcuses({ status: 'missing' } as any, {} as any);

    expect(lastQuery.excuse).toBeNull();
    // Not "pending with no excuse", which matches nothing at all.
    expect(lastQuery.excuseStatus).toBeUndefined();
  });

  it('still requires an excuse for the other three states', async () => {
    for (const status of ['pending', 'accepted', 'rejected']) {
      await service.listExcuses({ status } as any, {} as any);
      expect(lastQuery.excuse).toEqual({ $ne: null });
      expect(lastQuery.excuseStatus).toBe(status);
    }
  });

  it('opens on what is waiting when nothing is asked for', async () => {
    // The queue exists to be emptied.
    await service.listExcuses({} as any, {} as any);
    expect(lastQuery.excuseStatus).toBe('pending');
  });
});
