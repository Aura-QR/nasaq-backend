/**
 * Backfills the fields `GET /preparation` now filters on, for rows written
 * before they existed.
 *
 *   weekOf     — from the lecture if it is still linked, else from createdAt
 *   classId    — off the lecture (live ref or cron snapshot)
 *   termId     — same
 *
 * `createdAt` is the *upload* time, not the lesson time: a teacher who filed a
 * whole week on Saturday night stamps every one of them with that Saturday.
 * Rows guessed that way are marked `isWeekEstimated: true` so a manager can
 * tell a recorded week from an inferred one.
 *
 * Idempotent — only touches documents that are still missing a value.
 *
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-preparation-week.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-preparation-week.ts --dry-run
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';
import { startOfWeek } from '../preparation/utils/week.util';

config();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const preparations = db.collection('preparations');
  const lectures = db.collection('lectures');

  const cursor = preparations.find({
    $or: [
      { weekOf: { $in: [null, undefined] } },
      { classId: { $in: [null, undefined] } },
      { termId: { $in: [null, undefined] } },
    ],
  });

  let scanned = 0;
  let updated = 0;
  let estimated = 0;
  let fromLecture = 0;

  while (await cursor.hasNext()) {
    const prep: any = await cursor.next();
    scanned++;

    const set: any = {};

    // The lecture is either a live ObjectId ref or a snapshot object left by
    // the Friday cron. Both carry the ids we need.
    let lectureDoc: any = null;
    const lectureValue = prep.lecture;

    if (lectureValue && typeof lectureValue === 'object' && !(lectureValue instanceof mongoose.Types.ObjectId)) {
      lectureDoc = lectureValue;
    } else if (lectureValue) {
      lectureDoc = await lectures.findOne({ _id: new mongoose.Types.ObjectId(String(lectureValue)) });
    }

    const asId = (value: any) => {
      if (!value) return null;
      const raw = typeof value === 'object' && value._id ? value._id : value;
      const str = String(raw);
      return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
    };

    if (!prep.classId) {
      const classId = asId(lectureDoc?.classId);
      if (classId) set.classId = classId;
    }
    if (!prep.termId) {
      const termId = asId(lectureDoc?.termId);
      if (termId) set.termId = termId;
    }

    if (!prep.weekOf) {
      set.weekOf = startOfWeek(prep.createdAt || new Date());
      set.isWeekEstimated = true;
      estimated++;
    }
    if (lectureDoc) fromLecture++;

    if (Object.keys(set).length === 0) continue;

    if (!DRY_RUN) {
      await preparations.updateOne({ _id: prep._id }, { $set: set });
    }
    updated++;
  }

  console.log(
    [
      DRY_RUN ? '── DRY RUN, nothing written ──' : '── backfill complete ──',
      `scanned:        ${scanned}`,
      `updated:        ${updated}`,
      `week estimated: ${estimated}  (from createdAt — flagged isWeekEstimated)`,
      `lecture found:  ${fromLecture}  (class/term recovered)`,
    ].join('\n'),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
