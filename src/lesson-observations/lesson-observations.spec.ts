import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { LessonObservationsService } from './lesson-observations.service';

/**
 * What a supervisor saw when they looked into a classroom.
 *
 * This is the period, not the day — a teacher can clock in at 06:50 and still
 * reach the fourth lesson ten minutes late — and it is an account of somebody
 * written without them, so three things have to hold: it lands on the right
 * day, it cannot be written twice, and it freezes once the teacher has
 * answered it.
 */
describe('Observing a lesson', () => {
  const teacherId = '60d5ecb8b5c9c22b8c8b4001';
  const otherTeacher = '60d5ecb8b5c9c22b8c8b4009';
  const adminId = '60d5ecb8b5c9c22b8c8b4100';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';
  const lectureId = '60d5ecb8b5c9c22b8c8b4300';

  // 2026-09-20 is a Sunday.
  const SUNDAY = '2026-09-20';
  const MONDAY = '2026-09-21';

  let lecture: any;
  let saved: any;
  let observationModel: any;
  let lectureModel: any;
  let notifications: any;
  let service: LessonObservationsService;

  const supervisor = { userId: adminId, schoolId, name: 'أ. هدى' };

  beforeEach(() => {
    lecture = {
      _id: lectureId,
      slot: 4,
      dayOfWeek: 'sunday',
      classId: { name: 'رابع/بنات' },
      teacherId: { _id: teacherId, name: 'أ. سارة' },
      subjectOfferingId: { subjectId: { subjectName: 'الرياضيات' } },
    };

    saved = null;

    observationModel = {
      findOne: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockImplementation((_filter: any, payload: any) => ({
        exec: async () => {
          saved = { ...payload, _id: 'obs1' };
          return saved;
        },
      })),
    };

    const chain = (value: any) => ({
      populate: () => chain(value),
      lean: () => ({ exec: async () => value }),
      exec: async () => value,
    });

    lectureModel = { findById: jest.fn().mockImplementation(() => chain(lecture)) };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new LessonObservationsService(
      observationModel, lectureModel, {} as any, {} as any, {} as any,
      { find: () => ({ select: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => [{ _id: adminId }] }) }) }) }) } as any,
      notifications,
    );
  });

  const record = (dto: any) =>
    service.record({ lectureId, date: SUNDAY, ...dto }, supervisor);

  describe('recording it', () => {
    it('keeps the class, subject and period on the record itself', async () => {
      // A timetable gets rebuilt and the lecture disappears; a log that reads
      // "— was late to —" afterwards is not evidence of anything.
      await record({ status: 'late', lateMinutes: 10 });

      expect(saved.className).toBe('رابع/بنات');
      expect(saved.subjectName).toBe('الرياضيات');
      expect(saved.teacherName).toBe('أ. سارة');
      expect(saved.slot).toBe(4);
    });

    it('refuses a day the lesson is not taught on', async () => {
      // A typo in the date would otherwise file Sunday's absence against
      // Monday, against a teacher who was never due in that room.
      await expect(record({ status: 'absent', date: MONDAY })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('records the clock time of the round, not the time it was typed', async () => {
      // "We passed at 11:15" is the fact the teacher accepts or disputes.
      await record({ status: 'absent', observedAt: '11:15' });
      expect(new Date(saved.observedAt).toISOString()).toBe('2026-09-20T11:15:00.000Z');
    });

    it('upserts on the lesson and the day, so two supervisors make one row', async () => {
      await record({ status: 'late', lateMinutes: 5 });
      const filter = observationModel.findOneAndUpdate.mock.calls[0][0];
      expect(String(filter.lectureId)).toBe(lectureId);
      expect(filter.date).toBeInstanceOf(Date);
    });

    it('drops a minute count on a status that has no minutes', async () => {
      await record({ status: 'absent', lateMinutes: 10 });
      expect(saved.lateMinutes).toBeNull();
    });

    it('will not overwrite an observation the teacher has answered', async () => {
      // Changing the accusation under a reply leaves an answer to a question
      // nobody asked.
      observationModel.findOne.mockResolvedValue({ reason: 'كنت في اجتماع' });
      await expect(record({ status: 'absent' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('who hears about it', () => {
    it('tells the teacher they were marked late', async () => {
      await record({ status: 'late', lateMinutes: 10 });

      const notice = notifications.notify.mock.calls[0][0];
      expect(String(notice.recipientId)).toBe(teacherId);
      expect(notice.type).toBe('lesson_observation_recorded');
      expect(notice.body).toContain('رابع/بنات');
      expect(notice.data.observationId).toBe('obs1');
    });

    it('says nothing when the lesson was running normally', async () => {
      // A round sheet tick is not news. Telling a teacher they were seen
      // teaching is how a useful notice becomes noise.
      await record({ status: 'present' });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('still records it when the notice cannot be sent', async () => {
      notifications.notify.mockRejectedValue(new Error('down'));
      await expect(record({ status: 'absent' })).resolves.toBeDefined();
      expect(saved.status).toBe('absent');
    });
  });

  describe('the teacher answering', () => {
    let row: any;

    beforeEach(() => {
      row = {
        _id: 'obs1',
        teacherId,
        teacherName: 'أ. سارة',
        className: 'رابع/بنات',
        slot: 4,
        date: new Date('2026-09-20T00:00:00.000Z'),
        status: 'late',
        reason: null,
        reasonStatus: null,
        save: jest.fn().mockResolvedValue(undefined),
      };
      observationModel.findById.mockResolvedValue(row);
    });

    const explain = (user: any = { userId: teacherId, schoolId }) =>
      service.explain('obs1', user, { reason: 'اجتماع مع ولي أمر' } as any);

    it('refuses an observation about somebody else', async () => {
      await expect(
        explain({ userId: otherTeacher, schoolId }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(row.save).not.toHaveBeenCalled();
    });

    it('stores the answer and puts it in front of the school', async () => {
      await explain();
      expect(row.reason).toBe('اجتماع مع ولي أمر');
      expect(row.reasonStatus).toBe('pending');

      const notice = notifications.notify.mock.calls[0][0];
      expect(String(notice.recipientId)).toBe(adminId);
      expect(notice.type).toBe('lesson_observation_explained');
    });

    it('cannot be answered twice', async () => {
      await explain();
      await expect(explain()).rejects.toBeInstanceOf(ConflictException);
    });

    it('has nothing to answer on a lesson that ran normally', async () => {
      row.status = 'present';
      await expect(explain()).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('the ruling', () => {
    let row: any;

    beforeEach(() => {
      row = {
        _id: 'obs1',
        teacherId,
        className: 'رابع/بنات',
        slot: 4,
        date: new Date('2026-09-20T00:00:00.000Z'),
        status: 'late',
        reason: 'اجتماع مع ولي أمر',
        reasonStatus: 'pending',
        save: jest.fn().mockResolvedValue(undefined),
      };
      observationModel.findById.mockResolvedValue(row);
      notifications.notify.mockClear();
    });

    it('will not refuse without saying why', async () => {
      // A refusal leaves a mark on a record; a silent one leaves the teacher
      // nothing to answer.
      await expect(
        service.review('obs1', supervisor, { verdict: 'rejected' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(row.reasonStatus).toBe('pending');
    });

    it('accepts, names who ruled, and tells the teacher', async () => {
      await service.review('obs1', supervisor, { verdict: 'accepted' } as any);

      expect(row.reasonStatus).toBe('accepted');
      expect(row.reasonReviewedByName).toBe('أ. هدى');

      const notice = notifications.notify.mock.calls[0][0];
      expect(String(notice.recipientId)).toBe(teacherId);
      expect(notice.type).toBe('lesson_observation_reviewed');
    });

    it('cannot be ruled on twice', async () => {
      await service.review('obs1', supervisor, { verdict: 'accepted' } as any);
      await expect(
        service.review('obs1', supervisor, { verdict: 'rejected', note: 'x' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
