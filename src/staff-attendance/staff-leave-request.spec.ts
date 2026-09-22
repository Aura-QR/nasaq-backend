import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffAttendanceService } from './staff-attendance.service';

/**
 * A supervisor asking to leave before the end of the day (استئذان).
 *
 * Its own collection rather than the teacher one with a different person on
 * it, because the two requests are not the same thing: a teacher's leave is
 * first of all a cover problem — who takes the fourth period — and a
 * supervisor has no lectures at all. What both share is the part that decides
 * a monthly report: an approved request is what stops a sanctioned departure
 * being recorded as leaving early.
 */
describe('Staff leave requests', () => {
  const staffId = '60d5ecb8b5c9c22b8c8b4001';
  const otherStaff = '60d5ecb8b5c9c22b8c8b4002';
  const managerId = '60d5ecb8b5c9c22b8c8b4100';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';
  const requestId = '60d5ecb8b5c9c22b8c8b4444';

  let existing: any;
  let saved: any;
  let deleted: any[];
  let leaves: any;
  let notifications: any;
  let service: StaffAttendanceService;

  const supervisor = { userId: staffId, schoolId, role: 'SUPERVISOR', name: 'أ. بشاير' };
  const manager = { userId: managerId, schoolId, role: 'MANAGER', name: 'أ. هدى' };

  beforeEach(() => {
    existing = null;
    saved = null;
    deleted = [];

    // `new this.leaves({...})` and `this.leaves.findOne(...)` on one object.
    const model: any = function (this: any, doc: any) {
      Object.assign(this, doc, {
        _id: 'leave1',
        save: jest.fn().mockImplementation(async () => {
          saved = this;
          return this;
        }),
      });
    };
    model.findOne = jest.fn().mockImplementation(async () => existing);
    model.deleteOne = jest.fn().mockImplementation((filter: any) => ({
      exec: async () => {
        deleted.push(filter);
        return { deletedCount: 1 };
      },
    }));
    model.find = jest.fn().mockReturnValue({
      sort: () => ({ lean: () => ({ exec: async () => [] }) }),
    });
    leaves = model;

    const admins = {
      findOne: jest.fn().mockReturnValue({
        select: () => ({
          lean: async () => ({
            _id: staffId,
            username: 'أ. بشاير',
            role: 'SUPERVISOR',
          }),
        }),
      }),
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
      {} as any, admins as any, schools as any, leaves, notifications,
    );
  });

  const file = (dto: any = {}, user = supervisor) =>
    service.createLeave(user, {
      date: '2026-09-22',
      leaveAt: '11:30',
      reason: 'موعد طبي',
      ...dto,
    } as any);

  describe('filing one', () => {
    it('records the day, the time and the reason', async () => {
      await file();
      expect(saved.leaveAt).toBe('11:30');
      expect(saved.reason).toBe('موعد طبي');
      expect(saved.status).toBe('pending');
      expect(saved.staffName).toBe('أ. بشاير');
    });

    it('tells the people who decide', async () => {
      // Otherwise it waits in a list nobody opened, and somebody who asked at
      // eight in the morning is still waiting at noon.
      await file();
      const notice = notifications.notify.mock.calls[0][0];
      expect(notice.recipientId).toBe(managerId);
      expect(notice.type).toBe('staff_leave_requested');
    });

    it('edits the first request rather than adding a second', async () => {
      // A day has one answer. Two open asks make "is this person excused
      // today?" unanswerable.
      existing = {
        _id: 'leave1',
        status: 'pending',
        leaveAt: '10:00',
        reason: 'قديم',
        save: jest.fn().mockResolvedValue(undefined),
      };

      const result = await file({ leaveAt: '12:15', reason: 'موعد جديد' });

      expect(existing.leaveAt).toBe('12:15');
      expect(existing.reason).toBe('موعد جديد');
      expect(result.message).toBe('تم تحديث طلب الاستئذان');
    });

    it('will not quietly reopen a day already decided', async () => {
      existing = { _id: 'leave1', status: 'approved', save: jest.fn() };
      await expect(file()).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets a manager file on behalf of somebody', async () => {
      // How somebody phoning in at seven in the morning gets recorded at all.
      await expect(file({ staffId: otherStaff }, manager)).resolves.toMatchObject({
        status: true,
      });
    });

    it('does not let a supervisor file for anybody else', async () => {
      await expect(file({ staffId: otherStaff })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('is saved even when nobody can be notified', async () => {
      notifications.notify.mockRejectedValue(new Error('offline'));
      await expect(file()).resolves.toMatchObject({ status: true });
      expect(saved.status).toBe('pending');
    });
  });

  describe('deciding on one', () => {
    beforeEach(() => {
      existing = {
        _id: 'leave1',
        staffId,
        date: new Date('2026-09-22T00:00:00.000Z'),
        leaveAt: '11:30',
        status: 'pending',
        save: jest.fn().mockResolvedValue(undefined),
      };
    });

    const review = (dto: any, user = manager) =>
      service.reviewLeave(user, requestId, dto);

    it('records the decision and who took it', async () => {
      await review({ status: 'approved' });
      expect(existing.status).toBe('approved');
      expect(existing.reviewedByName).toBe('أ. هدى');
      expect(existing.reviewedAt).toBeInstanceOf(Date);
    });

    it('tells the person either way', async () => {
      await review({ status: 'approved' });
      const notice = notifications.notify.mock.calls[0][0];
      expect(notice.recipientId).toBe(staffId);
      expect(notice.type).toBe('staff_leave_approved');
    });

    it('will not refuse without saying why', async () => {
      // A refusal with no reason leaves somebody with a decision they cannot
      // plan around.
      await expect(review({ status: 'rejected' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(existing.status).toBe('pending');
    });

    it('will not let somebody approve their own leave', async () => {
      await expect(
        review({ status: 'approved' }, supervisor),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a second decision', async () => {
      existing.status = 'rejected';
      await expect(review({ status: 'approved' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses an id that is not there', async () => {
      existing = null;
      await expect(review({ status: 'approved' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('withdrawing one', () => {
    beforeEach(() => {
      existing = { _id: 'leave1', staffId, status: 'pending' };
    });

    it('removes a request nobody has decided yet', async () => {
      await service.cancelLeave(supervisor, requestId);
      expect(deleted).toHaveLength(1);
    });

    it('will not remove one already decided', async () => {
      // The day may already have been arranged around it, and deleting it
      // silently leaves the office believing something it no longer sees.
      existing.status = 'approved';
      await expect(
        service.cancelLeave(supervisor, requestId),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(deleted).toHaveLength(0);
    });

    it('does not let a supervisor withdraw somebody else’s', async () => {
      existing.staffId = otherStaff;
      await expect(
        service.cancelLeave(supervisor, requestId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a manager withdraw one they are handling', async () => {
      existing.staffId = otherStaff;
      await expect(
        service.cancelLeave(manager, requestId),
      ).resolves.toMatchObject({ status: true });
    });
  });

  describe('who sees what', () => {
    const filterOf = () => leaves.find.mock.calls.at(-1)[0];

    it('shows a supervisor only their own, whatever they ask for', async () => {
      await service.listLeaves(supervisor, { staffId: otherStaff } as any);
      expect(String(filterOf().staffId)).toBe(staffId);
    });

    it('lets a manager narrow to one person', async () => {
      await service.listLeaves(manager, { staffId: otherStaff } as any);
      expect(String(filterOf().staffId)).toBe(otherStaff);
    });

    it('lets a manager see the whole school', async () => {
      await service.listLeaves(manager, {} as any);
      expect(filterOf().staffId).toBeUndefined();
    });
  });
});
