export {};
import { readFileSync, writeFileSync } from 'fs';

/**
 * Turn the Madrasati course dump into the shape `seed-catalog.ts` seeds from.
 *
 * ## What the source is
 *
 * `madrasati_courses_clean.json` is the Saudi national curriculum as the
 * ministry publishes it — 162 courses, 8,340 lessons, keyed by ministry ids.
 * It is the same for every school in the Kingdom, which is why one static file
 * works for every teacher: a school cannot mint a `chapterId`.
 *
 * ## The two things it does not say
 *
 * **The subject.** A course carries no subject name. What looks like one is the
 * first segment of its first lesson — the *unit*, not the subject. So course 86
 * reads "القيم الإسلامية" and course 160 reads "وحدة تعزيز المهارات", and neither
 * is a subject a school would recognise. Worse, 44 of the 75 distinct labels
 * repeat: "مجال الرسم" is two different courses for two different grades.
 *
 * `subjects-to-map.csv` supplies the real subject per course. The original
 * label is kept as `subjectVariant` — without it the picker would offer
 * "العلوم" thirty-five times with nothing to choose between them.
 *
 * **The grade.** Nothing in the source names one. That is not a blocker: the
 * school chooses its own subject and grade when it imports (see
 * `CurriculumService.import`), and it must, because grades are named per
 * school — مواهب carries both "الصف السادس" and "الصف السادس إبتدائى".
 * `gradeName` is a hint for the picker and nothing more.
 *
 * ## Where the good mapping comes from
 *
 * `catalog-mapping.recovered.json` (see docs/Curriculum-Mapping-Review.md)
 * recovers both the subject and the grade by matching each course's lesson
 * ids against a local curriculum source, requiring 60% of a course's lessons
 * and at least three, with no rival candidate above 20%. It resolves 139 of
 * the 162 courses.
 *
 * Prefer it. The CSV was hand-assigned from the first unit's name and is
 * wrong for 90 of the 162 — course 273 is اللغة العربية and the sheet calls
 * it التربية الصحية والبدنية. The CSV remains the fallback for the 23 the
 * recovery could not settle; those rows carry an empty subject, and an empty
 * name is never allowed to overwrite a usable one.
 *
 * ## Usage
 *
 *   npx ts-node src/scripts/convert-madrasati-catalog.ts \
 *     --source <madrasati_courses_clean.json> \
 *     --map    subjects-to-map.csv \
 *     --out    catalog-source.json
 *
 * Then feed `catalog-source.json` to `seed-catalog.ts`.
 */

/** One row of catalog-mapping.recovered.json. */
interface RecoveredSubject {
  subjectId: string | number;
  subjectName?: string;
  gradeName?: string;
  stageName?: string;
  status?: string;
}

export interface CatalogSourceSubject {
  subjectId: string;
  subjectName: string;
  subjectVariant: string;
  gradeName: string;
  lessons: { id: string; unit: string; lessonName: string }[];
}

/**
 * A CSV reader that survives this file.
 *
 * A naive `split(',')` gets row 136 wrong — `"IT'S A GOOD DEAL , ISN'T IT?"`
 * is one quoted field with a comma inside it, and splitting on commas shifted
 * every column after it, which is how one course ended up with the subject
 * name "72".
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** subjectId -> the subject and grade a human decided this course is. */
export function readMapping(
  csv: string,
): Map<string, { subject: string; variant: string; grade: string }> {
  const [header, ...rows] = parseCsv(csv);
  if (!header) throw new Error('Mapping CSV is empty');

  // Match by heading rather than by position, so a column inserted into the
  // sheet does not silently shift the subject into the confidence score.
  const at = (needle: string) =>
    header.findIndex((h) => h.trim().includes(needle));
  const idAt = 0;
  const variantAt = at('الاسم في الملف');
  const subjectAt = at('المادة');
  const gradeAt = at('الصف');
  if (subjectAt < 0) throw new Error('Mapping CSV has no "المادة" column');

  const map = new Map<
    string,
    { subject: string; variant: string; grade: string }
  >();
  for (const row of rows) {
    const id = (row[idAt] ?? '').trim();
    if (!/^\d+$/.test(id)) continue;
    map.set(id, {
      subject: (row[subjectAt] ?? '').trim(),
      variant: variantAt >= 0 ? (row[variantAt] ?? '').trim() : '',
      grade: gradeAt >= 0 ? (row[gradeAt] ?? '').trim() : '',
    });
  }
  return map;
}

/**
 * `"القيم الإسلامية -- نص الانطلاق (قبس من القرآن الكريم)"`
 *   -> unit "القيم الإسلامية", lesson "نص الانطلاق (قبس من القرآن الكريم)"
 *
 * A lesson name may itself contain " -- ", so split once, not everywhere.
 */
export function splitLessonName(raw: string): { unit: string; lesson: string } {
  const at = raw.indexOf(' -- ');
  if (at < 0) return { unit: raw.trim(), lesson: raw.trim() };
  return {
    unit: raw.slice(0, at).trim(),
    lesson: raw.slice(at + 4).trim() || raw.trim(),
  };
}

/**
 * subjectId -> the recovered subject and grade, for rows that were settled.
 *
 * A `needs-review` row is skipped entirely rather than merged in: it carries
 * an empty subject, and letting an empty value win would blank a name the CSV
 * had right.
 */
export function readRecovered(
  json: unknown,
): Map<string, { subject: string; grade: string }> {
  const rows: RecoveredSubject[] = Array.isArray(json)
    ? (json as RecoveredSubject[])
    : ((json as any)?.subjects ?? []);

  const map = new Map<string, { subject: string; grade: string }>();
  for (const row of rows) {
    const id = String(row?.subjectId ?? '').trim();
    const subject = String(row?.subjectName ?? '').trim();
    const grade = String(row?.gradeName ?? '').trim();
    if (!/^\d+$/.test(id)) continue;
    if (row?.status === 'needs-review') continue;
    if (!subject) continue;
    map.set(id, { subject, grade: grade === 'needs-review' ? '' : grade });
  }
  return map;
}

export function convert(
  courses: any[],
  mapping: Map<string, { subject: string; variant: string; grade: string }>,
  recovered: Map<string, { subject: string; grade: string }> = new Map(),
): { subjects: CatalogSourceSubject[]; skipped: string[] } {
  const subjects: CatalogSourceSubject[] = [];
  const skipped: string[] = [];

  for (const course of courses) {
    const subjectId = String(course.subjectId ?? '').trim();
    if (!/^\d+$/.test(subjectId)) {
      skipped.push(`${subjectId || '(no id)'}: not a numeric subject id`);
      continue;
    }

    const raw: any[] = Array.isArray(course.rawLessonsList)
      ? course.rawLessonsList
      : [];

    const seen = new Set<string>();
    const lessons: CatalogSourceSubject['lessons'] = [];
    for (const entry of raw) {
      const id = String(entry?.id ?? '').trim();
      const name = String(entry?.name ?? '').trim();
      // The seed rejects a lesson whose id does not belong to its subject, so
      // drop it here where it can be reported rather than fail the whole run.
      if (!/^\d+(,\d+){2,3}$/.test(id) || id.split(',')[0] !== subjectId) continue;
      if (!name || seen.has(id)) continue;
      seen.add(id);
      const parts = splitLessonName(name);
      lessons.push({ id, unit: parts.unit, lessonName: parts.lesson });
    }

    if (!lessons.length) {
      skipped.push(`${subjectId}: no usable lessons`);
      continue;
    }

    const mapped = mapping.get(subjectId);
    const found = recovered.get(subjectId);

    const subjectName = found?.subject || mapped?.subject || '';
    if (!subjectName) {
      skipped.push(`${subjectId}: no subject in the recovered mapping or the CSV`);
      continue;
    }

    subjects.push({
      subjectId,
      subjectName,
      // Fall back to the first unit — it is what the CSV's own column holds.
      subjectVariant: mapped?.variant || lessons[0].unit,
      gradeName: found?.grade || mapped?.grade || '',
      lessons,
    });
  }

  return { subjects, skipped };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const source = arg('source');
  const map = arg('map') ?? 'subjects-to-map.csv';
  const out = arg('out') ?? 'catalog-source.json';
  const recoveredPath = arg('recovered') ?? 'catalog-mapping.recovered.json';
  if (!source) {
    throw new Error(
      'Provide --source <madrasati_courses_clean.json> [--map subjects-to-map.csv] [--out catalog-source.json]',
    );
  }

  const courses = JSON.parse(readFileSync(source, 'utf8').replace(/^﻿/, ''));
  const mapping = readMapping(readFileSync(map, 'utf8'));

  let recovered = new Map<string, { subject: string; grade: string }>();
  try {
    recovered = readRecovered(JSON.parse(readFileSync(recoveredPath, 'utf8')));
    console.log(`ربط مستعاد : ${recovered.size} مقرر (${recoveredPath})`);
  } catch {
    console.log(`ربط مستعاد : غير موجود (${recoveredPath}) — سيُستخدم CSV وحده`);
  }

  const { subjects, skipped } = convert(courses, mapping, recovered);

  const units = new Set<string>();
  let lessons = 0;
  for (const s of subjects) {
    lessons += s.lessons.length;
    for (const l of s.lessons) units.add(l.id.split(',').slice(0, 2).join(','));
  }

  const bySubject = new Map<string, number>();
  for (const s of subjects)
    bySubject.set(s.subjectName, (bySubject.get(s.subjectName) ?? 0) + 1);

  const withGrade = subjects.filter((row) => row.gradeName).length;
  console.log(`مقررات : ${subjects.length} / ${courses.length}`);
  console.log(`بصف    : ${withGrade}`);
  console.log(`وحدات  : ${units.size}`);
  console.log(`دروس   : ${lessons}`);
  console.log('\nالمواد:');
  for (const [name, count] of [...bySubject].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(count).padStart(3)}  ${name}`);

  if (skipped.length) {
    console.log(`\nمتخطّى (${skipped.length}):`);
    for (const line of skipped.slice(0, 20)) console.log(`  - ${line}`);
    if (skipped.length > 20) console.log(`  … و${skipped.length - 20} غيرهم`);
  }

  writeFileSync(out, JSON.stringify(subjects, null, 2), 'utf8');
  console.log(`\nاتكتب: ${out}`);
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
