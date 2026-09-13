import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as mongoose from 'mongoose';
import { TripService } from './trip.service';

/**
 * Deleting a student's trip must not erase money.
 *
 * Every payment and refund lives inside the trip's installments, so a delete
 * takes the record of the money with it. The only guard was in the mobile app,
 * and it read `paidAmount` off the trip — a field the record does not have —
 * so it saw zero every time and let a paid trip be deleted.
 *
 * No database: `delete` only reads one record and saves it, so a stub model
 * pins the rule without the shared-collection flakiness of the DB suites.
 */
describe('TripService.delete', () => {
  const studentId = new mongoose.Types.ObjectId().toString();
  const tripId = new mongoose.Types.ObjectId().toString();

  const setup = (installments: any[]) => {
    const record: any = {
      trips: [{ _id: { toString: () => tripId }, installments }],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const recordModel: any = {
      findOne: () => ({ sort: () => ({ exec: async () => record }) }),
    };
    const service = new TripService(recordModel, {} as any, {} as any);
    return { service, record };
  };

  it('refuses while any money is held on the trip, and saves nothing', async () => {
    const { service, record } = setup([
      { installmentNumber: 1, amount: 300, paidAmount: 300 },
      { installmentNumber: 2, amount: 300, paidAmount: 0 },
    ]);
    await expect(service.delete(studentId, tripId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(record.trips).toHaveLength(1);
    expect(record.save).not.toHaveBeenCalled();
  });

  it('refuses a partial payment too', async () => {
    const { service } = setup([{ installmentNumber: 1, amount: 300, paidAmount: 50 }]);
    await expect(service.delete(studentId, tripId)).rejects.toThrow('استرجع المبلغ');
  });

  it('allows it once everything has been refunded', async () => {
    // A full refund brings every installment back to zero paid.
    const { service, record } = setup([
      { installmentNumber: 1, amount: 300, paidAmount: 0 },
    ]);
    await service.delete(studentId, tripId);
    expect(record.trips).toHaveLength(0);
    expect(record.save).toHaveBeenCalledTimes(1);
  });

  it('allows a trip nobody has paid for', async () => {
    const { service, record } = setup([]);
    await service.delete(studentId, tripId);
    expect(record.trips).toHaveLength(0);
  });

  it('still 404s a trip that is not on the record', async () => {
    const { service } = setup([]);
    await expect(
      service.delete(studentId, new mongoose.Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
