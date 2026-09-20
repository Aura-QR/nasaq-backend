import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TeacherAttendanceService } from './teacher-attendance.service';

/**
 * The school's ruling on a teacher's account of a lateness.
 *
 * The explanation already existed; nothing answered it. A director saw "20
 * minutes" on a screen and the reason sat one field away that no page
 * displayed and no decision attached to — so the teacher wrote into a void
 * and, reasonably, stopped writing.
 */
describe('Ruling on a lateness', () => {
  const teacherId = '60d5ecb8b5c9c22b8c8b4001';
  const adminId = '60d5ecb8b5c9c22b8c8b4100';

  let record: any;
  let model: any;
  let notifications: any;
  let service: TeacherAttendanceService;

  const manager = { userId: adminId, schoolId: '60d5ecb8b5c9c22b8c8b4200', name: 'أ. هدى' };

  const build = () =>
    new TeacherAttendanceService(
      model, {} as any, {} as any, {} as any, {} as any, notifications,
    );

  beforeEach(() => {
    record = {
      _id: 'att1',
      teacherId,
      name: 'أ. سارة',
      date: new Date('2026-09-18T00:00:00.000Z'),
      lateMinutes: 20,
      lateReason: 'ازدحام مروري',
      lateReasonStatus: 'pending',
      lateReasonReviewNote: '',
      save: jest.fn().mockResolvedValue(undefined),
    };

    model = { findById: jest.fn().mockResolvedValue(record) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    service = build();
  });

  const review = (dto: any) => service.reviewLateReason('att1', manager, dto);

  it('records who ruled and when, not just the verdict', async () => {
    // A disputed decision with no author is not a decision, it is a rumour.
    await review({ verdict: 'accepted' });

    expect(record.lateReasonStatus).toBe('accepted');
    expect(record.lateReasonReviewedByName).toBe('أ. هدى');
    expect(record.lateReasonReviewedAt).toBeInstanceOf(Date);
  });

  it('tells the teacher the verdict', async () => {
    // A teacher who explained and heard nothing does not know the matter is
    // closed, and stops explaining the next one.
    await review({ verdict: 'accepted' });

    const notice = notifications.notify.mock.calls[0][0];
    expect(String(notice.recipientId)).toBe(teacherId);
    expect(notice.type).toBe('late_reason_reviewed');
    expect(notice.title).toContain('قبول');
    expect(notice.body).toContain('2026-09-18');
  });

  it('will not refuse without saying why', async () => {
    // Refusing leaves a mark on the record; refusing silently leaves nothing
    // to answer.
    await expect(review({ verdict: 'rejected' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(record.lateReasonStatus).toBe('pending');
    expect(record.save).not.toHaveBeenCalled();
  });

  it('passes a refusal’s reason on to the teacher', async () => {
    await review({ verdict: 'rejected', note: 'التأخير متكرر هذا الأسبوع' });
    expect(notifications.notify.mock.calls[0][0].body).toContain(
      'التأخير متكرر هذا الأسبوع',
    );
  });

  it('cannot be ruled on twice', async () => {
    await review({ verdict: 'accepted' });
    await expect(
      review({ verdict: 'rejected', note: 'تغيّر رأيي' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a record with no explanation on it', async () => {
    record.lateReason = null;
    record.lateReasonStatus = null;
    await expect(review({ verdict: 'accepted' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a record that does not exist', async () => {
    model.findById.mockResolvedValue(null);
    await expect(review({ verdict: 'accepted' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps the ruling when the teacher cannot be notified', async () => {
    // Undoing a decision because a push failed would make the director rule
    // twice on the same day and see two different answers.
    notifications.notify.mockRejectedValue(new Error('down'));
    await expect(review({ verdict: 'accepted' })).resolves.toBeDefined();
    expect(record.lateReasonStatus).toBe('accepted');
  });
});
