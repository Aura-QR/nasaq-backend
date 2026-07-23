import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcrypt';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Error: MONGODB_URI is not set in environment.');
  process.exit(1);
}

const SUPER_ADMIN_EMAIL = 'qraura0@gmail.com';
const SUPER_ADMIN_PASSWORD = 'Aura#2026';
const SUPER_ADMIN_NAME = 'Super Admin';

async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  console.log(`Seeding Super Admin (${SUPER_ADMIN_EMAIL})...`);

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);

  const existing = await db.collection('platformadmins').findOne({ email: SUPER_ADMIN_EMAIL.toLowerCase() });

  if (existing) {
    await db.collection('platformadmins').updateOne(
      { _id: existing._id },
      {
        $set: {
          name: SUPER_ADMIN_NAME,
          password: hashedPassword,
          role: 'SUPER_ADMIN',
          isActive: true,
          updatedAt: new Date(),
        },
      }
    );
    console.log(`Successfully updated existing Super Admin (${SUPER_ADMIN_EMAIL}) with specified credentials.`);
  } else {
    await db.collection('platformadmins').insertOne({
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL.toLowerCase(),
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Successfully created Super Admin (${SUPER_ADMIN_EMAIL}).`);
  }

  await mongoose.disconnect();
  console.log('Done!');
}

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
