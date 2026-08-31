/**
 * Widens the teacher-assignment uniqueness key to include `classId`.
 *
 * The old key was (schoolId, teacherId, subjectOfferingId), which made it
 * impossible to pin one teacher to two sections of the same grade — the exact
 * case `classId` exists to express. Mongoose creates new indexes on boot but
 * never drops ones that disappeared from the schema, so the old index has to
 * be removed explicitly or it keeps rejecting the writes.
 *
 * Also writes `classId: null` onto existing rows. Not strictly required — a
 * missing field indexes as null either way — but it keeps reads uniform, so a
 * client never has to distinguish "absent" from "explicitly the whole grade".
 *
 * Idempotent.
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-assignment-class-index.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-assignment-class-index.ts --dry-run
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';

config();

const DRY_RUN = process.argv.includes('--dry-run');
const OLD_INDEX = 'schoolId_1_teacherId_1_subjectOfferingId_1';
const NEW_INDEX = 'schoolId_1_teacherId_1_subjectOfferingId_1_classId_1';

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  const collection = mongoose.connection.db.collection('teacherassignments');

  const indexes = await collection.indexes();
  const names = indexes.map((i: any) => i.name);
  console.log('indexes before:', names.join(', '));

  // Create the wider one first: dropping the old key before a replacement
  // exists would leave duplicates writable in between.
  if (!names.includes(NEW_INDEX)) {
    if (!DRY_RUN) {
      await collection.createIndex(
        { schoolId: 1, teacherId: 1, subjectOfferingId: 1, classId: 1 },
        { unique: true, name: NEW_INDEX },
      );
    }
    console.log(`+ create ${NEW_INDEX}`);
  } else {
    console.log(`= ${NEW_INDEX} already present`);
  }

  if (names.includes(OLD_INDEX)) {
    if (!DRY_RUN) {
      await collection.dropIndex(OLD_INDEX);
    }
    console.log(`- drop   ${OLD_INDEX}`);
  } else {
    console.log(`= ${OLD_INDEX} already gone`);
  }

  const missing = await collection.countDocuments({
    classId: { $exists: false },
  });
  if (missing > 0 && !DRY_RUN) {
    await collection.updateMany(
      { classId: { $exists: false } },
      { $set: { classId: null } },
    );
  }
  console.log(`  rows given an explicit classId: null: ${missing}`);

  if (!DRY_RUN) {
    console.log(
      'indexes after:',
      (await collection.indexes()).map((i: any) => i.name).join(', '),
    );
  }

  console.log(DRY_RUN ? '\n── DRY RUN, nothing written ──' : '\n── migration complete ──');
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
