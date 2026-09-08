import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { CatalogSourceSubject } from './convert-madrasati-catalog';

type Row = Record<string, any>;
type Tables = Record<string, Map<number, Row>>;

/** Read the literal VALUES rows in Hader's generated migration; never execute SQL. */
export function parseValues(line: string): any[] {
  const values: any[] = [];
  let value = '';
  let quoted = false;
  let isText = false;
  const push = () => {
    const text = value.trim();
    if (!isText && text !== 'NULL' && !/^-?\d+$/.test(text))
      throw new Error(`Unsupported SQL literal: ${text}`);
    values.push(isText ? value : text === 'NULL' ? null : Number(text));
    value = '';
    isText = false;
  };
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === "'" && line[i + 1] === "'") {
        value += "'";
        i++;
      } else if (char === "'") quoted = false;
      else value += char;
    } else if (char === "'") {
      quoted = true;
      isText = true;
      value = '';
    } else if (char === ',') push();
    else if (!(isText && /\s/.test(char))) value += char;
  }
  if (quoted) throw new Error('Unclosed SQL string');
  push();
  return values;
}

export function applyDataMigration(tables: Tables, sql: string) {
  let table: string | undefined;
  let columns: string[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const insert = line.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES\s*$/);
    if (insert) {
      table = insert[1];
      if (!tables[table]) throw new Error(`Unknown table ${table}`);
      columns = insert[2].split(',').map((v) => v.trim());
      continue;
    }
    const tuple = table && line.match(/^\s*\((.*)\)[,;]?\s*$/);
    if (tuple) {
      const values = parseValues(tuple[1]);
      if (values.length !== columns.length)
        throw new Error('SQL column count mismatch');
      const row = Object.fromEntries(columns.map((c, i) => [c, values[i]]));
      if (!tables[table].has(row.id)) tables[table].set(row.id, row);
      continue;
    }
    table = undefined;
    const update = line.match(
      /^UPDATE (\w+) SET (\w+) = (\d+) WHERE id = (\d+);$/,
    );
    if (update) {
      const row = tables[update[1]]?.get(Number(update[4]));
      if (!row) throw new Error(`Missing migration target: ${line}`);
      row[update[2]] = Number(update[3]);
    } else if (/^UPDATE |^DELETE |^INSERT INTO /.test(line)) {
      throw new Error(`Unsupported data statement: ${line}`);
    }
  }
}

export function normalizeTitle(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function identity(row: Row) {
  return JSON.stringify(
    [row.stageName, row.gradeName, row.subjectName].map(normalizeTitle),
  );
}

/** Evidence must match both the leaf ID and its title, not just a common name. */
export function matchCourse(
  course: CatalogSourceSubject,
  index: Map<string, Row[]>,
) {
  const candidates = new Map<string, Row>();
  for (const lesson of course.lessons) {
    const parts = lesson.id.split(',');
    const leaf = parts[parts.length - 1];
    const parent = parts[parts.length - 2];
    const separator = lesson.lessonName.indexOf(' -- ');
    const title = normalizeTitle(
      parts.length === 4 && separator >= 0
        ? lesson.lessonName.slice(separator + 4)
        : lesson.lessonName,
    );
    const hits = (index.get(leaf) ?? []).filter(
      (r) => normalizeTitle(r.title) === title,
    );
    for (const row of hits) {
      const key = identity(row);
      if (!candidates.has(key))
        candidates.set(key, {
          subjectName: row.subjectName,
          gradeName: row.gradeName,
          stageName: row.stageName,
          trackLessons: new Map<string, Set<string>>(),
          haderSubjectIds: new Set<number>(),
          lessonIds: new Set<string>(),
          parentAndLessonIds: new Set<string>(),
        });
      const candidate = candidates.get(key);
      candidate.haderSubjectIds.add(row.subjectId);
      if (row.track) {
        if (!candidate.trackLessons.has(row.track))
          candidate.trackLessons.set(row.track, new Set());
        candidate.trackLessons.get(row.track).add(lesson.id);
      }
      candidate.lessonIds.add(lesson.id);
      if (String(row.parentId) === parent)
        candidate.parentAndLessonIds.add(lesson.id);
    }
  }
  return [...candidates.values()]
    .map((c) => ({
      subjectName: c.subjectName,
      gradeName: c.gradeName,
      stageName: c.stageName,
      tracks: [...c.trackLessons.entries()]
        .filter(
          ([, ids]) =>
            ids.size / course.lessons.length >= 0.6 &&
            ids.size >= Math.min(3, course.lessons.length),
        )
        .map(([track]) => track)
        .sort(),
      trackEvidence: [...c.trackLessons.entries()].map(([track, ids]) => ({
        track,
        matchedLessons: ids.size,
      })),
      haderSubjectIds: [...c.haderSubjectIds].sort((a, b) => a - b),
      matchedLessons: c.lessonIds.size,
      parentAndLessonMatches: c.parentAndLessonIds.size,
      coverage: Number((c.lessonIds.size / course.lessons.length).toFixed(4)),
      sampleLessonIds: [...c.lessonIds].slice(0, 5),
    }))
    .sort((a, b) => b.matchedLessons - a.matchedLessons);
}

export function chooseCandidate(
  candidates: Row[],
  total: number,
): Row | undefined {
  const [first, second] = candidates;
  if (
    !first ||
    first.matchedLessons < Math.min(3, total) ||
    first.matchedLessons / total < 0.6
  )
    return undefined;
  if (second && second.matchedLessons / total >= 0.2) return undefined;
  return first;
}

function main() {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? fallback : process.argv[i + 1];
  };
  const hader = resolve(arg('hader', '../Hader-backend'));
  const source = resolve(arg('source', 'catalog-source.json'));
  const out = resolve(arg('out', 'catalog-mapping.recovered.json'));
  const sources: Row[] = [];
  const read = (path: string) => {
    const bytes = readFileSync(path);
    sources.push({
      file: path.replace(/\\/g, '/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    return bytes.toString('utf8').replace(/^\uFEFF/, '');
  };
  const courses: CatalogSourceSubject[] = JSON.parse(read(source));
  const tables: Tables = {};
  for (const name of [
    'stages',
    'grades',
    'subjects',
    'units',
    'chapters',
    'lessons',
  ]) {
    const rows: Row[] = JSON.parse(read(join(hader, 'files', `${name}.json`)));
    tables[name] = new Map(rows.map((r) => [r.id, r]));
  }
  applyDataMigration(tables, read(join(hader, 'migration.sql')));
  const books: Row[] = JSON.parse(
    read(join(hader, 'scraper', 'tahdiri', 'books.json')),
  );
  const index = new Map<string, Row[]>();
  for (const lesson of tables.lessons.values()) {
    const chapter = tables.chapters.get(lesson.chapter_id);
    const subject = tables.subjects.get(chapter?.subject_id);
    const grade = tables.grades.get(subject?.grade_id);
    const stage = tables.stages.get(grade?.stage_id);
    if (!chapter || !subject || !grade || !stage)
      throw new Error('Broken source curriculum reference');
    if (!lesson.lesson_api_id) continue;
    const key = String(lesson.lesson_api_id);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      title: lesson.title,
      parentId: chapter.source_chapter_id ?? chapter.source_unit_id,
      subjectId: subject.id,
      subjectName: subject.name,
      gradeName: grade.name,
      stageName: stage.name,
      track: grade.track ?? null,
    });
  }
  const mappings = courses.map((course) => {
    const candidates = matchCourse(course, index);
    const courseReferences = books.filter(
      (b) => String(b.subject_id) === course.subjectId,
    );
    const directlyReferenced = candidates.filter((c) =>
      courseReferences.some((b) => {
        const grade = [...b.trail]
          .reverse()
          .find((t) => t.level === 'K' || t.level === 'TRK');
        return (
          normalizeTitle(c.subjectName) === normalizeTitle(b.subject_title) &&
          normalizeTitle(c.gradeName) === normalizeTitle(grade?.title) &&
          normalizeTitle(c.stageName) === normalizeTitle(b.trail[0]?.title)
        );
      }),
    );
    const direct =
      directlyReferenced.length === 1
        ? chooseCandidate(directlyReferenced, course.lessons.length)
        : undefined;
    const selected =
      direct ?? chooseCandidate(candidates, course.lessons.length);
    return {
      subjectId: course.subjectId,
      originalSubjectName: course.subjectName,
      subjectName: selected?.subjectName ?? null,
      gradeName: selected?.gradeName ?? null,
      stageName: selected?.stageName ?? null,
      tracks: selected?.tracks ?? [],
      status: direct
        ? 'matched-local-course-and-lesson-ids'
        : selected
          ? 'matched-local-lesson-ids'
          : 'needs-review',
      officialMadrasatiMappingVerified: false,
      totalLessons: course.lessons.length,
      evidence: selected ?? null,
      candidates: selected ? [] : candidates.slice(0, 5),
      bookReferences: courseReferences.flatMap((b) =>
        b.books.map((book) => ({
          title: book.title,
          url: book.url,
          treePath: book.tree_path,
        })),
      ),
    };
  });
  const summary = {
    courses: courses.length,
    mapped: mappings.filter((m) => m.gradeName).length,
    needsReview: mappings.filter((m) => !m.gradeName).length,
    correctedSubjects: mappings.filter(
      (m) => m.subjectName && m.subjectName !== m.originalSubjectName,
    ).length,
  };
  const output = {
    schemaVersion: 1,
    provenance:
      'Recovered from local Hader Tahdiri curriculum and its track migration. Not a direct official Madrasati export.',
    academicYearVerified: null,
    matchingRule:
      'Exact leaf ID and normalized leaf title; >=60% of course lessons, at least 3; competing grade/subject must cover <20%, unless a local book record explicitly associates this course ID with the candidate. Tracks are retained separately.',
    sources,
    sourceCounts: Object.fromEntries(
      Object.entries(tables).map(([name, rows]) => [name, rows.size]),
    ),
    summary,
    subjects: mappings,
  };
  writeFileSync(out, JSON.stringify(output, null, 2) + '\n', 'utf8');
  const escape = (text: any) =>
    String(text ?? '—')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  const report = [
    '# مراجعة ربط مقررات مدرستي بالمواد والصفوف',
    '',
    `تمت استعادة ربط محلي لـ **${summary.mapped} من ${summary.courses} مقررًا**؛ بقي **${summary.needsReview} مقررًا للمراجعة**. تغيّر اسم المادة أو تصنيفها في ${summary.correctedSubjects} سجلًا من بيانات الربط المستعادة.`,
    '',
    'الملف: `catalog-mapping.recovered.json`. هذه بيانات ربط قابلة للمراجعة، وليست تصديرًا رسميًا من مدرستي أو تأكيدًا لاكتمال منهج العام الحالي. لا توجد نسخة دراسية مؤكدة في المصدر القديم. لم تُعدّل ملفات `subjects-to-map.csv` أو `catalog-source.json`، ولم تُكتب بيانات في قاعدة بيانات.',
    '',
    '## المصدر وطريقة الاستعادة',
    '',
    '- تمت قراءة ملفات المنهج الستة في `Hader-backend/files` وتطبيق تعديلات البيانات في `Hader-backend/migration.sql` داخل الذاكرة، دون تنفيذ SQL. إهمال هذا الملف يربط بعض مواد الثانوية بمسارات غير صحيحة.',
    '- بيانات Hader موصوفة في مشروعه بأنها مستخرجة من تحضيري؛ الربط مع مدرستي في التطبيق لا يجعل هذه الملفات تصديرًا رسميًا من الوزارة.',
    '- تمت مطابقة معرّف الدرس الأخير مع `lesson_api_id` وعنوان الدرس، مع تسجيل تطابق معرّف الفصل الأب أيضًا. يدعم ذلك معرّفات الدروس المكوّنة من ثلاثة أو أربعة أجزاء.',
    '- يُقبل الربط عندما يطابق 60% على الأقل من دروس المقرر وثلاثة دروس على الأقل، ولا يصل مرشح آخر إلى 20%. المرجع المحلي الذي يربط نفس معرّف المقرر باسم المادة والصف في `books.json` يستطيع حسم التعارض.',
    '- المسارات منفصلة عن الصف. يدرج الملف أدلة تغطية الدروس لكل مسار، ولا يدرج المسار في `tracks` إلا إذا حقق حد التغطية نفسه.',
    '- لم يُستخدم تخمين ترتيب معرّفات المواد أو أول عنوان وحدة لتحديد الصف. المعرفات الداخلية لـHader ليست بديلًا عن `subjectId` الأصلي.',
    '- في `7ader` توجد نسخة من تفريغ المقررات وقائمة الدروس؛ لا تحتوي هذه النسخة وحدها على عمود الصف. المصدر الإضافي المفيد هنا هو بيانات المنهج في Hader.',
    '',
    '## استخدام البيانات',
    '',
    'اربط `subjects[].subjectId` بمعرّف المقرر الأصلي، واقرأ `subjectName` و`gradeName` و`stageName`. يحتفظ `originalSubjectName` بالتسمية السابقة. قيمة `needs-review` تعني أن الصف والمادة النهائية لم يُحسما؛ لا تستخدم أول مرشح تلقائيًا. `officialMadrasatiMappingVerified` يظل `false` لكل السجلات.',
    '',
    '`gradeName` هنا وصف للمنهج، وليس `gradeLevelId` الخاص بمدرستك في نسق. تعبئة ملف الربط لا تنشئ صفوفًا في شاشة المدرسة. روابط الكتب مراجع محفوظة في Hader ولم يتم تأكيد محتوى كل PDF أو سنة طباعته في هذه المراجعة.',
    '',
    'لإعادة إنتاج الملف من النسخ المحلية:',
    '',
    '```powershell',
    'npx ts-node src/scripts/recover-catalog-mapping.ts --hader ../Hader-backend --source catalog-source.json',
    '```',
    '',
    '## المقررات التي تحتاج مراجعة',
    '',
    '| المعرّف | التسمية السابقة، غير معتمدة | سبب عدم الحسم / المرشحون |',
    '| --- | --- | --- |',
    ...mappings
      .filter((m) => !m.gradeName)
      .map(
        (m) =>
          `| ${m.subjectId} | ${escape(m.originalSubjectName)} | ${escape(
            m.candidates.length
              ? m.candidates
                  .map(
                    (c) =>
                      `${c.subjectName} — ${c.stageName} — ${c.gradeName}: ${c.matchedLessons}/${m.totalLessons} درسًا`,
                  )
                  .join('؛ ')
              : 'لا يوجد تطابق كافٍ لمعرّفات الدروس وعناوينها في المصدر المحلي؛ يحتاج مرجع المقرر ونسخته.',
          )} |`,
      ),
    '',
    '## الربط المستعاد',
    '',
    '| معرّف المقرر | المادة المستعادة | المرحلة | الصف | الدروس المتطابقة |',
    '| --- | --- | --- | --- | --- |',
    ...mappings
      .filter((m) => m.gradeName)
      .map(
        (m) =>
          `| ${m.subjectId} | ${escape(m.subjectName)} | ${escape(m.stageName)} | ${escape(m.gradeName)} | ${m.evidence.matchedLessons}/${m.totalLessons} |`,
      ),
    '',
    'توجد مسارات الثانوية ومعرّفات السجلات المرجعية وبصمات SHA-256 لملفات المصدر وتفاصيل المطابقة في ملف JSON.',
    '',
  ].join('\n');
  writeFileSync(
    resolve(arg('report', 'docs/Curriculum-Mapping-Review.md')),
    report,
    'utf8',
  );
  console.log(JSON.stringify(summary));
  console.log(`Wrote ${out}`);
  for (const m of mappings.filter((r) => !r.gradeName))
    console.log(
      `${m.subjectId}: ${m.candidates.map((c) => `${c.subjectName} / ${c.gradeName} (${c.matchedLessons}/${m.totalLessons})`).join('; ') || 'no matching lesson IDs'}`,
    );
}

if (require.main === module) main();
