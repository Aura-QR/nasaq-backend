/**
 * Enters مدارس مواهب المملكة's first-term setup through the public API.
 *
 * Through the API, not the database: every rule the app enforces — capacity,
 * duplicate names, tenant scoping — applies here too. A seed that writes
 * straight to Mongo is a seed that can produce a school the app itself would
 * have refused to create.
 *
 * Credentials come from the environment so they never sit in a file or a
 * chat log:
 *
 *   NASAQ_EMAIL=owner@… NASAQ_PASSWORD=… npm run seed:mwahb -- --dry-run
 *   NASAQ_EMAIL=owner@… NASAQ_PASSWORD=… npm run seed:mwahb
 *
 * Safe to re-run: anything that already exists is matched by name and reused.
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const DRY = process.argv.includes('--dry-run');

// ── the school ────────────────────────────────────────────────────────────
const WEEK = [
  { day: 'sunday',    isWorkingDay: true,  periodsPerDay: 8, startTime: '07:30', endTime: '14:00' },
  { day: 'monday',    isWorkingDay: true,  periodsPerDay: 8, startTime: '07:30', endTime: '14:00' },
  { day: 'tuesday',   isWorkingDay: true,  periodsPerDay: 8, startTime: '07:30', endTime: '14:00' },
  { day: 'wednesday', isWorkingDay: true,  periodsPerDay: 8, startTime: '07:30', endTime: '14:00' },
  { day: 'thursday',  isWorkingDay: true,  periodsPerDay: 6, startTime: '07:30', endTime: '12:00' },
  { day: 'friday',    isWorkingDay: false, periodsPerDay: null, startTime: null, endTime: null },
  { day: 'saturday',  isWorkingDay: false, periodsPerDay: null, startTime: null, endTime: null },
];

const STAGES = [
  { name: 'المرحلة الابتدائية', order: 1,
    grades: [
      { name: 'الصف الأول', order: 1 },
      { name: 'الصف الثاني', order: 2 },
      { name: 'الصف الثالث', order: 3 },
      { name: 'الصف الرابع', order: 4 },
      { name: 'الصف الخامس', order: 5 },
      { name: 'الصف السادس', order: 6 },
    ] },
  { name: 'المرحلة المتوسطة', order: 2,
    grades: [{ name: 'الأول متوسط', order: 7 }] },
];

const CLASSES = [
  { name: 'أولى/بنات',        grade: 'الصف الأول',   gender: 'female' },
  { name: 'أولى/بنين',        grade: 'الصف الأول',   gender: 'male' },
  { name: 'ثانية/بنات ١',     grade: 'الصف الثاني',  gender: 'female' },
  { name: 'ثانية/بنات ٢',     grade: 'الصف الثاني',  gender: 'female' },
  { name: 'ثانية/بنين',       grade: 'الصف الثاني',  gender: 'male' },
  { name: 'ثالثة/بنات',       grade: 'الصف الثالث',  gender: 'female' },
  { name: 'ثالثة/بنين',       grade: 'الصف الثالث',  gender: 'male' },
  { name: 'رابعة/بنات',       grade: 'الصف الرابع',  gender: 'female' },
  { name: 'خامسة/بنات',       grade: 'الصف الخامس',  gender: 'female' },
  // The أنصبة sheet never says which; 'both' keeps it honest until they do.
  { name: 'سادسة',            grade: 'الصف السادس',  gender: 'both' },
  { name: 'أولى متوسط/بنات',  grade: 'الأول متوسط',  gender: 'female' },
];

/** The teaching plan, straight off the أنصبة sheet. */
const PLAN: Record<string, [string, number][]> = {
  'الصف الأول': [['الدراسات الإسلامية',5],['لغتي',8],['الرياضيات',5],['العلوم',3],
    ['تربية فنية',1],['المهارات الحياتية والأسرية',1],['التربية البدنية',2],
    ['اللغة الإنجليزية',5],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الصف الثاني': [['الرياضيات',5],['العلوم',3],['لغتي',7],['تربية فنية',2],
    ['الدراسات الإسلامية',5],['المهارات الحياتية والأسرية',1],['التربية البدنية',2],
    ['اللغة الإنجليزية',5],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الصف الثالث': [['لغتي',6],['تدريب نافس',1],['العلوم',3],['الرياضيات',6],
    ['اللغة الإنجليزية',5],['تربية فنية',1],['المهارات الحياتية والأسرية',1],
    ['الدراسات الإسلامية',5],['التربية البدنية',2],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الصف الرابع': [['اجتماعيات',2],['لغتي',5],['الدراسات الإسلامية',5],['تربية فنية',1],
    ['المهارات الحياتية والأسرية',1],['المهارات الرقمية',2],['الرياضيات',6],['العلوم',4],
    ['اللغة الإنجليزية',5],['التربية البدنية',2],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الصف الخامس': [['لغتي',5],['اجتماعيات',2],['المهارات الرقمية',2],['الرياضيات',6],
    ['العلوم',4],['الدراسات الإسلامية',5],['تربية فنية',1],['المهارات الحياتية والأسرية',1],
    ['التربية البدنية',2],['اللغة الإنجليزية',5],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الصف السادس': [['لغتي',5],['الدراسات الإسلامية',5],['اجتماعيات',2],['المهارات الرقمية',2],
    ['الرياضيات',6],['العلوم',4],['تربية فنية',1],['المهارات الحياتية والأسرية',1],
    ['التربية البدنية',2],['اللغة الإنجليزية',5],['اللغة الصينية',1],['الحساب الذهني',2]],
  'الأول متوسط': [['لغتي',5],['الدراسات الإسلامية',5],['اجتماعيات',3],['المهارات الرقمية',2],
    ['الرياضيات',6],['العلوم',4],['تربية فنية',1],['المهارات الحياتية والأسرية',1],
    ['التربية البدنية',2],['اللغة الإنجليزية',5],['اللغة الصينية',1],['الحساب الذهني',2]],
};

const TEACHERS = [
  'سمر المالكي', 'زينب البيشي', 'عنود القرشي', 'جوهرة المالكي', 'بسمة عبدالفتاح',
  'أميرة العصيمي', 'مروة العتيبي', 'ريم العتيبي', 'جيهان العتيبي', 'أشواق المضيقي',
  'نادية الشريف', 'صوفيا عبدالعزيز', 'ثريا بوخاري', 'رشا طاهر', 'ملاك الجهني',
  'فاطمة الدهاسي', 'العنود مدهر', 'بشاير الياسي',
];


// ── who teaches what ──────────────────────────────────────────────────────
const T2 = ['ثانية/بنات ١', 'ثانية/بنات ٢', 'ثانية/بنين'];
const T3 = ['ثالثة/بنات', 'ثالثة/بنين'];
const UPPER = ['رابعة/بنات', 'خامسة/بنات', 'سادسة', 'أولى متوسط/بنات'];
const EVERY = [
  'أولى/بنات', 'أولى/بنين', ...T2, ...T3, ...UPPER,
];

/**
 * Straight off the أنصبة sheet, one row per (teacher, subject, classes).
 *
 * Always pinned to named classes rather than left grade-wide. Two teachers
 * split the same subject across a grade all over this sheet — سمر takes the
 * boys' first grade and زينب the girls' — and a grade-wide assignment would
 * put both of them in both rooms.
 */
const ASSIGNMENTS: [string, string, string[]][] = [
  ['سمر المالكي', 'الدراسات الإسلامية', ['أولى/بنين']],
  ['سمر المالكي', 'لغتي', ['أولى/بنين']],
  ['سمر المالكي', 'الرياضيات', ['أولى/بنين']],
  ['سمر المالكي', 'العلوم', ['أولى/بنين']],
  ['سمر المالكي', 'تربية فنية', ['أولى/بنين']],
  ['سمر المالكي', 'المهارات الحياتية والأسرية', ['أولى/بنين']],

  ['زينب البيشي', 'الدراسات الإسلامية', ['أولى/بنات']],
  ['زينب البيشي', 'لغتي', ['أولى/بنات']],
  ['زينب البيشي', 'الرياضيات', ['أولى/بنات']],
  ['زينب البيشي', 'العلوم', ['أولى/بنات']],
  ['زينب البيشي', 'تربية فنية', ['أولى/بنات']],
  ['زينب البيشي', 'المهارات الحياتية والأسرية', ['أولى/بنات']],

  ['عنود القرشي', 'الرياضيات', T2],
  ['عنود القرشي', 'العلوم', T2],

  ['جوهرة المالكي', 'لغتي', ['ثانية/بنات ١', 'ثانية/بنات ٢']],
  ['جوهرة المالكي', 'تربية فنية', ['ثانية/بنات ١']],

  ['بسمة عبدالفتاح', 'لغتي', ['خامسة/بنات', 'سادسة', 'أولى متوسط/بنات']],
  ['بسمة عبدالفتاح', 'الدراسات الإسلامية', ['سادسة', 'أولى متوسط/بنات']],

  ['أميرة العصيمي', 'اجتماعيات', UPPER],
  ['أميرة العصيمي', 'لغتي', ['رابعة/بنات']],
  ['أميرة العصيمي', 'الدراسات الإسلامية', ['رابعة/بنات']],
  ['أميرة العصيمي', 'تربية فنية', ['رابعة/بنات']],
  ['أميرة العصيمي', 'المهارات الحياتية والأسرية', ['رابعة/بنات']],

  ['مروة العتيبي', 'لغتي', T3],
  ['مروة العتيبي', 'تدريب نافس', T3],
  ['مروة العتيبي', 'المهارات الرقمية', UPPER],

  ['ريم العتيبي', 'الرياضيات', UPPER],

  ['جيهان العتيبي', 'العلوم', [...UPPER, ...T3]],

  ['أشواق المضيقي', 'الدراسات الإسلامية', [...T2, 'خامسة/بنات']],
  ['أشواق المضيقي', 'تربية فنية', ['خامسة/بنات']],
  ['أشواق المضيقي', 'المهارات الحياتية والأسرية', ['خامسة/بنات']],
  ['أشواق المضيقي', 'التربية البدنية', ['خامسة/بنات']],

  ['نادية الشريف', 'تربية فنية', ['سادسة', 'أولى متوسط/بنات', ...T3]],
  ['نادية الشريف', 'المهارات الحياتية والأسرية', ['سادسة', 'أولى متوسط/بنات', ...T3]],
  ['نادية الشريف', 'التربية البدنية',
    ['أولى/بنات', 'أولى/بنين', 'رابعة/بنات', 'سادسة', 'أولى متوسط/بنات', 'ثالثة/بنات']],

  ['صوفيا عبدالعزيز', 'اللغة الإنجليزية', UPPER],

  // The sheet gives grade-1 English to both ثريا and ملاك; split one class each.
  ['ثريا بوخاري', 'اللغة الإنجليزية', ['ثانية/بنين', 'أولى/بنين', ...T3]],
  // The sheet assigns nobody to the two second-grade girls' classes. ملاك has
  // the lightest load, so they go to her — confirm with the school.
  ['ملاك الجهني', 'اللغة الإنجليزية', ['أولى/بنات', 'ثانية/بنات ١', 'ثانية/بنات ٢']],
  ['ملاك الجهني', 'اللغة الصينية', EVERY],

  ['رشا طاهر', 'الحساب الذهني', EVERY],
  ['رشا طاهر', 'التربية البدنية', ['ثالثة/بنين']],

  ['فاطمة الدهاسي', 'الرياضيات', T3],

  ['العنود مدهر', 'لغتي', ['ثانية/بنين']],
  ['العنود مدهر', 'تربية فنية', ['ثانية/بنات ٢', 'ثانية/بنين']],
  ['العنود مدهر', 'المهارات الحياتية والأسرية', T2],
  ['العنود مدهر', 'التربية البدنية', T2],

  ['بشاير الياسي', 'الدراسات الإسلامية', T3],
];

// ── plumbing ──────────────────────────────────────────────────────────────
let TOKEN = '';
const log = (...a: any[]) => console.log(...a);

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message ?? res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(msg)}`);
  }
  // Every response goes through a global interceptor that wraps the payload
  // as { status, message, data }. Unwrap once here so no caller has to know.
  if (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) {
    return data.data;
  }
  return data;
}

const unwrap = (r: any) =>
  Array.isArray(r) ? r
  : Array.isArray(r?.data) ? r.data
  : Array.isArray(r?.items) ? r.items
  : Array.isArray(r?.docs) ? r.docs
  : [];

const idOf = (x: any) => String(x?._id ?? x?.id ?? '');

/** Reuse a row that already exists rather than creating a duplicate. */
async function ensure(label: string, existing: any[], name: string, create: () => Promise<any>) {
  const hit = existing.find((e: any) => (e.name ?? e.subjectName) === name);
  if (hit) { log(`   ↺ ${label} موجود: ${name}`); return idOf(hit); }
  if (DRY) { log(`   + ${label} (dry): ${name}`); return `DRY_${name}`; }
  const made = await create();
  log(`   ✔ ${label}: ${name}`);
  return idOf(made);
}

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة، مش في الملف.');
    process.exit(1);
  }

  log(DRY ? '🔍 تجربة — مش هيكتب حاجة\n' : '✍️  تنفيذ فعلي\n');
  log(`API: ${API}`);

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;
  log(`دخلنا: ${auth.user?.name ?? auth.user?.email ?? email} (${auth.user?.role})`);
  if (!TOKEN) {
    throw new Error(`مفيش accessToken في الرد: ${JSON.stringify(auth).slice(0, 200)}`);
  }
  if (!['OWNER', 'SUPERVISOR', 'MANAGER'].includes(auth.user?.role)) {
    throw new Error(`الدور "${auth.user?.role}" مش كفاية — محتاج OWNER`);
  }

  // ── 0. the week ─────────────────────────────────────────────────────────
  log('\n0. الأسبوع الدراسي');
  if (!DRY) {
    await call('PATCH', '/schools/me/settings', { periodsPerDay: 8, workSchedule: WEEK });
  }
  log('   ✔ 8،8،8،8،6 = 38 خانة');

  // ── 1. year + term ──────────────────────────────────────────────────────
  const year = await call('GET', '/academic-years/active');
  const yearId = idOf(year);
  if (!yearId) throw new Error('مفيش سنة دراسية نشطة — اعملها الأول');
  log(`\n1. السنة النشطة: ${year?.name}`);

  const terms = unwrap(await call('GET', `/terms/by-year/${yearId}`));
  if (terms.length === 0) throw new Error('مفيش ترمات في السنة دي — اعملها الأول');
  const term = terms.find((t: any) => t.order === 1) ?? terms[0];
  const termId = idOf(term);
  log(`   الترم: ${term.name}`);

  // ── 2. stages + grades ──────────────────────────────────────────────────
  log('\n2. المراحل والصفوف');
  const gradeIds: Record<string, string> = {};
  const stages = unwrap(await call('GET', '/stages'));
  for (const st of STAGES) {
    const stageId = await ensure('مرحلة', stages, st.name, () =>
      call('POST', '/stages', { name: st.name, order: st.order }));
    const grades = DRY ? [] : unwrap(await call('GET', '/grade-levels'));
    for (const g of st.grades) {
      gradeIds[g.name] = await ensure('صف', grades, g.name, () =>
        call('POST', '/grade-levels', { stageId, name: g.name, order: g.order }));
    }
  }

  // ── 3. classes ──────────────────────────────────────────────────────────
  log('\n3. الفصول');
  const existingClasses = unwrap(await call('GET', '/classes'));
  for (const c of CLASSES) {
    await ensure('فصل', existingClasses, c.name, () =>
      call('POST', '/classes', {
        name: c.name, gradeLevelId: gradeIds[c.grade], gender: c.gender,
        academicYearId: yearId, maxCapacity: 30, isActive: true,
      }));
  }

  // ── 4. subjects ─────────────────────────────────────────────────────────
  log('\n4. المواد');
  const allSubjects = [...new Set(Object.values(PLAN).flat().map((r) => r[0]))];
  const existingSubjects = unwrap(await call('GET', '/subjects'));
  for (const name of allSubjects) {
    await ensure('مادة', existingSubjects, name, () =>
      call('POST', '/subjects', { subjectName: name }));
  }

  // ── 5. the plan ─────────────────────────────────────────────────────────
  log('\n5. الخطة الدراسية');
  for (const [grade, rows] of Object.entries(PLAN)) {
    const text = rows.map(([n, p]) => `${n}\t${p}`).join('\n');
    const total = rows.reduce((s, r) => s + r[1], 0);
    const gradeLevelId = gradeIds[grade];

    // On a dry run against a school that has none of these grades yet, the id
    // is a placeholder — there is nothing real to check the plan against.
    if (gradeLevelId.startsWith('DRY_')) {
      log(`   ${grade}: ${total} حصة  (الصف لسه متعملش — مش هينفع نتأكد من الخطة دلوقتي)`);
      continue;
    }

    const report = await call('POST', '/subject-offerings/import-plan', {
      termId, gradeLevelId, text, dryRun: DRY,
    });
    const parsed = report?.rows ?? report?.lines ?? [];
    const unmatched = parsed.filter((r: any) => !r.subjectId && !r.matched);
    log(`   ${grade}: ${total} حصة${unmatched.length ? `  ⚠️ ${unmatched.length} سطر مش متطابق: ${unmatched.map((u: any) => u.name ?? u.raw).join('، ')}` : '  ✔'}`);
  }

  // ── 6. teachers ─────────────────────────────────────────────────────────
  log('\n6. المعلمات');
  const existingTeachers = unwrap(await call('GET', '/teachers'));
  for (const name of TEACHERS) {
    await ensure('معلمة', existingTeachers, name, () =>
      call('POST', '/teachers', {
        name,
        email: `${name.replace(/\s+/g, '.')}@mwahb.sa`,
        password: 'Mwahb@1448',
        isActive: true,
      }));
  }

  // ── 7. assignments ──────────────────────────────────────────────────────
  log('\n7. الإسناد');
  const classRows = unwrap(await call('GET', '/classes'));
  const teacherRows = unwrap(await call('GET', '/teachers'));
  const offeringRows = unwrap(await call('GET', `/subject-offerings/by-term/${termId}`));
  const existingAssignments = unwrap(await call('GET', '/teacher-assignments'));

  const classByName = new Map(classRows.map((c: any) => [c.name, c]));
  const teacherByName = new Map(teacherRows.map((t: any) => [t.name, idOf(t)]));

  // Offerings are keyed by grade + subject; a class points at its grade.
  const offeringFor = (gradeLevelId: string, subjectName: string) =>
    offeringRows.find(
      (o: any) =>
        String(o.gradeLevelId?._id ?? o.gradeLevelId) === String(gradeLevelId) &&
        (o.subjectId?.subjectName ?? o.subjectName) === subjectName,
    );

  const already = new Set(
    existingAssignments.map(
      (a: any) =>
        `${String(a.teacherId?._id ?? a.teacherId)}|` +
        `${String(a.subjectOfferingId?._id ?? a.subjectOfferingId)}|` +
        `${a.classId ? String(a.classId?._id ?? a.classId) : ''}`,
    ),
  );

  let made = 0, skipped = 0;
  const failures: string[] = [];

  for (const [teacherName, subjectName, classNames] of ASSIGNMENTS) {
    const teacherId = teacherByName.get(teacherName);
    if (!teacherId) { failures.push(`معلمة مش موجودة: ${teacherName}`); continue; }

    for (const className of classNames) {
      const klass: any = classByName.get(className);
      if (!klass) { failures.push(`فصل مش موجود: ${className}`); continue; }

      const gradeLevelId = String(klass.gradeLevelId?._id ?? klass.gradeLevelId);
      const offering = offeringFor(gradeLevelId, subjectName);
      if (!offering) {
        failures.push(`مفيش عرض لـ "${subjectName}" في صف ${className}`);
        continue;
      }

      const key = `${teacherId}|${idOf(offering)}|${idOf(klass)}`;
      if (already.has(key)) { skipped++; continue; }
      if (DRY) { made++; continue; }

      try {
        await call('POST', '/teacher-assignments', {
          teacherId,
          subjectOfferingId: idOf(offering),
          // Always pinned: two teachers share a subject across a grade all
          // over this sheet, and grade-wide would put both in both rooms.
          classId: idOf(klass),
        });
        made++;
      } catch (e: any) {
        failures.push(`${teacherName} · ${subjectName} · ${className}: ${e.message.slice(-90)}`);
      }
    }
  }

  log(`   ✔ ${made} إسناد${skipped ? `   ↺ ${skipped} موجود` : ''}`);
  if (failures.length) {
    log(`   ⚠️ ${failures.length} مشكلة:`);
    for (const f of failures.slice(0, 15)) log(`      · ${f}`);
  }

  // ── 8. feasibility ──────────────────────────────────────────────────────
  log('\n8. فحص الجدوى');
  const f = await call('GET', `/lectures/feasibility?termId=${termId}`);
  log(`   خانات الأسبوع: ${f.slotsPerWeek}`);
  const problems = f.problems ?? [];
  if (problems.length === 0) log('   ✅ مفيش مشاكل — جاهز للتوليد');
  else {
    log(`   ⚠️ ${problems.length} مشكلة:`);
    for (const p of problems.slice(0, 12)) log(`      · ${p.message}`);
  }

  log(DRY
    ? '\n🔍 تجربة خلصت — مكتبناش حاجة.'
    : '\n✅ خلص. لو فحص الجدوى نضيف، ولّد:\n' +
      '   POST /lectures/generate  { "termId": "' + termId + '", "mode": "preview" }');
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
