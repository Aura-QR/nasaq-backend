export {};
/**
 * Removes two kinds of leftover that confuse a school's own staff:
 *
 *   1. Grade levels nothing references — duplicates of the real ones, created
 *      during setup. One of them held the school's only fee config while every
 *      class sat on its twin, which blocked enrolment entirely.
 *   2. Enrolments whose student was deleted. They point at nothing and are
 *      counted by anything that reads enrolments.
 *
 * Only ever touches rows with zero references. Dry run by default.
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const COMMIT = process.argv.includes('--commit');
let TOKEN = '';

async function call(m: string, p: string, b?: any) {
  const r = await fetch(`${API}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text(); let d: any; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${m} ${p} → ${r.status}: ${JSON.stringify(d?.message)}`);
  return d?.data ?? d;
}
const arr = (x: any) => (Array.isArray(x) ? x : (x?.data ?? []));
const idOf = (x: any) => String(x?._id ?? x ?? '');

(async () => {
  const email = process.env.NASAQ_EMAIL, password = process.env.NASAQ_PASSWORD;
  if (!email || !password) { console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD'); process.exit(1); }
  TOKEN = (await call('POST', '/auth/login', { identifier: email, password })).accessToken;

  // ── 1. grade levels with no reference anywhere ──────────────────────────
  const grades = arr(await call('GET', '/grade-levels'));
  const classes = arr(await call('GET', '/classes?limit=300'));
  const cfgs = arr(await call('GET', '/financial/fee-configs'));
  const years = arr(await call('GET', '/academic-years'));

  const used = new Set<string>();
  for (const c of classes) used.add(idOf(c.gradeLevelId));
  for (const c of cfgs) used.add(idOf(c.gradeLevelId));
  for (const y of years) {
    for (const t of arr(await call('GET', `/terms/by-year/${idOf(y)}`))) {
      for (const o of arr(await call('GET', `/subject-offerings/by-term/${idOf(t)}`))) {
        used.add(idOf(o.gradeLevelId));
      }
    }
  }
  const orphanGrades = grades.filter((g: any) => !used.has(idOf(g)));

  console.log(`صفوف دراسية : ${grades.length}  — بلا أي مرجع: ${orphanGrades.length}`);
  for (const g of orphanGrades) console.log(`   🗑️  ${g.name}   ${idOf(g)}`);

  // ── 2. enrolments whose student is gone ─────────────────────────────────
  const enrolments = arr(await call('GET', '/enrollments'));
  const dead = enrolments.filter((e: any) => !idOf(e.studentId) || idOf(e.studentId) === 'null');
  console.log(`\nتسجيلات    : ${enrolments.length}  — طالبها اتمسح: ${dead.length}`);
  for (const e of dead.slice(0, 15)) console.log(`   🗑️  ${idOf(e)}  سنة: ${e.academicYearId?.name ?? '—'}  حالة: ${e.status}`);

  if (!orphanGrades.length && !dead.length) { console.log('\nمفيش حاجة تتمسح.'); return; }
  if (!COMMIT) { console.log('\n[معاينة] مفيش حاجة اتمسحت. ضيف --commit للتنفيذ.'); return; }

  console.log('\nبمسح...');
  let g1 = 0, e1 = 0;
  for (const g of orphanGrades) {
    try { await call('DELETE', `/grade-levels/${idOf(g)}`); g1++; console.log(`  ✅ صف: ${g.name}`); }
    catch (err: any) { console.log(`  ❌ صف: ${g.name} — ${err.message}`); }
  }
  for (const e of dead) {
    try { await call('DELETE', `/enrollments/${idOf(e)}`); e1++; }
    catch (err: any) { console.log(`  ❌ تسجيل ${idOf(e)} — ${err.message}`); }
  }
  console.log(`\nصفوف اتمسحت: ${g1}/${orphanGrades.length}   تسجيلات: ${e1}/${dead.length}`);
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
