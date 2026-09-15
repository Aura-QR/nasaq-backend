/**
 * READ-ONLY. Counts teacher attendance records whose time may have been saved
 * three hours late. Changes nothing.
 *
 * Until 2026-09-14 a time typed on the admin screen ("07:45") reached the
 * server as bare HH:mm and was read as UTC — in a Riyadh school, 10:45 local,
 * and 195 minutes late against a 07:30 start. It affected:
 *
 *   - manual entries (method: 'manual'), and
 *   - edits that changed a time (any record with recordedBy set — a location
 *     check-in has recordedBy null until someone edits it).
 *
 * Location check-ins that were never edited are not affected.
 *
 * The web started sending the instant itself at frontend 39d2f0e
 * (2026-09-14 11:43 UTC). Pass --before with the time that build actually
 * reached production — the commit time is only an upper bound on when the bug
 * could still write.
 *
 * Candidates are records CREATED before the cutoff. A later write does not
 * clear one: editing only the note of an old manual record after the fix
 * moves updatedAt and leaves the wrong time exactly where it was. Those are
 * counted apart, as "touched after the fix", because some of them had their
 * time corrected by hand and some did not — the script cannot tell which.
 *
 * For each candidate it prints the stored local time and what it reads as if
 * the shift is undone. The script cannot know which edits changed a time and
 * which only changed a note, so it reports; a person decides.
 *
 *   node dist/scripts/count-shifted-teacher-attendance.js
 *   node dist/scripts/count-shifted-teacher-attendance.js --before 2026-09-14T11:43:46Z --samples 20
 */
import * as mongoose from 'mongoose';
import { config } from 'dotenv';

config();

export const DEFAULT_CUTOFF = '2026-09-14T11:43:46.000Z';

const localTime = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant);

/** Offset of the zone from UTC at that instant, in minutes (Riyadh: 180). */
const offsetMinutes = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour') % 24, read('minute'), read('second'));
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
};

export type SchoolReport = {
  schoolId: string;
  schoolName: string;
  timezone: string;
  manual: number;
  edited: number;
  /** Of manual + edited: written again after the cutoff, time possibly fixed by hand since. */
  touchedAfterFix: number;
  samples: {
    teacher: string;
    date: string;
    stored: string;
    ifShifted: string;
    lateMinutes: number | null;
    kind: string;
    touchedAfterFix: boolean;
  }[];
};

export async function countShifted(
  db: mongoose.mongo.Db,
  { before = DEFAULT_CUTOFF, samples = 10 }: { before?: string; samples?: number } = {},
): Promise<SchoolReport[]> {
  const cutoff = new Date(before);
  if (Number.isNaN(cutoff.getTime())) throw new Error(`--before is not a date: ${before}`);

  const candidates = await db
    .collection('teacherAttendance')
    .find({
      $and: [
        // Records from before timestamps existed have no createdAt; they are old.
        { $or: [{ createdAt: { $lt: cutoff } }, { createdAt: { $exists: false } }] },
        { $or: [{ method: 'manual' }, { recordedBy: { $ne: null } }] },
      ],
    })
    .sort({ schoolId: 1, date: 1 })
    .toArray();

  const schoolIds = [...new Set(candidates.map((r) => String(r.schoolId)))];
  const schools = await db
    .collection('schools')
    .find({ _id: { $in: schoolIds.filter(mongoose.Types.ObjectId.isValid).map((id) => new mongoose.Types.ObjectId(id)) } })
    .project({ name: 1, 'settings.timezone': 1 })
    .toArray();
  const schoolById = new Map(schools.map((s) => [String(s._id), s]));

  const reports = new Map<string, SchoolReport>();
  for (const record of candidates) {
    const key = String(record.schoolId);
    const school = schoolById.get(key);
    const timezone = school?.settings?.timezone || 'Asia/Riyadh';
    if (!reports.has(key)) {
      reports.set(key, { schoolId: key, schoolName: school?.name ?? '(unknown school)', timezone, manual: 0, edited: 0, touchedAfterFix: 0, samples: [] });
    }
    const report = reports.get(key)!;
    const kind = record.method === 'manual' ? 'manual' : 'edited';
    report[kind] += 1;
    const touchedAfterFix = !!record.updatedAt && new Date(record.updatedAt) >= cutoff;
    if (touchedAfterFix) report.touchedAfterFix += 1;

    if (report.samples.length < samples && record.checkInAt) {
      const stored = new Date(record.checkInAt);
      const undone = new Date(stored.getTime() - offsetMinutes(stored, timezone) * 60000);
      report.samples.push({
        teacher: record.name ?? String(record.teacherId),
        date: new Date(record.date).toISOString().slice(0, 10),
        stored: localTime(stored, timezone),
        ifShifted: localTime(undone, timezone),
        lateMinutes: record.lateMinutes ?? null,
        kind,
        touchedAfterFix,
      });
    }
  }
  return [...reports.values()];
}

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error('MONGODB_URI is not set');

  await mongoose.connect(uri);
  try {
    const reports = await countShifted(mongoose.connection.db, {
      before: arg('--before') ?? DEFAULT_CUTOFF,
      samples: Number(arg('--samples') ?? 10),
    });
    const total = reports.reduce((sum, r) => sum + r.manual + r.edited, 0);
    console.log(`READ-ONLY — nothing was changed. Cutoff: records created before ${arg('--before') ?? DEFAULT_CUTOFF}`);
    console.log(`مدارس فيها سجلات محتملة: ${reports.length} · سجلات محتملة: ${total}\n`);
    for (const r of reports) {
      console.log(`■ ${r.schoolName} (${r.schoolId}) — ${r.timezone}`);
      console.log(`  حضور يدوي: ${r.manual} · سجلات مُعدّلة: ${r.edited} · منها عُدّل بعد الإصلاح (يحتاج مراجعة): ${r.touchedAfterFix}`);
      for (const s of r.samples) {
        console.log(
          `    ${s.date}  ${s.teacher}  المحفوظ ${s.stored}  ← لو كان مُزاحًا يكون ${s.ifShifted}  تأخير محفوظ: ${s.lateMinutes ?? '—'} د  (${s.kind === 'manual' ? 'يدوي' : 'مُعدّل'}${s.touchedAfterFix ? ' · عُدّل بعد الإصلاح' : ''})`,
        );
      }
      console.log('');
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
