import { Types } from 'mongoose';
import { SubjectOfferingsService } from './subject-offerings.service';

/**
 * A subject's assessment type set per grade, from the teaching plan.
 *
 * The ministry fixes it per grade, not per subject: لغتي is continuous in
 * grade 1 and has a final exam later. The offering could already carry an
 * override and the register already read it, but no screen could set it — the
 * only place was the subject itself, which applies to every grade at once.
 */
describe('Saving a grade’s assessment type from the teaching plan', () => {
  const term1 = new Types.ObjectId();
  const term2 = new Types.ObjectId();
  const term3 = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const subjectId = new Types.ObjectId();
  const gradeId = new Types.ObjectId();
  const offeringId = new Types.ObjectId();

  let model: any;
  let terms: any;
  let service: SubjectOfferingsService;

  const chain = (value: any) => ({
    select: () => ({ lean: () => ({ exec: async () => value }) }),
  });

  const setFor = () => model.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;

  beforeEach(() => {
    model = {
      find: jest.fn().mockImplementation(() => ({
        select: (fields: string) => ({
          lean: () => ({
            exec: async () =>
              fields === '_id'
                ? [{ _id: offeringId }]
                : [
                    {
                      _id: offeringId,
                      subjectId,
                      gradeLevelId: gradeId,
                      termId: term1,
                      assessmentType: 'continuous',
                    },
                  ],
          }),
        }),
      })),
      bulkWrite: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      updateMany: jest.fn().mockReturnValue({ exec: async () => ({ modifiedCount: 2 }) }),
    };
    terms = {
      findById: jest.fn().mockReturnValue(chain({ academicYearId: yearId })),
      find: jest.fn().mockReturnValue(chain([{ _id: term1 }, { _id: term2 }, { _id: term3 }])),
    };
    service = new SubjectOfferingsService(model, terms, {} as any);
  });

  it('writes the type and copies it to the same grade in the year’s other terms', async () => {
    const result: any = await service.updatePlan({
      entries: [
        { subjectOfferingId: String(offeringId), periodsPerWeek: 5, assessmentType: 'continuous' },
      ],
    } as any);

    expect(setFor()).toEqual({ periodsPerWeek: 5, assessmentType: 'continuous' });
    expect(terms.find).toHaveBeenCalledWith({ academicYearId: yearId });

    const [filter, update] = model.updateMany.mock.calls[0];
    expect(filter).toEqual({
      _id: { $ne: offeringId },
      subjectId,
      gradeLevelId: gradeId,
      termId: { $in: [term1, term2, term3] },
    });
    expect(update).toEqual({ $set: { assessmentType: 'continuous' } });
    expect(result.otherTermsUpdated).toBe(2);
  });

  it('can send a grade back to the subject’s own type', async () => {
    await service.updatePlan({
      entries: [{ subjectOfferingId: String(offeringId), periodsPerWeek: 5, assessmentType: null }],
    } as any);

    expect(setFor()).toEqual({ periodsPerWeek: 5, assessmentType: null });
  });

  it('leaves the type and the other terms alone when the screen did not send it', async () => {
    // Saving a period count must not quietly reset what term two was set to.
    const result: any = await service.updatePlan({
      entries: [{ subjectOfferingId: String(offeringId), periodsPerWeek: 5 }],
    } as any);

    expect(setFor()).toEqual({ periodsPerWeek: 5 });
    expect(model.updateMany).not.toHaveBeenCalled();
    expect(result.otherTermsUpdated).toBe(0);
  });
});
