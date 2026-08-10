import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Enrollment } from '../enrollments/schemas/enrollment.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const enrollmentModel = app.get<Model<Enrollment>>(getModelToken(Enrollment.name));

  console.log('Searching for active enrollments with no matching financial record (orphaned enrollments)...');

  const orphans = await enrollmentModel.aggregate([
    {
      $lookup: {
        from: 'studentFinancialRecords',
        let: { s: '$studentId', y: '$academicYearId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$studentId', '$$s'] },
                  { $eq: ['$academicYearId', '$$y'] },
                ],
              },
            },
          },
        ],
        as: 'fin',
      },
    },
    { $match: { fin: { $size: 0 }, status: 'active' } },
  ]);

  console.log(`Found ${orphans.length} orphaned enrollment(s).`);

  if (orphans.length > 0) {
    const orphanIds = orphans.map((o) => o._id);
    const deleteResult = await enrollmentModel.deleteMany({ _id: { $in: orphanIds } }).exec();
    console.log(`Deleted ${deleteResult.deletedCount} orphaned enrollment(s). Affected students are now re-enrollable.`);
  }

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error during orphaned enrollments cleanup script:', err);
  process.exit(1);
});
