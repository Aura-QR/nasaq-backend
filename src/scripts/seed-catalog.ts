import { readFileSync } from 'fs';

export function parseCatalog(input: unknown) {
  if (!Array.isArray(input)) throw new Error('Expected a subjects array');
  const subjects = new Map<
    string,
    {
      subjectId: string;
      subjectName: string;
      lessons: { id: string; unit: string; lessonName: string }[];
    }
  >();
  const lessonIds = new Set<string>();
  const unitIds = new Set<string>();
  for (const row of input) {
    const subjectId = String(row.subjectId);
    if (
      !/^\d+$/.test(subjectId) ||
      !row.subjectName?.trim() ||
      !Array.isArray(row.lessons)
    )
      throw new Error('Invalid catalog subject');
    if (!subjects.has(subjectId))
      subjects.set(subjectId, {
        subjectId,
        subjectName: row.subjectName.trim(),
        lessons: [],
      });
    for (const lesson of row.lessons) {
      if (
        typeof lesson.id !== 'string' ||
        !/^\d+(,\d+){2,3}$/.test(lesson.id) ||
        lesson.id.split(',')[0] !== subjectId ||
        !lesson.unit?.trim() ||
        !lesson.lessonName?.trim()
      )
        throw new Error(`Invalid lesson source ID or name: ${lesson.id}`);
      if (lessonIds.has(lesson.id)) continue;
      lessonIds.add(lesson.id);
      unitIds.add(lesson.id.split(',').slice(0, 2).join(','));
      subjects.get(subjectId).lessons.push({
        id: lesson.id,
        unit: lesson.unit.trim(),
        lessonName: lesson.lessonName.trim(),
      });
    }
  }
  return {
    subjects: [...subjects.values()],
    counts: {
      subjects: subjects.size,
      units: unitIds.size,
      lessons: lessonIds.size,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf('--source');
  const source =
    sourceIndex >= 0 ? args[sourceIndex + 1] : process.env.CATALOG_SOURCE;
  if (!source)
    throw new Error(
      'Provide --source <subjects_and_lessons.json> or CATALOG_SOURCE',
    );
  const catalog = parseCatalog(
    JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, '')),
  );
  console.log(JSON.stringify(catalog.counts));
  if (!args.includes('--apply') || args.includes('--dry-run')) {
    console.log(
      'Dry run: no writes. Use --apply with CATALOG_API_URL and CATALOG_ADMIN_TOKEN to seed.',
    );
    return;
  }
  const base = process.env.CATALOG_API_URL;
  const token = process.env.CATALOG_ADMIN_TOKEN;
  if (!base || !token)
    throw new Error(
      'CATALOG_API_URL and CATALOG_ADMIN_TOKEN (SUPER_ADMIN) are required',
    );
  const url = new URL(base);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
  )
    throw new Error('Use HTTPS for remote seeding');
  for (const subject of catalog.subjects) {
    const response = await fetch(`${base.replace(/\/$/, '')}/catalog/seed`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subject),
      signal: AbortSignal.timeout(120000),
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        `Seeding subject ${subject.subjectId} failed (HTTP ${response.status})`,
      );
    console.log(`Seeded subject ${subject.subjectId}`);
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
