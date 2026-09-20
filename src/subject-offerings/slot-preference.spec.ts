import { SubjectOfferingsService } from './subject-offerings.service';

/**
 * Where in the day a subject would rather sit.
 *
 * The generator has weighed this field since it was written, but nothing
 * could ever set it — no DTO, no screen — so every subject in every school
 * ran as 'any'. A timetable that puts art first and Arabic last is a correct
 * timetable and a useless one, and this is the field that fixes it.
 *
 * These cover the part that is easy to get wrong on the way in: a screen that
 * edits period counts and knows nothing about preferences must not wipe them.
 */
describe('Saving a teaching plan with slot preferences', () => {
  let model: any;
  let service: SubjectOfferingsService;

  const offeringId = '60d5ecb8b5c9c22b8c8b4001';
  const otherId = '60d5ecb8b5c9c22b8c8b4002';

  /** What bulkWrite was asked to $set on one offering. */
  const setFor = (id: string) => {
    const call = model.bulkWrite.mock.calls[0][0].find(
      (op: any) => String(op.updateOne.filter._id) === id,
    );
    return call?.updateOne?.update?.$set;
  };

  beforeEach(() => {
    model = {
      find: jest.fn().mockReturnValue({
        select: () => ({
          lean: () => ({
            exec: async () => [{ _id: offeringId }, { _id: otherId }],
          }),
        }),
      }),
      bulkWrite: jest.fn().mockResolvedValue({ matchedCount: 2, modifiedCount: 2 }),
    };

    service = new SubjectOfferingsService(model, {} as any, {} as any);
  });

  it('writes the preference the screen sent', async () => {
    await service.updatePlan({
      entries: [
        { subjectOfferingId: offeringId, periodsPerWeek: 6, slotPreference: 'early' },
      ],
    } as any);

    expect(setFor(offeringId)).toEqual({
      periodsPerWeek: 6,
      slotPreference: 'early',
    });
  });

  it('leaves an existing preference alone when none is sent', async () => {
    // The import screen and the older plan grid both send period counts only.
    // Writing a default here would reset every subject in the grade to 'any'
    // the first time somebody corrected a single number.
    await service.updatePlan({
      entries: [{ subjectOfferingId: offeringId, periodsPerWeek: 6 }],
    } as any);

    expect(setFor(offeringId)).toEqual({ periodsPerWeek: 6 });
    expect(setFor(offeringId)).not.toHaveProperty('slotPreference');
  });

  it('keeps each row’s preference to itself', async () => {
    await service.updatePlan({
      entries: [
        { subjectOfferingId: offeringId, periodsPerWeek: 6, slotPreference: 'early' },
        { subjectOfferingId: otherId, periodsPerWeek: 2, slotPreference: 'late' },
      ],
    } as any);

    expect(setFor(offeringId).slotPreference).toBe('early');
    expect(setFor(otherId).slotPreference).toBe('late');
  });

  it('can put a subject back to neutral', async () => {
    // 'any' is a real choice, not an absent one — undefined means "don't
    // touch", so clearing a preference has to be expressible.
    await service.updatePlan({
      entries: [
        { subjectOfferingId: offeringId, periodsPerWeek: 4, slotPreference: 'any' },
      ],
    } as any);

    expect(setFor(offeringId).slotPreference).toBe('any');
  });
});
