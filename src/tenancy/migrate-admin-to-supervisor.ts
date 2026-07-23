import * as mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Error: MONGODB_URI is not set in environment.');
  process.exit(1);
}

async function run() {
  console.log('Connecting to database...');
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  console.log('Updating role "ADMIN" -> "SUPERVISOR" in "admins" collection...');
  const adminResult = await db.collection('admins').updateMany(
    { role: 'ADMIN' },
    { $set: { role: 'SUPERVISOR' } }
  );
  console.log(`Updated ${adminResult.modifiedCount} admins.`);

  console.log('Updating role "ADMIN" -> "SUPERVISOR" in "permissions" collection...');
  const permissionResult = await db.collection('permissions').updateMany(
    { role: 'ADMIN' },
    { $set: { role: 'SUPERVISOR' } }
  );
  console.log(`Updated ${permissionResult.modifiedCount} permission templates.`);

  console.log('Migration completed successfully!');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
