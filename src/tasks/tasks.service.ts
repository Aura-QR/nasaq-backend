import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Preparation } from '../preparation/schemas/preparation.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';

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
            { path: 'classId', select: 'academicYear roomNumber gender' },
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
            classId: classData?._id?.toString() || null,
            subjectId: lecture?.subjectId?.toString() || null,
            teacherId: lecture?.teacherId?.toString() || null,
            dayOfWeek: lecture?.dayOfWeek || null,
            slot: lecture?.slot ?? null,
            createdAt: lecture?.createdAt || null,
            updatedAt: lecture?.updatedAt || null,
            __v: lecture?.__v ?? null,
            preparation: lecture?.preparation?.map((p: any) => p.toString()) || [],
          };

          const subjectData = subject?.toObject ? subject.toObject() : subject;

          await this.preparationModel.updateOne(
            { _id: preparation._id },
            {
              $set: {
                lecture: lectureData,
                subject: subjectData,
                academicYear: classData?.academicYear || null,
                roomNumber: classData?.roomNumber || null,
                gender: classData?.gender || null,
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
