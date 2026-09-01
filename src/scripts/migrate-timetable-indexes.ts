/**
 * Two index repairs that ship with the timetable work.
 *
 * ── 1. lectures: the teacher-conflict index never existed ──────────────────
 *
 * The schema declared it as
 *
 *   partialFilterExpression: { teacherId: { $ne: null } }
 *
 * and Mongo rejects `$ne` in a partial index ("Expression not supported in
 * partial index: $not"). The index was therefore never created, and nothing
 * at the database level stopped a teacher being booked into two classes in
 * the same slot — only the check inside LecturesService.create(), which
 * insertMany and copy-from do not go through.
 *
 * The fix is `$type: 'objectId'`, which excludes the null "needs a teacher"
 * state the same way the original intended. Existing duplicates would make
 * the unique index fail to build, so they are reported and nothing is dropped
 * automatically — a real double-booking is a scheduling decision, not a data
 * error a script should silently resolve.
 *
 * ── 2. teacherassignments: uniqueness must include classId ─────────────────
 *
 * The old key (schoolId, teacherId, subjectOfferingId) made it impossible to
 * pin one teacher to two sections of the same grade — the case `classId`
 * exists for. Mongoose creates new indexes on boot but never drops ones that
 * left the schema, so the old key has to go explicitly.
 *
 * Idempotent.
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-timetable-indexes.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/scripts/migrate-timetable-indexes.ts
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';

config();

const DRY_RUN = process.argv.includes('--dry-run');

const LECTURE_TEACHER_INDEX = 'schoolId_1_teacherId_1_dayOfWeek_1_slot_1_termId_1';
const ASSIGNMENT_OLD = 'schoolId_1_teacherId_1_subjectOfferingId_1';
const ASSIGNMENT_NEW = 'schoolId_1_teacherId_1_subjectOfferingId_1_classId_1';

/**
 * A collection that has never been written to does not exist yet, and asking
 * it for its indexes throws NamespaceNotFound rather than returning nothing.
 * On a fresh environment that turns a dry run into a stack trace and looks
 * like a broken migration.
 */
async function indexNames(collection: any): Promise<string[]> {
  try {
    return (await collection.indexes()).map((index: any) => index.name);
  } catch (error: any) {
    if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) {
      return [];
    }
    throw error;
  }
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // ---------------------------------------------------------------- lectures
  console.log('── lectures ──');
  const lectures = db.collection('lectures');
  const lectureIndexes = await indexNames(lectures);

  const duplicates = await lectures
    .aggregate([
      { $match: { teacherId: { $type: 'objectId' } } },
      {
        $group: {
          _id: {
            schoolId: '$schoolId',
            teacherId: '$teacherId',
            dayOfWeek: '$dayOfWeek',
            slot: '$slot',
            termId: '$termId',
          },
          count: { $sum: 1 },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  if (duplicates.length > 0) {
    console.log(
      `\n  ⚠️  ${duplicates.length} teacher double-bookings already exist. The unique`,
    );
    console.log('     index cannot be built until these are resolved by hand:\n');
    for (const dup of duplicates.slice(0, 20)) {
      console.log(
        `     teacher ${dup._id.teacherId} — ${dup._id.dayOfWeek} slot ${dup._id.slot}` +
          ` — ${dup.count} lectures: ${dup.ids.join(', ')}`,
      );
    }
    if (duplicates.length > 20) {
      console.log(`     … and ${duplicates.length - 20} more`);
    }
    console.log('\n     Delete or reschedule one of each pair, then run this again.');
  } else if (lectureIndexes.includes(LECTURE_TEACHER_INDEX)) {
    console.log(`  = ${LECTURE_TEACHER_INDEX} already present`);
  } else {
    if (!DRY_RUN) {
      await lectures.createIndex(
        { schoolId: 1, teacherId: 1, dayOfWeek: 1, slot: 1, termId: 1 },
        {
          unique: true,
          partialFilterExpression: { teacherId: { $type: 'objectId' } },
          name: LECTURE_TEACHER_INDEX,
        },
      );
    }
    console.log(`  + create ${LECTURE_TEACHER_INDEX} (no conflicts found)`);
  }

  // --------------------------------------------------- teacher assignments
  console.log('\n── teacherassignments ──');
  const assignments = db.collection('teacherassignments');
  const assignmentIndexes = await indexNames(assignments);

  // Create the wider key before dropping the old one: removing the guard
  // first would leave duplicates writable in between.
  if (!assignmentIndexes.includes(ASSIGNMENT_NEW)) {
    if (!DRY_RUN) {
      await assignments.createIndex(
        { schoolId: 1, teacherId: 1, subjectOfferingId: 1, classId: 1 },
        { unique: true, name: ASSIGNMENT_NEW },
      );
    }
    console.log(`  + create ${ASSIGNMENT_NEW}`);
  } else {
    console.log(`  = ${ASSIGNMENT_NEW} already present`);
  }

  if (assignmentIndexes.includes(ASSIGNMENT_OLD)) {
    if (!DRY_RUN) await assignments.dropIndex(ASSIGNMENT_OLD);
    console.log(`  - drop   ${ASSIGNMENT_OLD}`);
  } else {
    console.log(`  = ${ASSIGNMENT_OLD} already gone`);
  }

  const missing = await assignments.countDocuments({ classId: { $exists: false } });
  if (missing > 0 && !DRY_RUN) {
    await assignments.updateMany(
      { classId: { $exists: false } },
      { $set: { classId: null } },
    );
  }
  console.log(`  rows given an explicit classId: null: ${missing}`);

  console.log(
    DRY_RUN ? '\n── DRY RUN, nothing written ──' : '\n── migration complete ──',
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
