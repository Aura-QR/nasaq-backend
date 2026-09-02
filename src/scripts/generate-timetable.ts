/**
 * Builds the timetable for the active term.
 *
 * Checks feasibility first and refuses to write when something blocking is
 * wrong, because a run that half-fills a grid is harder to reason about than
 * one that never started. Preview by default; --commit writes.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run generate:timetable
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run generate:timetable -- --commit
 *   … -- --commit --replace     # rebuild classes that already have lectures
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const COMMIT = process.argv.includes('--commit');
const REPLACE = process.argv.includes('--replace');

let TOKEN = '';

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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.message ?? res.statusText)}`);
  if (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) return data.data;
  return data;
}

const unwrap = (r: any) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);
const idOf = (x: any) => String(x?._id ?? x?.id ?? '');

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;

  const year = await call('GET', '/academic-years/active');
  const terms = unwrap(await call('GET', `/terms/by-year/${idOf(year)}`));
  const term = terms.find((t: any) => t.order === 1) ?? terms[0];
  if (!term) throw new Error('مفيش ترم في السنة النشطة');
  const termId = idOf(term);
  console.log(`السنة: ${year?.name}   الترم: ${term.name}\n`);

  const f = await call('GET', `/lectures/feasibility?termId=${termId}`);
  console.log(`أيام العمل   : ${f.workingDays?.join('، ')}`);
  console.log(`حصص اليوم    : ${f.uniformWeek === false
    ? Object.entries(f.periodsByDay ?? {}).map(([d, n]) => `${d}=${n}`).join('، ')
    : f.periodsPerDay}`);
  console.log(`خانات الأسبوع: ${f.slotsPerWeek}\n`);

  const problems = f.problems ?? [];
  const blocking = problems.filter((p: any) => p.blocking);

  if (problems.length) {
    console.log(`مشاكل: ${problems.length} (منها ${blocking.length} مانعة)`);
    for (const p of problems.slice(0, 20)) {
      console.log(`   ${p.blocking ? '❌' : '⚠️ '} ${p.message}`);
    }
    console.log('');
  } else {
    console.log('✅ فحص الجدوى نضيف\n');
  }

  if (blocking.length && COMMIT) {
    console.log('❌ مش هيكتب — صلّح المشاكل المانعة الأول.');
    console.log('   (شغّلها من غير --commit عشان تشوف المعاينة برضه)');
    process.exit(2);
  }

  const mode = COMMIT ? 'commit' : 'preview';
  console.log(`${COMMIT ? '✍️  الحفظ' : '👁️  معاينة — مش بيكتب حاجة'}\n`);

  const result = await call('POST', '/lectures/generate', {
    termId,
    mode,
    onExisting: REPLACE ? 'replace' : 'skip',
  });

  console.log(`اتحطت      : ${result.placed}`);
  console.log(`مالقتش مكان: ${result.unplaced}`);
  if (COMMIT) {
    console.log(`اتكتبت     : ${result.written}`);
    console.log(`فشلت       : ${result.failed}`);
    if (result.deleted) console.log(`اتمسحت     : ${result.deleted}`);
    if (result.skippedClasses) console.log(`فصول اتخطت : ${result.skippedClasses}`);
  }

  const gen = result.problems ?? [];
  if (gen.length) {
    console.log(`\nملاحظات التوليد: ${gen.length}`);
    for (const p of gen.slice(0, 15)) console.log(`   · ${p.message}`);
  }

  console.log('\nلكل فصل:');
  for (const c of result.classes ?? []) {
    const filled = (c.days ?? []).reduce(
      (n: number, d: any) => n + d.slots.filter((s: any) => s.subjectOfferingId).length, 0);
    const total = (c.days ?? []).reduce((n: number, d: any) => n + d.slots.length, 0);
    console.log(`   ${String(c.className).padEnd(20)} ${String(filled).padStart(2)}/${total}`);
  }

  console.log(COMMIT
    ? '\n✅ اتحفظ. شوفه من شاشة الجدول.'
    : '\n👁️  دي معاينة. لو عاجباك: أضف --commit');
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
