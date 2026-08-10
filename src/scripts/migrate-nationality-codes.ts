import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Student } from '../students/schemas/student.schema';
import { NATIONALITIES } from '../common/constants/nationalities.constant';

const MAPPINGS: Record<string, string> = {
  'سعودي': 'SA',
  'سعودى': 'SA',
  'saudi': 'SA',
  'saudi arabia': 'SA',
  'مصري': 'EG',
  'مصرى': 'EG',
  'egyptian': 'EG',
  'سوري': 'SY',
  'سورى': 'SY',
  'syrian': 'SY',
  'إماراتي': 'AE',
  'كويتي': 'KW',
  'قطري': 'QA',
  'بحريني': 'BH',
  'عماني': 'OM',
  'أردني': 'JO',
  'لبناني': 'LB',
  'عراقي': 'IQ',
  'يمني': 'YE',
  'سوداني': 'SD',
};

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const studentModel = app.get<Model<Student>>(getModelToken(Student.name));

  console.log('Starting migration for student nationality codes...');

  const students = await studentModel.find({}).setOptions({ skipTenantScope: true }).exec();
  let updatedCount = 0;
  let unmappedCount = 0;

  for (const student of students) {
    if (student.nationalityCode) continue;

    const raw = (student.nationality || '').trim().toLowerCase();
    const code = MAPPINGS[raw];

    if (code) {
      student.nationalityCode = code;
      await student.save();
      updatedCount++;
    } else {
      unmappedCount++;
      console.warn(`[Review Needed] Student ID ${student._id} has unmapped nationality: "${student.nationality}"`);
    }
  }

  console.log(`Migration completed. Mapped: ${updatedCount}, Unmapped (Needs Review): ${unmappedCount}`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error('Error during nationality code migration script:', err);
  process.exit(1);
});
