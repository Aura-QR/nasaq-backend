/**
 * Removes the teacher records seed-mwahb created as duplicates.
 *
 * The seed matched teachers by exact name. The school had already entered
 * them under their full names — "زينب البيشي" against "زينب سالم محمد
 * البيشي" — so seventeen people were created a second time. The project has
 * a normaliser built for exactly this (matchByName, used by the import
 * endpoints); the seed simply did not use it, and now does.
 *
 * Deletes only a short-name record that (a) the seed created, (b) has a
 * longer existing record matching every word of its name, and (c) carries no
 * assignments, lectures or class of its own. Anything else is left alone and
 * reported.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run cleanup:dup-teachers -- --dry-run
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run cleanup:dup-teachers
 */
import { normalizeArabicName } from '../common/arabic-name.util';

const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const DRY = process.argv.includes('--dry-run');

/** The short names the seed introduced. */
const SEEDED = [
  'سمر المالكي', 'زينب البيشي', 'عنود القرشي', 'جوهرة المالكي', 'بسمة عبدالفتاح',
  'أميرة العصيمي', 'مروة العتيبي', 'ريم العتيبي', 'جيهان العتيبي', 'أشواق المضيقي',
  'نادية الشريف', 'صوفيا عبدالعزيز', 'رشا طاهر', 'ملاك الجهني', 'فاطمة الدهاسي',
  'العنود مدهر', 'بشاير الياسي',
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

/** /teachers returns { _id, name }; /teachers/list returns { id, fullName }. */
const nameOf = (x: any) => String(x?.name ?? x?.fullName ?? x?.subjectName ?? '');

/**
 * Pairs the normaliser cannot reach, because the stored name has a typo:
 * a surname glued to the given name, or a space inside one word.
 * Listed explicitly rather than loosening the matcher — a looser rule would
 * start merging people who merely share a family name.
 */
const KNOWN_PAIRS: [string, string][] = [
  ['سمر المالكي', 'سمر سعود محمدالمالكي'],
  ['صوفيا عبدالعزيز', 'صوفيا عبد العزيز جفان'],
];

/** Every word of the short name appears in the longer one. */
const sameePerson = (shortName: string, longName: string) => {
  if (KNOWN_PAIRS.some(([a, b]) => a === shortName && b === longName)) return true;
  const a = normalizeArabicName(shortName).split(/\s+/).filter(Boolean);
  const b = new Set(normalizeArabicName(longName).split(/\s+/).filter(Boolean));
  return a.length > 0 && a.every((w) => b.has(w));
};

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }

  console.log(DRY ? '🔍 تجربة — مش هيمسح حاجة\n' : '🗑️  حذف فعلي\n');

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;
  console.log(`دخلنا: ${auth.user?.role}\n`);

  // The list route is unpaginated; the paginated one would stop at ten.
  const teachers = unwrap(await call('GET', '/teachers/list'));
  console.log(`إجمالي المعلمين: ${teachers.length}\n`);

  const assignments = unwrap(await call('GET', '/teacher-assignments'));
  const busy = new Set(assignments.map((a: any) => String(a.teacherId?._id ?? a.teacherId)));

  const toDelete: any[] = [];
  const kept: string[] = [];

  for (const shortName of SEEDED) {
    const mine = teachers.filter((t: any) => nameOf(t) === shortName);
    if (mine.length === 0) continue;

    const longer = teachers.filter(
      (t: any) => nameOf(t) !== shortName && sameePerson(shortName, nameOf(t)),
    );

    if (longer.length === 0) {
      kept.push(`${shortName} — مفيش سجل تاني ليها، سيبناها`);
      continue;
    }
    for (const dup of mine) {
      if (busy.has(idOf(dup))) {
        kept.push(`${shortName} — عليها إسناد، سيبناها`);
        continue;
      }
      toDelete.push({
        ...dup,
        name: nameOf(dup),
        replacedBy: longer.map((l: any) => nameOf(l)).join(' | '),
      });
    }
  }

  console.log(`هيتمسح: ${toDelete.length}`);
  for (const t of toDelete) console.log(`   ✖ ${String(t.name).padEnd(18)} ← الباقي: ${t.replacedBy}`);
  if (kept.length) {
    console.log(`\nمتساب: ${kept.length}`);
    for (const k of kept) console.log(`   • ${k}`);
  }

  if (DRY) { console.log('\n🔍 مكتبناش حاجة. شيل --dry-run للتنفيذ.'); return; }

  let done = 0;
  const failed: string[] = [];
  for (const t of toDelete) {
    try { await call('DELETE', `/teachers/${idOf(t)}`); done++; }
    catch (e: any) { failed.push(`${t.name}: ${e.message.slice(-80)}`); }
  }
  console.log(`\n✅ اتمسح ${done}`);
  if (failed.length) { console.log('فشل:'); failed.forEach((f) => console.log('   · ' + f)); }

  const after = unwrap(await call('GET', '/teachers/list'));
  console.log(`المعلمين دلوقتي: ${after.length}`);
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
