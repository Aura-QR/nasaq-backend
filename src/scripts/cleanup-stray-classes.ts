/**
 * Leaves only the eleven classes from the أنصبة sheet in play.
 *
 * The school had eight classes from earlier setup — kindergarten, تمهيدي, a
 * duplicate first grade, and a "grade5" carrying 25 lectures. The generator
 * would try to build a timetable for all of them, and none has a teaching
 * plan, so each becomes noise in the feasibility report.
 *
 * A class with nothing attached is deleted. A class carrying lectures or
 * students is only deactivated: the generator skips inactive classes, so the
 * outcome is the same, and nobody loses work to a cleanup script.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run cleanup:classes -- --dry-run
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run cleanup:classes
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const DRY = process.argv.includes('--dry-run');

/** The eleven from the sheet. Everything else is from before. */
const KEEP = [
  'أولى/بنات', 'أولى/بنين', 'ثانية/بنات ١', 'ثانية/بنات ٢', 'ثانية/بنين',
  'ثالثة/بنات', 'ثالثة/بنين', 'رابعة/بنات', 'خامسة/بنات', 'سادسة',
  'أولى متوسط/بنات',
];

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
const nameOf = (x: any) => String(x?.name ?? x?.className ?? '');

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }

  console.log(DRY ? '🔍 تجربة — مش هيغيّر حاجة\n' : '🧹 تنفيذ\n');

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;

  const classes = unwrap(await call('GET', '/classes'));
  const lectures = unwrap(await call('GET', '/lectures'));
  const byClass = new Map<string, number>();
  for (const l of lectures) {
    const k = String(l.classId?._id ?? l.classId);
    byClass.set(k, (byClass.get(k) ?? 0) + 1);
  }

  const stray = classes.filter((c: any) => !KEEP.includes(nameOf(c)));
  console.log(`فصول: ${classes.length}   بتاعتنا: ${classes.length - stray.length}   قدام: ${stray.length}\n`);

  const toDelete = stray.filter((c: any) => (byClass.get(idOf(c)) ?? 0) === 0);
  const toDisable = stray.filter((c: any) => (byClass.get(idOf(c)) ?? 0) > 0);

  console.log(`هيتمسح (فاضي تماماً): ${toDelete.length}`);
  for (const c of toDelete) console.log(`   ✖ ${nameOf(c)}`);
  console.log(`\nهيتوقف (عليه حصص): ${toDisable.length}`);
  for (const c of toDisable) console.log(`   ⏸ ${nameOf(c)} — ${byClass.get(idOf(c))} حصة`);

  if (DRY) { console.log('\n🔍 مكتبناش حاجة. شيل --dry-run للتنفيذ.'); return; }

  let del = 0, off = 0;
  const failed: string[] = [];
  for (const c of toDelete) {
    try { await call('DELETE', `/classes/${idOf(c)}`); del++; }
    catch (e: any) { failed.push(`حذف ${nameOf(c)}: ${e.message.slice(-80)}`); }
  }
  for (const c of toDisable) {
    try { await call('PATCH', `/classes/${idOf(c)}`, { isActive: false }); off++; }
    catch (e: any) { failed.push(`إيقاف ${nameOf(c)}: ${e.message.slice(-80)}`); }
  }

  console.log(`\n✅ اتمسح ${del}   اتوقف ${off}`);
  if (failed.length) { console.log('فشل:'); failed.forEach((f) => console.log('   · ' + f)); }

  const after = unwrap(await call('GET', '/classes'));
  const active = after.filter((c: any) => c.isActive !== false);
  console.log(`الفصول دلوقتي: ${after.length} (النشط منها ${active.length})`);
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });

// Marks this file a module so its top-level names do not collide with the
// other standalone scripts, which TypeScript would otherwise treat as one
// shared global scope.
export {};
