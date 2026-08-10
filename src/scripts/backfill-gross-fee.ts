import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { StudentFinancialRecord } from '../financial/schemas/student-financial-record.schema';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const recordModel = app.get<Model<StudentFinancialRecord>>(
    getModelToken(StudentFinancialRecord.name),
  );

  console.log('Starting backfill for grossFee on StudentFinancialRecords...');

  const records = await recordModel.find({}).setOptions({ skipTenantScope: true }).exec();
  let count = 0;

  for (const record of records) {
    if (record.tuition && (record.tuition.grossFee === undefined || record.tuition.grossFee === null || record.tuition.grossFee === 0)) {
      const baseFee = record.tuition.fee || 0;
      const surchargeAmount = record.tuition.surcharge?.amount || 0;
      record.tuition.grossFee = baseFee + surchargeAmount;
      record.markModified('tuition');
      await record.save();
      count++;
    }
  }

  console.log(`Backfill completed. Updated ${count} records.`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error during grossFee backfill script:', err);
  process.exit(1);
});
