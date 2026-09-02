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
  { name: 'أولى/بنات',        grade: 'الصف الأول' },
  { name: 'أولى/بنين',        grade: 'الصف الأول' },
  { name: 'ثانية/بنات ١',     grade: 'الصف الثاني' },
  { name: 'ثانية/بنات ٢',     grade: 'الصف الثاني' },
  { name: 'ثانية/بنين',       grade: 'الصف الثاني' },
  { name: 'ثالثة/بنات',       grade: 'الصف الثالث' },
  { name: 'ثالثة/بنين',       grade: 'الصف الثالث' },
  { name: 'رابعة/بنات',       grade: 'الصف الرابع' },
  { name: 'خامسة/بنات',       grade: 'الصف الخامس' },
  { name: 'سادسة',            grade: 'الصف السادس' },
  { name: 'أولى متوسط/بنات',  grade: 'الأول متوسط' },
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
  return data;
}

const unwrap = (r: any) =>
  Array.isArray(r) ? r
  : Array.isArray(r?.data) ? r.data
  : Array.isArray(r?.data?.data) ? r.data.data
  : Array.isArray(r?.items) ? r.items
  : [];

const idOf = (x: any) => String(x?._id ?? x?.id ?? '');

/** Reuse a row that already exists rather than creating a duplicate. */
async function ensure(label: string, existing: any[], name: string, create: () => Promise<any>) {
  const hit = existing.find((e: any) => (e.name ?? e.subjectName) === name);
  if (hit) { log(`   ↺ ${label} موجود: ${name}`); return idOf(hit); }
  if (DRY) { log(`   + ${label} (dry): ${name}`); return `DRY_${name}`; }
  const made = await create();
  log(`   ✔ ${label}: ${name}`);
  return idOf(made?.data ?? made);
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
  log(`دخلنا: ${auth.user?.name} (${auth.user?.role})`);
  if (!['OWNER', 'SUPERVISOR', 'MANAGER'].includes(auth.user?.role)) {
    throw new Error(`الدور ${auth.user?.role} مش كفاية — محتاج OWNER`);
  }

  // ── 0. the week ─────────────────────────────────────────────────────────
  log('\n0. الأسبوع الدراسي');
  if (!DRY) {
    await call('PATCH', '/schools/me/settings', { periodsPerDay: 8, workSchedule: WEEK });
  }
  log('   ✔ 8،8،8،8،6 = 38 خانة');

  // ── 1. year + term ──────────────────────────────────────────────────────
  const year = await call('GET', '/academic-years/active');
  const yearId = idOf(year?.data ?? year);
  log(`\n1. السنة النشطة: ${(year?.data ?? year)?.name}`);

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
        name: c.name, gradeLevelId: gradeIds[c.grade],
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
    const report = await call('POST', '/subject-offerings/import-plan', {
      termId, gradeLevelId: gradeIds[grade], text, dryRun: DRY,
    });
    const unmatched = (report?.rows ?? report?.data?.rows ?? [])
      .filter((r: any) => !r.matched && !r.subjectId);
    log(`   ${grade}: ${total} حصة${unmatched.length ? `  ⚠️ ${unmatched.length} سطر مش متطابق` : ''}`);
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

  // ── 7. feasibility ──────────────────────────────────────────────────────
  log('\n7. فحص الجدوى');
  const f = await call('GET', `/lectures/feasibility?termId=${termId}`);
  log(`   خانات الأسبوع: ${f.slotsPerWeek}`);
  const problems = f.problems ?? [];
  if (problems.length === 0) log('   ✅ مفيش مشاكل — جاهز للتوليد');
  else {
    log(`   ⚠️ ${problems.length} مشكلة:`);
    for (const p of problems.slice(0, 12)) log(`      · ${p.message}`);
  }

  log(DRY
    ? '\n🔍 تجربة خلصت — مكتبناش حاجة. شيل --dry-run للتنفيذ.'
    : '\n✅ خلص. فاضل الإسناد: POST /teacher-assignments/import');
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
