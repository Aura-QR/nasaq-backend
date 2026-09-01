/**
 * Repairs preparations whose lecture reference was replaced with an all-null
 * snapshot.
 *
 * The weekly cleanup cron runs on a timer, so it has no tenant context, and
 * tenantScopedPlugin answers an absent context by scoping queries to
 * `schoolId: null`. Its populate therefore matched nothing and resolved to
 * null for every row, and the snapshot it wrote was
 *
 *     { _id: null, classId: null, subjectOfferingId: null, termId: null, ... }
 *
 * on top of a perfectly good ObjectId. GET /preparation has been returning
 * those nulls ever since.
 *
 * The link survives, though. The same bug that broke the snapshot also
 * emptied the list of lecture ids the cron uses to clear `Lecture.preparation`
 * — so those arrays were never cleared, and each damaged preparation can be
 * found by looking for the lecture that still lists it.
 *
 * Idempotent. Reports what it cannot repair rather than guessing.
 *
 *   npm run repair:preparation-lectures -- --dry-run
 *   npm run repair:preparation-lectures
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';

config();

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const preparations = db.collection('preparations');
  const lectures = db.collection('lectures');

  /*
   * A damaged row: `lecture` is an embedded object whose _id is null.
   *
   * The `$type: 'object'` half is not decoration. On a document where
   * `lecture` is still a plain ObjectId, the path `lecture._id` is missing —
   * and a missing path matches `null` in Mongo. Without the type guard this
   * query returns every healthy, un-archived preparation in the database, and
   * the repair would either rewrite them needlessly or report them all as
   * unrecoverable.
   */
  const damaged = await preparations
    .find({ 'lecture._id': null, lecture: { $type: 'object' } })
    .toArray();

  console.log(`damaged preparations: ${damaged.length}`);
  if (damaged.length === 0) {
    console.log('\n── nothing to repair ──');
    await mongoose.disconnect();
    return;
  }

  let repaired = 0;
  const unrecoverable: string[] = [];

  for (const preparation of damaged) {
    // The lecture that still lists this preparation is the one it belonged to.
    const owner = await lectures.findOne({ preparation: preparation._id });

    if (!owner) {
      unrecoverable.push(String(preparation._id));
      continue;
    }

    const set: any = {
      lecture: owner._id,
      classId: owner.classId ?? null,
      termId: owner.termId ?? null,
    };

    // `subject` was flattened to null by the same populate. The lecture knows
    // which offering it is.
    if (!preparation.subject || typeof preparation.subject === 'object') {
      set.subject = owner.subjectOfferingId ?? null;
    }

    if (!DRY_RUN) {
      await preparations.updateOne({ _id: preparation._id }, { $set: set });
    }
    repaired++;
  }

  console.log(
    [
      '',
      DRY_RUN ? '── DRY RUN, nothing written ──' : '── repair complete ──',
      `repaired:      ${repaired}`,
      `unrecoverable: ${unrecoverable.length}`,
    ].join('\n'),
  );

  if (unrecoverable.length > 0) {
    console.log(
      '\n  No lecture lists these preparations, so the link cannot be inferred.',
    );
    console.log('  They need reattaching by hand, or deleting:\n');
    unrecoverable.slice(0, 30).forEach((id) => console.log(`     ${id}`));
    if (unrecoverable.length > 30) {
      console.log(`     … and ${unrecoverable.length - 30} more`);
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
