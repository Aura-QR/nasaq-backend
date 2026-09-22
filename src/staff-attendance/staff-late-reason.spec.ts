import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';

/**
 * A supervisor's account of their own lateness.
 *
 * The teacher side has had this since the lateness queue was built. A
 * supervisor was late in exactly the same way and had nowhere to say why: the
 * office saw a number of minutes and the person saw nothing at all, which is
 * an accusation with no reply.
 *
 * Everything below is one of three obligations — it is written once, it is
 * ruled on by somebody else, and both sides are told.
 */
describe('Explaining a staff lateness', () => {
  const staffId = '60d5ecb8b5c9c22b8c8b4001';
  const managerId = '60d5ecb8b5c9c22b8c8b4100';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';

  let record: any;
  let records: any;
  let notifications: any;
  let service: StaffAttendanceService;

  const supervisor = { userId: staffId, schoolId, role: 'SUPERVISOR', name: 'أ. بشاير' };
  const manager = { userId: managerId, schoolId, role: 'MANAGER', name: 'أ. هدى' };

  beforeEach(() => {
    record = {
      _id: 'att1',
      staffId,
      name: 'أ. بشاير',
      role: 'SUPERVISOR',
      date: new Date('2026-09-22T00:00:00.000Z'),
      lateMinutes: 18,
      lateReason: null,
      lateReasonStatus: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    records = {
      findOne: jest.fn().mockResolvedValue(record),
      countDocuments: jest.fn().mockReturnValue({ exec: async () => 0 }),
      find: jest.fn().mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({ lean: () => ({ exec: async () => [] }) }),
          }),
        }),
      }),
    };

    const admins = {
      find: jest.fn().mockReturnValue({
        select: () => ({
          setOptions: () => ({
            lean: () => ({ exec: async () => [{ _id: managerId }] }),
          }),
        }),
      }),
    };

    const schools = {
      findById: jest.fn().mockReturnValue({
        setOptions: () => ({
          lean: async () => ({ settings: { timezone: 'Asia/Riyadh' } }),
        }),
      }),
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new StaffAttendanceService(
      records as any, admins as any, schools as any, {} as any, notifications,
    );
  });

  const submit = (reason = 'ازدحام مروري على الطريق') =>
    service.submitLateReason(supervisor, { reason, date: '2026-09-22' } as any);

  describe('writing it', () => {
    it('saves the reason and starts it waiting on the school', async () => {
      // 'pending' from the moment it is written, so it lands in the review
      // list rather than in a field nobody rules on.
      await submit();
      expect(record.lateReason).toBe('ازدحام مروري على الطريق');
      expect(record.lateReasonStatus).toBe('pending');
      expect(record.lateReasonAt).toBeInstanceOf(Date);
    });

    it('tells the people who decide', async () => {
      await submit();
      const notice = notifications.notify.mock.calls[0][0];
      expect(notice.recipientId).toBe(managerId);
      expect(notice.type).toBe('staff_late_reason_submitted');
      expect(notice.data.staffId).toBe(staffId);
    });

    it('refuses a second account of the same day', async () => {
      // Two accounts of one lateness is a rewrite of history, and the second
      // would arrive after the first was already ruled on.
      record.lateReason = 'سبب سابق';
      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a day with no lateness on it', async () => {
      record.lateMinutes = 0;
      await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a day with no record at all', async () => {
      records.findOne.mockResolvedValue(null);
      await expect(submit()).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is saved even when nobody can be notified', async () => {
      // The explanation is the thing being written. Failing the request would
      // tell somebody their reason was not recorded when it was.
      notifications.notify.mockRejectedValue(new Error('offline'));
      await expect(submit()).resolves.toMatchObject({ status: true });
      expect(record.lateReason).toBe('ازدحام مروري على الطريق');
    });
  });

  describe('ruling on it', () => {
    beforeEach(() => {
      record.lateReason = 'ازدحام مروري';
      record.lateReasonStatus = 'pending';
    });

    const review = (dto: any, user = manager) =>
      service.reviewLateReason(user, '60d5ecb8b5c9c22b8c8b4444', dto);

    it('records the verdict and who gave it', async () => {
      await review({ verdict: 'accepted' });
      expect(record.lateReasonStatus).toBe('accepted');
      expect(record.lateReasonReviewedByName).toBe('أ. هدى');
      expect(record.lateReasonReviewedAt).toBeInstanceOf(Date);
    });

    it('tells the person either way', async () => {
      await review({ verdict: 'accepted' });
      const notice = notifications.notify.mock.calls[0][0];
      expect(notice.recipientId).toBe(staffId);
      expect(notice.type).toBe('staff_late_reason_reviewed');
    });

    it('will not refuse an explanation without saying why', async () => {
      // A refusal with no note leaves a mark on somebody's record and nothing
      // for them to answer.
      await expect(review({ verdict: 'rejected' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(record.lateReasonStatus).toBe('pending');
    });

    it('accepts a refusal that explains itself', async () => {
      await review({ verdict: 'rejected', note: 'التأخير متكرر هذا الشهر' });
      expect(record.lateReasonStatus).toBe('rejected');
      expect(record.lateReasonReviewNote).toBe('التأخير متكرر هذا الشهر');
    });

    it('will not let somebody rule on their own lateness', async () => {
      // The same rule that stops anyone editing their own attendance record.
      await expect(
        review({ verdict: 'accepted' }, { ...supervisor, role: 'SUPERVISOR' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a second ruling', async () => {
      record.lateReasonStatus = 'accepted';
      await expect(review({ verdict: 'rejected', note: 'x' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to rule on a lateness nobody explained', async () => {
      record.lateReason = null;
      await expect(review({ verdict: 'accepted' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('the review queue', () => {
    const filterOf = () => records.find.mock.calls.at(-1)[0];

    it('defaults to what is waiting on a decision', async () => {
      await service.listLateReasons(manager, {} as any);
      expect(filterOf().lateReasonStatus).toBe('pending');
      expect(filterOf().lateReason).toEqual({ $ne: null });
    });

    it('can find the latenesses nobody explained', async () => {
      // The fourth state, and the reason the filter exists: these match none
      // of the three verdicts, so without it the rows that need a nudge are
      // exactly the ones no list can show.
      await service.listLateReasons(manager, { status: 'missing' } as any);
      expect(filterOf().lateReason).toBeNull();
      expect(filterOf().lateReasonStatus).toBeUndefined();
    });

    it('never returns a day with no lateness on it', async () => {
      await service.listLateReasons(manager, { status: 'accepted' } as any);
      expect(filterOf().lateMinutes).toEqual({ $gt: 0 });
    });
  });
});
