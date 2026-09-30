#!/usr/bin/env node
/**
 * Checks a stage-specific school day end to end, against a test school.
 *
 * Run it after seed-test-school.mjs has built the school. It sets the
 * kindergarten's day itself, reads the numbers back, and — the part that
 * matters — confirms the primary stage did not move. Then it clears the
 * value again and confirms everything returns, so the run leaves the school
 * as it found it.
 *
 *   API=... TERM=... KG=... PRIMARY=... EMAIL=... PW=... \
 *     node scripts-qa/verify-stage-day.mjs
 *
 * Never point this at a real school: it writes to a stage.
 */

const API     = process.env.API     || 'https://api.nasaqedu.org';
const TERM    = process.env.TERM;
const KG      = process.env.KG;       // kindergarten classId
const PRIMARY = process.env.PRIMARY;  // primary classId
const EMAIL   = process.env.EMAIL;
const PW      = process.env.PW;

if (!TERM || !KG || !PRIMARY || !EMAIL || !PW) {
  console.error('Missing env: TERM, KG, PRIMARY, EMAIL, PW — see seed-test-school.mjs output');
  process.exit(2);
}

const c = { g:'\x1b[32m', r:'\x1b[31m', d:'\x1b[2m', b:'\x1b[1m', x:'\x1b[0m' };
let pass = 0, fail = 0;
const fails = [];
const ok  = (m, extra='') => { pass++; console.log(`  ${c.g}✓${c.x} ${m}${extra?c.d+' — '+extra+c.x:''}`); };
const no  = (m, why)      => { fail++; fails.push(`${m} — ${why}`); console.log(`  ${c.r}✗${c.x} ${m}\n      ${c.r}${why}${c.x}`); };
const check = (m, cond, why) => cond ? ok(m) : no(m, why);

let TOKEN = '';
async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type':'application/json', ...(TOKEN?{Authorization:`Bearer ${TOKEN}`}:{}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.message ?? '')}`);
  return (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) ? data.data : data;
}
const idOf = (v) => String(v?._id ?? v?.id ?? v ?? '');
const rows = (f) => Object.fromEntries((f.classes ?? []).map((r) => [String(r.classId), r]));

async function main() {
  console.log(`${c.b}فحص يوم المرحلة${c.x}\n${c.d}${API}${c.x}\n`);

  const auth = await call('POST', '/auth/login', { identifier: EMAIL, password: PW });
  TOKEN = auth?.accessToken;
  if (!TOKEN) { no('login', 'no accessToken'); return report(); }

  const stages = await call('GET', '/stages');
  const kgStage = (Array.isArray(stages)?stages:[]).find((s) => String(s.name).includes('روضة'));
  if (!kgStage) { no('found the KG stage', 'no stage named روضة'); return report(); }
  const kgStageId = idOf(kgStage);

  // ── baseline ───────────────────────────────────────────────────────────
  console.log(`${c.b}قبل${c.x}`);
  const before = rows(await call('GET', `/lectures/feasibility?termId=${TERM}`));
  const kgBefore = before[KG]?.capacity;
  const prBefore = before[PRIMARY]?.capacity;
  ok('قراءة خط الأساس', `روضة=${kgBefore} ابتدائي=${prBefore}`);
  check('المرحلتان متساويتان قبل التغيير', kgBefore === prBefore,
        `روضة=${kgBefore} ابتدائي=${prBefore} — كان يُفترض أن تتبعا المدرسة معًا`);

  // ── set the KG day ─────────────────────────────────────────────────────
  console.log(`\n${c.b}ضبط يوم الروضة على ١٤${c.x}`);
  await call('PATCH', `/stages/${kgStageId}`, { periodsPerDay: 14, periodMinutes: 30 });

  const saved = (Array.isArray(await call('GET', '/stages')) ? await call('GET','/stages') : [])
    .find((s) => idOf(s) === kgStageId);
  check('الرقم حُفظ', Number(saved?.periodsPerDay) === 14, `القيمة المقروءة ${saved?.periodsPerDay}`);
  check('طول الحصة حُفظ', Number(saved?.periodMinutes) === 30, `القيمة ${saved?.periodMinutes}`);

  const after = rows(await call('GET', `/lectures/feasibility?termId=${TERM}`));
  const kgAfter = after[KG]?.capacity;
  const prAfter = after[PRIMARY]?.capacity;

  console.log(`\n${c.b}بعد${c.x}`);
  // 14 on full days, and Thursday scaled: 6/8 of 14 = 10.5 → 10.
  check('سعة الروضة صارت ٦٦', kgAfter === 66,
        `الناتج ${kgAfter} — المتوقع ١٤×٤ + ١٠ (الخميس مقيسًا بالنسبة)`);
  check('الابتدائي لم يتحرك', prAfter === prBefore,
        `كان ${prBefore} وصار ${prAfter} — هذا انحدار، وهو ما صُمّم التحديث كي لا يحدث`);

  // ── the other stage must still be untouched ────────────────────────────
  const stagesNow = await call('GET', '/stages');
  const others = (Array.isArray(stagesNow)?stagesNow:[]).filter((s) => idOf(s) !== kgStageId);
  check('لم يُكتب رقم في مرحلة أخرى',
        others.every((s) => s.periodsPerDay === null || s.periodsPerDay === undefined),
        `مرحلة أخرى تحمل الآن: ${others.map((s)=>`${s.name}=${s.periodsPerDay}`).join(', ')}`);

  // ── undo ───────────────────────────────────────────────────────────────
  console.log(`\n${c.b}التراجع${c.x}`);
  await call('PATCH', `/stages/${kgStageId}`, { periodsPerDay: null, periodMinutes: null });
  const reverted = rows(await call('GET', `/lectures/feasibility?termId=${TERM}`));
  check('مسح الرقم أعاد السعة', reverted[KG]?.capacity === kgBefore,
        `بقيت ${reverted[KG]?.capacity} بدل ${kgBefore} — القيمة لا تُمسح، فالمدرسة التي تجرّب تكون قد التزمت`);

  report();
}

function report() {
  console.log(`\n${c.b}${'─'.repeat(50)}${c.x}`);
  console.log(`${c.g}${pass} نجح${c.x}   ${fail?c.r:c.d}${fail} فشل${c.x}`);
  if (fails.length) {
    console.log(`\n${c.r}${c.b}ما هو معطّل${c.x}`);
    fails.forEach((f, i) => console.log(`  ${i+1}. ${f}`));
  } else console.log(`\n${c.g}يوم المرحلة يعمل، والمراحل الأخرى لم تتأثر.${c.x}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(`\n${c.r}توقف: ${e.message}${c.x}`); process.exit(2); });
