import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Preparation } from '../preparation/schemas/preparation.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { startOfWeek } from '../preparation/utils/week.util';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectModel(Preparation.name) private preparationModel: Model<Preparation>,
    @InjectModel(Lecture.name) private lectureModel: Model<Lecture>,
  ) {}
  //0 0 * * 5 test 
  @Cron('0 0 * * 5', {
    name: 'cleanup-preparations',
    timeZone: 'Africa/Cairo',
  })
  async handleWeeklyPreparationCleanup() {
    this.logger.log('Starting weekly preparation cleanup - Running every Friday at midnight');

    try {
      const allPreparations = await this.preparationModel.find({}).setOptions({ skipTenantScope: true }).exec();
      const preparations = allPreparations.filter(prep => {
        const lectureValue = prep.lecture;
        if (!lectureValue) return false;
        if (typeof lectureValue === 'string' && /^[a-fA-F0-9]{24}$/.test(lectureValue)) {
          return true;
        }
        if (Types.ObjectId.isValid(lectureValue as string) && String(lectureValue).length === 24) {
          return true;
        }
        return false;
      });

      this.logger.log(`Found ${preparations.length} preparations with valid ObjectId lecture (out of ${allPreparations.length} total)`);

      await this.preparationModel.populate(preparations, [
        {
          path: 'lecture',
          populate: [
            { path: 'classId', select: 'name academicYearId roomNumber gender' },
          ]
        },
        { path: 'subject' }
      ]);

      let cleanedCount = 0;
      let failedCount = 0;

      const lectureIds = [...new Set(
        preparations
          .map(prep => (prep.lecture as any)?._id)
          .filter(id => id)
      )];

      for (const lectureId of lectureIds) {
        try {
          await this.lectureModel.updateOne(
            { _id: lectureId },
            { $set: { preparation: [] } }
          ).setOptions({ skipTenantScope: true }).exec();
          this.logger.debug(`Emptied preparation array for lecture ${lectureId}`);
        } catch (error) {
          this.logger.error(`Failed to empty preparation array for lecture ${lectureId}: ${error.message}`);
        }
      }

      for (const preparation of preparations) {
        try {
          const lecture = preparation.lecture as any;
          const subject = preparation.subject as any;
          const classData = lecture?.classId;

          const lectureData = {
            _id: lecture?._id?.toString() || null,
            // Kept as an object, not an id string: this snapshot is the only
            // record of the class once the ref is gone, and the read path
            // (addUrlsToFiles) already flattens it back to an id for clients.
            classId: classData
              ? {
                  _id: classData._id?.toString() || null,
                  name: classData.name ?? null,
                  roomNumber: classData.roomNumber ?? null,
                  gender: classData.gender ?? null,
                  academicYearId: classData.academicYearId?.toString() || null,
                }
              : null,
            // Was `lecture?.subjectId`, a field the Lecture schema does not
            // have — so this snapshotted null on every single row.
            subjectOfferingId: lecture?.subjectOfferingId?.toString() || null,
            // Never captured before, which meant a preparation lost its term
            // the moment the cron ran.
            termId: lecture?.termId?.toString() || null,
            teacherId: lecture?.teacherId?.toString() || null,
            dayOfWeek: lecture?.dayOfWeek || null,
            slot: lecture?.slot ?? null,
            createdAt: lecture?.createdAt || null,
            updatedAt: lecture?.updatedAt || null,
            __v: lecture?.__v ?? null,
            preparation: lecture?.preparation?.map((p: any) => p.toString()) || [],
          };

          const subjectData = subject?.toObject ? subject.toObject() : subject;

          // academicYear / roomNumber / gender used to be $set here as well.
          // None of them exist on the Preparation schema, so mongoose stripped
          // all three from the update in strict mode and the cron silently
          // wrote nothing. They live in the class snapshot above instead.
          await this.preparationModel.updateOne(
            { _id: preparation._id },
            {
              $set: {
                lecture: lectureData,
                subject: subjectData,
                // Backfill the denormalised filter fields for rows created
                // before they existed; the lecture is still populated here,
                // which is the last moment we can read them.
                ...(preparation.classId
                  ? {}
                  : { classId: classData?._id || null }),
                ...(preparation.termId
                  ? {}
                  : { termId: lecture?.termId || null }),
                // Rows predating weekOf get the week of their upload. That is
                // the submission time, not the lesson time, so flag it as a
                // guess rather than let it pass for a recorded week.
                ...(preparation.weekOf
                  ? {}
                  : {
                      weekOf: startOfWeek(
                        (preparation as any).createdAt || new Date(),
                      ),
                      isWeekEstimated: true,
                    }),
              }
            }
          ).setOptions({ skipTenantScope: true }).exec();

          cleanedCount++;
          this.logger.debug(`Cleaned preparation ${preparation._id}: replaced with data objects`);
        } catch (error) {
          failedCount++;
          this.logger.error(`Failed to cleanup preparation ${preparation._id}: ${error.message}`, error.stack);
        }
      }

      this.logger.log(
        `Weekly preparation cleanup completed. Success: ${cleanedCount}, Failed: ${failedCount}`
      );
    } catch (error) {
      this.logger.error('Error during weekly preparation cleanup', error.stack);
    }
  }
}
