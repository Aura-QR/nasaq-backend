/**
 * أي حصص بقيت في الترم خارج فصول الـPDF، ومن تشغلها.
 *
 * الاستيراد كتب 374 من 382 ورفض الخادم ثمانيًا بحجة أن المعلمة تُدرّس فصلًا
 * آخر في الوقت نفسه — والفصل الآخر ليس من فصول الجدول، فلا بد أنه من
 * الحصص القديمة الباقية. هذه تسمّيها.
 *
 * قراءة فقط.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run audit:mwahb
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaqedu.org';

const PDF_CLASSES = [
  'أولى/بنين', 'ثاني/بنين', 'ثالث/بنين', 'أولى/بنات', 'ثاني/بنات ١',
  'ثاني/بنات ٢', 'ثالث/بنات', 'رابع/بنات', 'خامس/بنات', 'سادس',
  'أولى متوسط/بنات',
];

let TOKEN = '';

async function call(method: string, endpoint: string, body?: any) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${JSON.stringify(data?.message)}`);
  if (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) return data.data;
  return data;
}

const list = (v: any): any[] =>
  Array.isArray(v) ? v
    : Array.isArray(v?.data) ? v.data
    : Array.isArray(v?.items) ? v.items
    : Array.isArray(v?.data?.data) ? v.data.data
    : [];

const nameOf = (v: any) => String(v?.name ?? v?.className ?? v?.subjectName ?? '');

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) { console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD.'); process.exit(1); }

  TOKEN = (await call('POST', '/auth/login', { identifier: email, password })).accessToken;

  // بالاسم الكامل لا بجزء منه: للمدرسة ترمان يبدآن بـ«الأول» — «الترم الاول»
  // وفيه الجدول، و«الفصل الأول» وهو فارغ. المطابقة الجزئية وقعت على الفارغ
  // وأبلغت عن صفر حصة في مدرسة فيها ثلاثمئة.
  const TERM_NAME = process.env.NASAQ_TERM ?? 'الترم الاول';
  const terms = list(await call('GET', '/terms'));

  console.log('ترمات المدرسة:');
  for (const t of terms) console.log(`   · ${t?.name}`);
  console.log('');

  const term = terms.find((t: any) => String(t?.name ?? '').trim() === TERM_NAME);
  if (!term) {
    console.error(`❌ مفيش ترم اسمه «${TERM_NAME}» بالظبط.`);
    process.exit(1);
  }
  console.log(`الترم: ${term.name}\n`);

  const lectures = list(await call('GET', `/lectures?termId=${term._id ?? term.id}`));
  console.log(`إجمالي الحصص في الترم: ${lectures.length}\n`);

  /*
   * الحصة اليتيمة: تشير إلى فصل لم يعد موجودًا.
   *
   * الخادم يُرفق اسم الفصل مع كل حصة، فاسم فارغ يعني أن الـpopulate لم يجد
   * الفصل — حُذف وبقيت حصصه. مثل هذه الحصة لا يراها طالب ولا معلمة، لأن
   * لا فصل يعرضها، لكنها تظل تشغل خانة المعلمة في الفهرس الفريد فتمنع
   * حصة حقيقية من الكتابة. وهذا بالضبط ما حجب ثماني حصص عن أولى/بنات.
   */
  const classIds = new Set(
    list(await call('GET', '/classes/list')).map((c: any) => String(c?._id ?? c?.id)),
  );

  const classIdOf = (l: any) => String(l?.classId?._id ?? l?.classId ?? '');
  const orphans = lectures.filter((l: any) => !classIds.has(classIdOf(l)));
  const otherClasses = lectures.filter(
    (l: any) => classIds.has(classIdOf(l)) && !PDF_CLASSES.includes(nameOf(l?.classId)),
  );

  console.log(`حصص يتيمة — فصلها اتمسح: ${orphans.length}`);
  for (const l of orphans) {
    console.log(
      `   ${String(l.dayOfWeek).padEnd(10)} حصة ${String(l.slot).padEnd(3)} ` +
      `${(nameOf(l.teacherId) || 'بدون معلم').padEnd(26)} classId=${classIdOf(l)}`,
    );
  }

  console.log(`\nحصص لفصول موجودة لكن خارج الـPDF (الروضة): ${otherClasses.length}`);
  for (const l of otherClasses) {
    console.log(`   ${nameOf(l.classId).padEnd(16)} ${l.dayOfWeek} حصة ${l.slot}`);
  }

  if (!process.argv.includes('--delete-orphans')) {
    console.log('\n🔍 مكتبناش حاجة. شغّل بـ --delete-orphans لمسح اليتيمة فقط.');
    return;
  }

  let removed = 0;
  for (const l of orphans) {
    try { await call('DELETE', `/lectures/${l._id ?? l.id}`); removed += 1; }
    catch (e: any) { console.log(`   ✖ ${e.message.slice(-70)}`); }
  }
  console.log(`\n🧹 اتمسح ${removed} حصة يتيمة. أعِد تشغيل الاستيراد.`);
}

main().catch((e) => { console.error('\n💥 ' + e.message); process.exit(1); });
