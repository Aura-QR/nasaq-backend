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

      /*
       * skipTenantScope on every populate, not just on the find above.
       *
       * This job runs on a timer, so there is no request and no tenant
       * context — and tenantScopedPlugin answers an absent context by scoping
       * the query to `schoolId: null`. Without this option the populate
       * matched nothing and resolved to null for every single row, and the
       * snapshot written below was therefore all-null. That is not a
       * hypothetical: it silently replaced every preparation's lecture
       * reference with `{ _id: null, classId: null, ... }` every Friday.
       */
      await this.preparationModel.populate(preparations, [
        {
          path: 'lecture',
          options: { skipTenantScope: true },
          populate: [
            {
              path: 'classId',
              select: 'name academicYearId roomNumber gender',
              options: { skipTenantScope: true },
            },
          ],
        },
        { path: 'subject', options: { skipTenantScope: true } },
      ]);

      let cleanedCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

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

          /*
           * If the lecture did not resolve, leave the row alone.
           *
           * Archiving is meant to freeze what the lecture WAS. Writing a
           * snapshot of nothing does the opposite: it throws away the id that
           * was still there, and with it the only way back to the lecture. A
           * dangling reference can be investigated and repaired; an all-null
           * snapshot cannot.
           */
          if (!lecture || !lecture._id) {
            skippedCount++;
            this.logger.warn(
              `Preparation ${preparation._id} left as-is: its lecture did not resolve.`,
            );
            continue;
          }

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
        `Weekly preparation cleanup completed. Success: ${cleanedCount}, ` +
          `Skipped (lecture unresolved): ${skippedCount}, Failed: ${failedCount}`
      );
    } catch (error) {
      this.logger.error('Error during weekly preparation cleanup', error.stack);
    }
  }
}
