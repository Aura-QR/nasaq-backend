/**
 * Repairs financial records whose installments no longer add up to what the
 * student owes.
 *
 * Until the fix alongside this script, every recalculation — re-saving fee
 * criteria, changing a student's nationality or class, applying or removing a
 * discount — set each unsettled installment's amount to its share of the
 * remaining balance, and dropped what had already been paid on a partly paid
 * one. The case that surfaced it: 90,000 over three installments, the second
 * partly paid, became 30,000 / 25,000 / 25,000; the student paid all three,
 * the page showed "paid in full", and 10,000 was owed with no installment to
 * take it.
 *
 * Each section (tuition; bus if enrolled; every trip) is run through the same
 * `rebalanceSection` the application now uses, so this is not a second copy of
 * the rule. A section that is already consistent is left exactly as it is.
 * Nothing that was paid is changed: amounts are raised or an installment is
 * added for what is still owed, and totals and status are recomputed.
 *
 * Idempotent, and each write only lands if the record has not been updated
 * since it was read.
 *
 *   node dist/scripts/repair-installment-totals.js --dry-run
 *   node dist/scripts/repair-installment-totals.js
 *
 * Reshaping named records (--reshape --records id,id,...):
 *
 * The first run of this script used a version of the rule that shared the
 * stranded amount across a student's open installments on top of what was
 * paid, piling it onto the partly paid first installment — right totals, the
 * wrong schedule (15,000 over three with 3,000 paid became 7,000 / 4,000 /
 * 4,000 instead of 5,000 / 5,000 / 5,000). Those records already add up, so a
 * normal run leaves them alone, correctly. `--reshape` forces the corrected
 * rule on the records named, and only those: it refuses to run without an
 * explicit list, because reshaping every consistent schedule in the database
 * is not a repair.
 *
 *   node dist/scripts/repair-installment-totals.js --reshape --records <id>,<id> --dry-run
 *   node dist/scripts/repair-installment-totals.js --reshape --records <id>,<id>
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';
import { FinancialRecordService } from '../financial/financial-record.service';

config();

type SectionChange = {
  path: string;
  label: string;
  before: SectionSnapshot;
  after: SectionSnapshot;
  section: any;
};

type SectionSnapshot = {
  netFee: number;
  totalPaid: number;
  status: string;
  installments: string;
};

const service: FinancialRecordService = Object.create(FinancialRecordService.prototype);

const snapshot = (service: FinancialRecordService, section: any): SectionSnapshot => ({
  netFee: service.effectiveNetFee(section),
  totalPaid: Number(section?.totalPaid) || 0,
  status: String(section?.status ?? ''),
  installments: (section?.installments ?? [])
    .map((i: any) => `#${i.installmentNumber}:${i.amount}/${i.paidAmount ?? 0}:${i.status}`)
    .join(' '),
});

/** The sections of one record that would change, with before and after. */
export function planRepair(record: any, options: { force?: boolean } = {}): SectionChange[] {
  const sections: { path: string; label: string; section: any }[] = [
    { path: 'tuition', label: 'المصروفات', section: record.tuition },
  ];
  // An unenrolled bus can carry a stale fee with no installments; rebalancing
  // it would invent a debt for a service the student does not use.
  if (record.bus?.enrolled === true) {
    sections.push({ path: 'bus', label: 'الباص', section: record.bus });
  }
  (record.trips ?? []).forEach((trip: any, index: number) => {
    sections.push({ path: `trips.${index}`, label: `رحلة: ${trip?.name ?? index + 1}`, section: trip });
  });

  const changes: SectionChange[] = [];
  for (const { path, label, section } of sections) {
    if (!section || !Array.isArray(section.installments)) continue;
    const copy = JSON.parse(JSON.stringify(section));
    const before = snapshot(service, copy);
    service.rebalanceSection(copy, options);
    const after = snapshot(service, copy);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      // Installments added by the rebalance are subdocuments with their own id.
      copy.installments.forEach((i: any) => {
        if (!i._id) i._id = new mongoose.Types.ObjectId();
        if (typeof i.dueDate === 'string') i.dueDate = new Date(i.dueDate);
      });
      changes.push({ path, label, before, after, section: copy });
    }
  }
  return changes;
}

export async function repairAll(
  db: mongoose.mongo.Db,
  { apply, reshapeRecordIds }: { apply: boolean; reshapeRecordIds?: string[] },
): Promise<{ scanned: number; affected: number; repaired: number; skipped: number }> {
  const records = db.collection('studentFinancialRecords');
  const students = db.collection('students');
  let scanned = 0, affected = 0, repaired = 0, skipped = 0;

  const reshape = reshapeRecordIds !== undefined;
  if (reshape) {
    const ids = reshapeRecordIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!ids.length || ids.length !== reshapeRecordIds.length) {
      throw new Error('--reshape needs --records with valid record ids, and runs on those only');
    }
  }
  const filter = reshape
    ? { _id: { $in: reshapeRecordIds.map((id) => new mongoose.Types.ObjectId(id)) } }
    : {};

  for await (const record of records.find(filter)) {
    scanned += 1;
    const changes = planRepair(record, { force: reshape });
    if (!changes.length) continue;
    affected += 1;

    const student = await students.findOne({ _id: record.studentId }, { projection: { name: 1 } });
    console.log(`\n${student?.name ?? record.studentId}  (school ${record.schoolId}, record ${record._id})`);
    for (const change of changes) {
      console.log(`  ${change.label}`);
      console.log(`    قبل : الصافي ${change.before.netFee} · مدفوع ${change.before.totalPaid} · ${change.before.status}`);
      console.log(`          ${change.before.installments}`);
      console.log(`    بعد : الصافي ${change.after.netFee} · مدفوع ${change.after.totalPaid} · ${change.after.status}`);
      console.log(`          ${change.after.installments}`);
    }

    if (!apply) continue;

    const $set: Record<string, unknown> = {};
    for (const change of changes) {
      $set[`${change.path}.installments`] = change.section.installments;
      $set[`${change.path}.totalPaid`] = change.section.totalPaid;
      $set[`${change.path}.status`] = change.section.status;
    }
    // Only if nothing — a payment, a refund — touched the record since it was read.
    const result = await records.updateOne(
      { _id: record._id, updatedAt: record.updatedAt },
      { $set: { ...$set, updatedAt: new Date() } },
    );
    if (result.modifiedCount === 1) repaired += 1;
    else {
      skipped += 1;
      console.log('    ⚠ تغيّر السجل أثناء التشغيل — لم يُعدَّل. أعد التشغيل.');
    }
  }
  return { scanned, affected, repaired, skipped };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const reshape = process.argv.includes('--reshape');
  const recordsArg = process.argv[process.argv.indexOf('--records') + 1];
  const reshapeRecordIds = reshape
    ? (process.argv.includes('--records') && recordsArg ? recordsArg.split(',').map((id) => id.trim()).filter(Boolean) : [])
    : undefined;

  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  try {
    const summary = await repairAll(mongoose.connection.db, { apply: !dryRun, reshapeRecordIds });
    console.log('\n──────────');
    console.log(`سجلات مفحوصة : ${summary.scanned}`);
    console.log(`سجلات متأثرة  : ${summary.affected}`);
    if (dryRun) console.log('(تشغيل تجريبي — لم يُعدَّل شيء. شغّله بدون --dry-run للإصلاح)');
    else console.log(`تم إصلاحها    : ${summary.repaired}${summary.skipped ? ` · تخطّي ${summary.skipped}` : ''}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
