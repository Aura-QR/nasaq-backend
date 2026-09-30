#!/usr/bin/env node
/**
 * Builds a throwaway school with a kindergarten AND a primary stage, so the
 * stage-specific school day can be tested without touching a real school.
 *
 * Everything goes through the public API, never the database: a seed that
 * writes straight to Mongo can produce a school the app itself would have
 * refused to create, and then the test proves nothing.
 *
 * The school is created fresh each run under a timestamped slug, so it never
 * collides with a previous attempt and never touches مواهب المملكة.
 *
 *   node scripts-qa/seed-test-school.mjs
 *   API=https://api.nasaqedu.org node scripts-qa/seed-test-school.mjs
 *
 * It prints the owner credentials at the end. Log in with those and follow
 * the checks it lists.
 */

const API = process.env.API || 'https://api.nasaqedu.org';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const SCHOOL = {
  schoolName: `مدرسة اختبار ${STAMP}`,
  slug: `qa-kg-${STAMP}`,
  schoolEmail: `school.${STAMP}@qa.nasaq.test`,
  ownerName: 'مالك الاختبار',
  ownerUsername: `qa${STAMP}`.slice(0, 20),
  ownerEmail: `owner.${STAMP}@qa.nasaq.test`,
  ownerPassword: 'QaTest@2026',
};

// Deliberately NOT uniform: a short Thursday is what exercises the scaling
// rule, and a school whose week is all one number would hide a bug in it.
const WEEK = [
  { day: 'sunday',    isWorkingDay: true,  periodsPerDay: 8, startTime: '07:00', endTime: '13:00' },
  { day: 'monday',    isWorkingDay: true,  periodsPerDay: 8, startTime: '07:00', endTime: '13:00' },
  { day: 'tuesday',   isWorkingDay: true,  periodsPerDay: 8, startTime: '07:00', endTime: '13:00' },
  { day: 'wednesday', isWorkingDay: true,  periodsPerDay: 8, startTime: '07:00', endTime: '13:00' },
  { day: 'thursday',  isWorkingDay: true,  periodsPerDay: 6, startTime: '07:00', endTime: '11:00' },
  { day: 'friday',    isWorkingDay: false, periodsPerDay: null, startTime: null, endTime: null },
  { day: 'saturday',  isWorkingDay: false, periodsPerDay: null, startTime: null, endTime: null },
];

const c = { g:'\x1b[32m', r:'\x1b[31m', y:'\x1b[33m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' };
const log = (m) => console.log(m);
const ok  = (m) => console.log(`  ${c.g}✔${c.x} ${m}`);
const bad = (m) => console.log(`  ${c.r}✗${c.x} ${m}`);

let TOKEN = '';

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.message ?? res.statusText)}`);
  }
  // Global interceptor wraps every payload as { status, message, data }.
  if (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) {
    return data.data;
  }
  return data;
}

const list = (r) =>
  Array.isArray(r) ? r
  : Array.isArray(r?.data) ? r.data
  : Array.isArray(r?.items) ? r.items
  : [];
const idOf = (v) => String(v?._id ?? v?.id ?? v ?? '');

async function main() {
  log(`${c.b}مدرسة اختبار — روضة + ابتدائي${c.x}`);
  log(`${c.d}${API}${c.x}\n`);

  // ── 1. the school ──────────────────────────────────────────────────────
  log('1. إنشاء المدرسة');
  await call('POST', '/schools/register', SCHOOL);
  ok(SCHOOL.schoolName);

  const auth = await call('POST', '/auth/login', {
    identifier: SCHOOL.ownerEmail,
    password: SCHOOL.ownerPassword,
  });
  TOKEN = auth?.accessToken;
  if (!TOKEN) throw new Error('تعذر تسجيل الدخول بالحساب الجديد');
  ok('تسجيل الدخول');

  // ── 2. the week ────────────────────────────────────────────────────────
  log('\n2. الأسبوع الدراسي');
  await call('PATCH', '/schools/me/settings', { periodsPerDay: 8, workSchedule: WEEK });
  ok('٨ حصص، والخميس ٦ → ٣٨ خانة للمدرسة');

  // ── 3. year + term ─────────────────────────────────────────────────────
  log('\n3. السنة والترم');
  let year = await call('GET', '/academic-years/active').catch(() => null);
  let yearId = idOf(year);
  if (!yearId) {
    year = await call('POST', '/academic-years', {
      name: '2026/2027', startDate: '2026-09-01', endDate: '2027-06-30',
    });
    yearId = idOf(year);
  }
  ok(`السنة: ${year?.name ?? yearId}`);

  let terms = list(await call('GET', `/terms/by-year/${yearId}`).catch(() => []));
  if (terms.length === 0) {
    await call('POST', '/terms', {
      academicYearId: yearId, name: 'الترم الأول', order: 1,
      startDate: '2026-09-01', endDate: '2027-01-15',
    });
    terms = list(await call('GET', `/terms/by-year/${yearId}`));
  }
  const termId = idOf(terms.find((t) => t.order === 1) ?? terms[0]);
  ok(`الترم: ${(terms[0] || {}).name ?? termId}`);

  // ── 4. two stages ──────────────────────────────────────────────────────
  //
  // Both created WITHOUT periodsPerDay, which is the state every stage in
  // every existing school is in. The test then sets it on one of them only.
  log('\n4. المرحلتان');
  const kgStage = await call('POST', '/stages', { name: 'روضة', order: 1 });
  const primaryStage = await call('POST', '/stages', { name: 'ابتدائي', order: 2 });
  ok('روضة — بلا يوم خاص (تتبع المدرسة)');
  ok('ابتدائي — بلا يوم خاص');

  log('\n5. الصفوف');
  const kgGrade = await call('POST', '/grade-levels', {
    stageId: idOf(kgStage), name: 'تمهيدي', order: 1,
  });
  const primaryGrade = await call('POST', '/grade-levels', {
    stageId: idOf(primaryStage), name: 'الصف الأول', order: 2,
  });
  ok('تمهيدي · الصف الأول');

  log('\n6. الفصول');
  const kgClass = await call('POST', '/classes', {
    name: 'تمهيدي/أ', gradeLevelId: idOf(kgGrade), academicYearId: yearId,
    gender: 'both', maxCapacity: 25,
  });
  const primaryClass = await call('POST', '/classes', {
    name: 'أولى/أ', gradeLevelId: idOf(primaryGrade), academicYearId: yearId,
    gender: 'both', maxCapacity: 30,
  });
  ok('تمهيدي/أ · أولى/أ');

  // ── 7. subjects ────────────────────────────────────────────────────────
  //
  // Activities are ordinary subjects — the same thing مواهب did on its own,
  // and what the KG day is actually made of.
  log('\n7. المواد');
  const SUBJECTS = ['لقاء صباحي', 'وجبة', 'لعب ونشاط', 'نقرأ ونكتب', 'نعد ونحسب', 'الرياضيات', 'اللغة العربية'];
  const subjects = {};
  for (const name of SUBJECTS) {
    const s = await call('POST', '/subjects', { subjectName: name });
    subjects[name] = idOf(s);
  }
  ok(`${SUBJECTS.length} مواد (منها ٣ أنشطة روضة)`);

  log('\n' + '─'.repeat(54));
  log(`${c.b}المدرسة جاهزة${c.x}\n`);
  log(`  الرابط:     ${API.replace('api.', '')}`);
  log(`  الحساب:     ${SCHOOL.ownerEmail}`);
  log(`  كلمة السر:  ${SCHOOL.ownerPassword}`);
  log('');
  log(`  ${c.d}stageId روضة:    ${idOf(kgStage)}${c.x}`);
  log(`  ${c.d}stageId ابتدائي: ${idOf(primaryStage)}${c.x}`);
  log(`  ${c.d}classId تمهيدي:  ${idOf(kgClass)}${c.x}`);
  log(`  ${c.d}classId أولى:    ${idOf(primaryClass)}${c.x}`);
  log(`  ${c.d}termId:          ${termId}${c.x}`);

  // ── the baseline, measured rather than assumed ─────────────────────────
  log(`\n${c.b}خط الأساس — قبل أي تغيير${c.x}`);
  const before = await call('GET', `/lectures/feasibility?termId=${termId}`);
  log(`  سعة الأسبوع للمدرسة: ${c.b}${before.slotsPerWeek}${c.x}  ${c.d}(٨×٤ + ٦)${c.x}`);
  for (const row of before.classes ?? []) {
    log(`    ${row.name}: capacity=${row.capacity}`);
  }
  if (before.slotsPerWeek === 38) ok('٣٨ كما هو متوقع');
  else bad(`المتوقع ٣٨ والناتج ${before.slotsPerWeek}`);

  log(`\n${c.b}الخطوة التالية — يدويًا${c.x}`);
  log(`  ١. سجّل الدخول بالحساب أعلاه`);
  log(`  ٢. المراحل ← روضة ← حصص اليوم = ${c.b}14${c.x}، طول الحصة = 30`);
  log(`  ٣. أعد فحص الجدول وقارن:`);
  log(`       تمهيدي/أ  يجب أن تصير ${c.b}66${c.x}  ${c.d}(١٤×٤ + ١٠ للخميس)${c.x}`);
  log(`       أولى/أ    يجب أن تبقى ${c.b}38${c.x}  ${c.d}← الأهم${c.x}`);
  log(`  ٤. ثم امسح الرقم وتأكد أن ٦٦ ترجع ٣٨`);
  log('');
  log(`  ${c.d}لإعادة الفحص آليًا بعد الخطوة ٢:${c.x}`);
  log(`  API=${API} TERM=${termId} KG=${idOf(kgClass)} PRIMARY=${idOf(primaryClass)} \\`);
  log(`    EMAIL=${SCHOOL.ownerEmail} PW='${SCHOOL.ownerPassword}' \\`);
  log(`    node scripts-qa/verify-stage-day.mjs`);
}

main().catch((e) => { console.error(`\n${c.r}توقف: ${e.message}${c.x}`); process.exit(1); });
