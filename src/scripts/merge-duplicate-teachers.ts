/**
 * Merges a duplicate teacher record into the real one.
 *
 * cleanup:dup-teachers deletes a duplicate only while it carries nothing. Once
 * the seed assigned subjects to the short-name record, that guard — correctly —
 * refused, and the school was left holding two records for one person.
 *
 * Two records for one teacher is not untidiness, it is a correctness hazard:
 * the generator sees two people, so it will happily put both in different
 * rooms at the same hour and nothing will flag it, because to the database
 * they are not the same teacher.
 *
 * Moves every assignment to the surviving record, drops any that would
 * duplicate one it already has, then deletes the empty duplicate.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run merge:dup-teachers -- --dry-run
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run merge:dup-teachers
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const DRY = process.argv.includes('--dry-run');

/** [the duplicate to remove, the record to keep] */
const PAIRS: [string, string][] = [
  ['سمر المالكي', 'سمر سعود محمدالمالكي'],
  ['صوفيا عبدالعزيز', 'صوفيا عبد العزيز جفان'],
  // The school entered ملاك twice, three days apart, under two addresses.
  // Confirmed one person; the later record is the one in use.
  ['ملاك عبدالرحمن سعد الجهني', 'ملاك عبد الرحمن الجهني'],
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
const nameOf = (x: any) => String(x?.name ?? x?.fullName ?? '');
const ref = (x: any) => String(x?._id ?? x ?? '');

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }
  console.log(DRY ? '🔍 تجربة — مش هيغيّر حاجة\n' : '🔗 دمج\n');

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;

  const teachers = unwrap(await call('GET', '/teachers/list'));
  const assignments = unwrap(await call('GET', '/teacher-assignments'));

  for (const [dupName, keepName] of PAIRS) {
    const dup = teachers.find((t: any) => nameOf(t) === dupName);
    const keep = teachers.find((t: any) => nameOf(t) === keepName);

    if (!dup) { console.log(`↺ ${dupName}: مش موجودة، اتمسحت قبل كده`); continue; }
    if (!keep) { console.log(`⚠️  ${keepName}: مش موجودة — سيبنا ${dupName} زي ما هي`); continue; }

    const mine = assignments.filter((a: any) => ref(a.teacherId) === idOf(dup));
    const theirs = new Set(
      assignments
        .filter((a: any) => ref(a.teacherId) === idOf(keep))
        .map((a: any) => `${ref(a.subjectOfferingId)}|${a.classId ? ref(a.classId) : ''}`),
    );

    console.log(`\n${dupName} → ${keepName}`);
    console.log(`   إسنادات هتتنقل: ${mine.length}`);

    if (DRY) continue;

    let moved = 0, dropped = 0, broken = 0;
    for (const a of mine) {
      const offeringId = ref(a.subjectOfferingId);

      // Some rows point at an offering that no longer exists. They cannot be
      // recreated and are not worth keeping — delete and count them, rather
      // than failing the merge on data that was already broken.
      if (!offeringId) {
        await call('DELETE', `/teacher-assignments/${idOf(a)}`);
        broken++;
        continue;
      }

      const key = `${offeringId}|${a.classId ? ref(a.classId) : ''}`;
      await call('DELETE', `/teacher-assignments/${idOf(a)}`);
      if (theirs.has(key)) { dropped++; continue; }  // she already has it
      await call('POST', '/teacher-assignments', {
        teacherId: idOf(keep),
        subjectOfferingId: offeringId,
        ...(a.classId ? { classId: ref(a.classId) } : {}),
      });
      theirs.add(key);
      moved++;
    }
    if (broken) console.log(`   ⚠️  ${broken} إسناد مكسور (مادة مش موجودة) اتشال`);
    // Her lectures block the delete, and rightly — but they belong to a
    // timetable that is about to be rebuilt from the merged assignments, so
    // they are not work anyone loses.
    const lectures = unwrap(await call('GET', '/lectures'))
      .filter((l: any) => ref(l.teacherId) === idOf(dup));
    for (const l of lectures) await call('DELETE', `/lectures/${idOf(l)}`);

    await call('DELETE', `/teachers/${idOf(dup)}`);
    console.log(
      `   ✔ اتنقل ${moved}${dropped ? `، ${dropped} كانت موجودة عندها` : ''}` +
      `${lectures.length ? `، واتمسح ${lectures.length} حصة (هتتولّد تاني)` : ''}، والنسخة اتمسحت`,
    );
  }

  const after = unwrap(await call('GET', '/teachers/list'));
  console.log(`\nالمعلمين دلوقتي: ${after.length}`);
  if (DRY) console.log('🔍 مكتبناش حاجة. شيل --dry-run للتنفيذ.');
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });

// Marks this file a module so its top-level names do not collide with the
// other standalone scripts.
export {};
