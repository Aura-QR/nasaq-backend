export {};
/**
 * Creates the missing fee configs that block student enrolment.
 *
 * Enrolment calls assertCanCreateRecord, which refuses when there is no
 * FeeConfig for (academicYear, gradeLevel) — so a school whose classes point at
 * a grade level with no config cannot add a single student.
 *
 * Dry run by default. Pass --commit to write.
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const COMMIT = process.argv.includes('--commit');
const FEE = Number(process.env.TUITION_FEE ?? 11000);
let T = '';

async function call(m: string, p: string, b?: any) {
  const r = await fetch(`${API}${p}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(T ? { Authorization: `Bearer ${T}` } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const t = await r.text(); let d: any; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${m} ${p} → ${r.status}: ${JSON.stringify(d?.message)}`);
  return d?.data ?? d;
}
const arr = (x: any) => (Array.isArray(x) ? x : (x?.data ?? []));

(async () => {
  const email = process.env.NASAQ_EMAIL, password = process.env.NASAQ_PASSWORD;
  if (!email || !password) { console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD'); process.exit(1); }
  T = (await call('POST', '/auth/login', { identifier: email, password })).accessToken;

  const year = await call('GET', '/academic-years/active');
  const yid = String(year._id ?? year.id);
  console.log(`السنة النشطة : ${year.name}`);
  console.log(`الرسوم        : ${FEE.toLocaleString()} (غيّرها بـ TUITION_FEE)\n`);

  const classes = arr(await call('GET', '/classes?limit=200'));
  const configs = arr(await call('GET', '/financial/fee-configs'));

  const needed = new Map<string, { name: string; classes: string[] }>();
  for (const c of classes) {
    if (String(c.academicYearId?._id ?? c.academicYearId) !== yid) continue;
    const gid = String(c.gradeLevelId?._id ?? c.gradeLevelId);
    if (!needed.has(gid)) needed.set(gid, { name: c.gradeLevelId?.name ?? gid, classes: [] });
    needed.get(gid)!.classes.push(c.name);
  }

  const missing: [string, { name: string; classes: string[] }][] = [];
  for (const [gid, v] of needed) {
    const has = configs.some(
      (c: any) => String(c.academicYearId?._id ?? c.academicYearId) === yid &&
                  String(c.gradeLevelId?._id ?? c.gradeLevelId) === gid,
    );
    console.log(`  ${has ? '✅ موجود' : '➕ هيتعمل'}  ${v.name.padEnd(16)} فصول: ${v.classes.join('، ')}`);
    if (!has) missing.push([gid, v]);
  }

  if (!missing.length) { console.log('\nمفيش ناقص.'); return; }
  if (!COMMIT) { console.log(`\n[معاينة] ${missing.length} معيار هيتعمل. ضيف --commit للتنفيذ.`); return; }

  console.log('\nبعمل...');
  let ok = 0;
  for (const [gid, v] of missing) {
    try {
      await call('POST', '/financial/fee-configs', {
        academicYearId: yid, gradeLevelId: gid, tuitionFee: FEE, expatriateSurchargePercentage: 0,
      });
      ok++; console.log(`  ✅ ${v.name}`);
    } catch (e: any) { console.log(`  ❌ ${v.name}: ${e.message}`); }
  }
  console.log(`\nاتعمل: ${ok} من ${missing.length}`);
})().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
