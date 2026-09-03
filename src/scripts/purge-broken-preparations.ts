/**
 * Deletes preparations whose lecture is an all-null snapshot.
 *
 * An older version of the Friday archiving cron wrote a snapshot even when the
 * lecture had not resolved, which overwrote the id — the only way back. The
 * current cron refuses to do that (tasks.service.ts), so no new rows can land
 * in this state, but the ones it already wrote cannot be repaired: there is
 * nothing left to point at.
 *
 * Dry run by default. Pass --commit to delete.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npx ts-node src/scripts/purge-broken-preparations.ts
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npx ts-node src/scripts/purge-broken-preparations.ts --commit
 */
const API = process.env.NASAQ_API ?? 'https://api.nasaq.185.170.196.120.sslip.io';
const COMMIT = process.argv.includes('--commit');
let TOKEN = '';

async function call(method: string, path: string, body?: any) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data?.message ?? res.statusText)}`);
  }
  return data;
}

/** A row is beyond repair when its lecture is an object with no id to follow. */
const isBeyondRepair = (p: any) => {
  const l = p.lecture;
  if (!l) return true;
  if (typeof l === 'string') return false;       // still a ref — repairable
  return typeof l === 'object' && !l._id;        // snapshot of nothing
};

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;
  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = (auth.data ?? auth).accessToken;

  const page = await call('GET', '/preparation?page=1&limit=200');
  const rows: any[] = Array.isArray(page.data) ? page.data : (page.data?.data ?? []);
  console.log(`إجمالي التحاضير: ${rows.length}\n`);

  const broken = rows.filter(isBeyondRepair);
  const healthy = rows.length - broken.length;

  console.log(`سليمة        : ${healthy}`);
  console.log(`مش قابلة للإصلاح: ${broken.length}\n`);

  for (const p of broken) {
    console.log(`  ${p._id}`);
    console.log(`     المعلمة : ${p.name ?? '—'}`);
    console.log(`     الأسبوع : ${p.weekOf ?? '—'}${p.isWeekEstimated ? ' (مقدَّر)' : ''}`);
    console.log(`     العنوان : ${p.lessonTitle || '(فاضي)'}`);
    console.log(`     ملفات   : ${(p.files ?? []).length}`);
    console.log(`     اتعمل   : ${p.createdAt ?? '—'}`);
  }

  if (!broken.length) {
    console.log('\nمفيش حاجة تتمسح.');
    return;
  }

  const withFiles = broken.filter((p) => (p.files ?? []).length > 0);
  if (withFiles.length) {
    console.log(`\n⚠️  ${withFiles.length} منهم عليهم ملفات مرفوعة — الملفات هتروح معاهم.`);
  }

  if (!COMMIT) {
    console.log('\n[معاينة] مفيش حاجة اتمسحت. ضيف --commit للتنفيذ.');
    return;
  }

  console.log('\nبمسح...');
  let deleted = 0;
  for (const p of broken) {
    try {
      await call('DELETE', `/preparation/${p._id}`);
      deleted++;
      console.log(`  ✅ ${p._id}`);
    } catch (e: any) {
      console.log(`  ❌ ${p._id}: ${e.message}`);
    }
  }
  console.log(`\nاتمسح: ${deleted} من ${broken.length}`);
}

main().catch((e) => { console.error('فشل:', e.message); process.exit(1); });
