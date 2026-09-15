import { ConflictException, NotFoundException } from '@nestjs/common';
import * as mongoose from 'mongoose';
import { TripService } from './trip.service';

/**
 * DELETE /financial/trips/:tripTemplateId did not exist, so the delete button
 * on the phone answered "Cannot DELETE". A trip may go while nobody is in it;
 * with students enrolled it holds their fees and payments and is refused.
 *
 * No database: the rule is one lookup, one count and one save.
 */
describe('TripService.removeTemplate', () => {
  const templateId = new mongoose.Types.ObjectId().toString();

  const setup = ({ enrolled = 0, isActive = true, exists = true } = {}) => {
    const template: any = exists
      ? { _id: templateId, name: 'رحلة الرياض', isActive, save: jest.fn().mockResolvedValue(undefined) }
      : null;
    const tripTemplateModel: any = { findById: () => ({ exec: async () => template }) };
    const recordModel: any = { countDocuments: jest.fn().mockResolvedValue(enrolled) };
    const service = new TripService(recordModel, tripTemplateModel, {} as any);
    return { service, template, recordModel };
  };

  it('archives a trip nobody is enrolled in', async () => {
    const { service, template } = setup();
    await expect(service.removeTemplate(templateId)).resolves.toMatchObject({ message: 'تم حذف الرحلة بنجاح' });
    expect(template.isActive).toBe(false);
    expect(template.save).toHaveBeenCalledTimes(1);
  });

  it('refuses a trip with students, naming how many, and changes nothing', async () => {
    const { service, template } = setup({ enrolled: 5 });
    const attempt = service.removeTemplate(templateId);
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(service.removeTemplate(templateId)).rejects.toThrow('5 من الطلاب');
    expect(template.isActive).toBe(true);
    expect(template.save).not.toHaveBeenCalled();
  });

  it('counts enrolment by the template id', async () => {
    const { service, recordModel } = setup();
    await service.removeTemplate(templateId);
    const [query] = recordModel.countDocuments.mock.calls[0];
    expect(String(query.trips.$elemMatch.tripTemplateId)).toBe(templateId);
  });

  it('404s a trip that does not exist or was already deleted', async () => {
    await expect(setup({ exists: false }).service.removeTemplate(templateId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ isActive: false }).service.removeTemplate(templateId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * Removing a student from a trip's page spliced their trip out with its
 * payments, while deleting the same trip from the student's record refused
 * while money was held. Both now follow the one rule.
 */
describe('TripService.removeStudent', () => {
  const templateId = new mongoose.Types.ObjectId().toString();
  const studentId = new mongoose.Types.ObjectId().toString();

  const setup = (installments: any[]) => {
    const record: any = {
      trips: [{ tripTemplateId: { toString: () => templateId }, installments }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const recordModel: any = { findOne: () => ({ sort: () => ({ exec: async () => record }) }) };
    return { service: new TripService(recordModel, {} as any, {} as any), record };
  };

  it('refuses while the student has paid anything toward the trip', async () => {
    const { service, record } = setup([{ installmentNumber: 1, amount: 300, paidAmount: 120 }]);
    await expect(service.removeStudent(templateId, studentId)).rejects.toThrow('استرجع المبلغ');
    expect(record.trips).toHaveLength(1);
    expect(record.save).not.toHaveBeenCalled();
  });

  it('removes a student who has paid nothing, or was refunded in full', async () => {
    const { service, record } = setup([{ installmentNumber: 1, amount: 300, paidAmount: 0 }]);
    await expect(service.removeStudent(templateId, studentId)).resolves.toMatchObject({ message: 'تم إزالة الطالب من الرحلة بنجاح' });
    expect(record.trips).toHaveLength(0);
    expect(record.save).toHaveBeenCalledTimes(1);
  });
});
