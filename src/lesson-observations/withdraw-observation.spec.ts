import { ConflictException, NotFoundException } from '@nestjs/common';
import { LessonObservationsService } from './lesson-observations.service';

/**
 * Taking back a record that should not have been written.
 *
 * A round is walked on a phone in a corridor and the wrong room gets tapped.
 * Overwriting to 'present' does not fix that — it leaves a visit nobody made,
 * because there is no status meaning "this never happened". So the record has
 * to be removable, and removing it has two obligations: it must not erase a
 * conversation the teacher has already joined, and the teacher who was told
 * about it must be told it is gone.
 */
describe('Withdrawing an observation', () => {
  const teacherId = '60d5ecb8b5c9c22b8c8b4001';
  const adminId = '60d5ecb8b5c9c22b8c8b4100';
  const schoolId = '60d5ecb8b5c9c22b8c8b4200';
  const lectureId = '60d5ecb8b5c9c22b8c8b4300';

  let row: any;
  let deleted: any[];
  let observationModel: any;
  let notifications: any;
  let service: LessonObservationsService;

  const supervisor = { userId: adminId, schoolId, name: 'أ. هدى' };

  beforeEach(() => {
    row = {
      _id: 'obs1',
      lectureId,
      teacherId,
      className: 'رابع/بنات',
      slot: 4,
      date: new Date('2026-09-20T00:00:00.000Z'),
      status: 'absent',
      reason: null,
    };

    deleted = [];

    observationModel = {
      findById: jest.fn().mockImplementation(() => ({
        lean: () => ({ exec: async () => row }),
      })),
      deleteOne: jest.fn().mockImplementation((filter: any) => ({
        exec: async () => {
          deleted.push(filter);
          return { deletedCount: 1 };
        },
      })),
    };

    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    service = new LessonObservationsService(
      observationModel, {} as any, {} as any, {} as any, {} as any, {} as any,
      notifications,
    );
  });

  it('removes the record', async () => {
    await service.withdraw('obs1', supervisor);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]._id).toBe('obs1');
  });

  it('tells the teacher it is gone', async () => {
    // They were notified of an absence. Leaving that notice pointing at
    // nothing is worse than the original mistake: they open it, find no
    // record, and cannot tell whether it was withdrawn or they misread it.
    await service.withdraw('obs1', supervisor);

    const notice = notifications.notify.mock.calls[0][0];
    expect(notice.recipientId).toBe(teacherId);
    expect(notice.type).toBe('lesson_observation_withdrawn');
    expect(notice.body).toContain('رابع/بنات');
  });

  it('says nothing when there was nothing to say', async () => {
    // 'present' is a tick on a round sheet and was never announced. A notice
    // withdrawing a notice the teacher never got is pure noise.
    row.status = 'present';
    await service.withdraw('obs1', supervisor);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('refuses once the teacher has answered it', async () => {
    // The record is half of a conversation by then, and deleting it deletes
    // their side of it. The same freeze `record` enforces.
    row.reason = 'كنت في اجتماع مع ولي أمر';
    await expect(service.withdraw('obs1', supervisor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(deleted).toHaveLength(0);
  });

  it('refuses an id that is not there', async () => {
    observationModel.findById.mockImplementation(() => ({
      lean: () => ({ exec: async () => null }),
    }));
    await expect(service.withdraw('nope', supervisor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still deletes when the teacher cannot be notified', async () => {
    // The record is already gone by then. Failing the request would report a
    // deletion that happened as a deletion that did not.
    notifications.notify.mockRejectedValue(new Error('offline'));
    await expect(service.withdraw('obs1', supervisor)).resolves.toMatchObject({
      status: true,
    });
    expect(deleted).toHaveLength(1);
  });

  it('leaves a lecture with no teacher alone rather than notifying nobody', async () => {
    row.teacherId = null;
    await service.withdraw('obs1', supervisor);
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(deleted).toHaveLength(1);
  });
});
