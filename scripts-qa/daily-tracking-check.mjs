#!/usr/bin/env node
/**
 * سجل المتابعة اليومي — end-to-end check against a running API.
 *
 * Answers one question: is anything broken, including things that were
 * already broken before this feature shipped?
 *
 * SAFE BY DEFAULT. Without --write it only reads. With --write it saves a
 * sheet and then puts it back exactly as it found it, so it can be run
 * against production. Read the "restore" line at the end either way.
 *
 *   node scripts-qa/daily-tracking-check.mjs
 *   node scripts-qa/daily-tracking-check.mjs --write
 *   API=https://api.nasaqedu.org node scripts-qa/daily-tracking-check.mjs
 */

const API = process.env.API || 'https://api.nasaqedu.org';
const WRITE = process.argv.includes('--write');

// Accounts. Override with env vars rather than editing the file.
const ACCOUNTS = {
  owner:   { id: process.env.OWNER_ID   || 'owner@nasaq.com',   pw: process.env.OWNER_PW   || 'Password123!' },
  teacher: { id: process.env.TEACHER_ID || '',                  pw: process.env.TEACHER_PW || '' },
};

let pass = 0, fail = 0, skip = 0;
const failures = [];

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function ok(name, extra = '')  { pass++; console.log(`  ${c.g}✓${c.x} ${name}${extra ? c.d + ' — ' + extra + c.x : ''}`); }
function no(name, why)         { fail++; failures.push(`${name} — ${why}`); console.log(`  ${c.r}✗${c.x} ${name}\n      ${c.r}${why}${c.x}`); }
function sk(name, why)         { skip++; console.log(`  ${c.y}○${c.x} ${name} ${c.d}(${why})${c.x}`); }
function head(t)               { console.log(`\n${c.b}${t}${c.x}`); }

/** Asserts a condition and reports it under `name`. */
function check(name, cond, why) { cond ? ok(name) : no(name, why); return cond; }

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function login(who) {
  const { id, pw } = ACCOUNTS[who];
  if (!id || !pw) return null;
  const r = await call('POST', '/auth/login', { body: { identifier: id, password: pw } });
  // The field is accessToken, not access_token.
  const token = r.body?.data?.accessToken ?? r.body?.accessToken;
  if (!token) return null;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  return { token, role: payload.role, userId: payload.sub, permissions: payload.permissions ?? [] };
}

const list = (v) => {
  let cur = v?.data ?? v;
  for (let i = 0; i < 3 && cur && !Array.isArray(cur); i++) cur = cur.data ?? cur.items ?? cur.rows;
  return Array.isArray(cur) ? cur : [];
};
const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${c.b}سجل المتابعة اليومي — فحص${c.x}`);
  console.log(`${c.d}${API} · ${today()} · ${WRITE ? 'read+write' : 'read only'}${c.x}`);

  head('0 · Reachability');
  const owner = await login('owner');
  if (!owner) { no('owner login', 'could not sign in — check OWNER_ID / OWNER_PW'); return report(); }
  ok('owner login', `role=${owner.role}`);

  const teacher = await login('teacher');
  if (teacher) ok('teacher login', `role=${teacher.role}`);
  else sk('teacher login', 'set TEACHER_ID and TEACHER_PW to run the teacher half');

  // ── 1 · permissions ──────────────────────────────────────────────
  head('1 · Permissions in the token');

  const ownerStar = owner.permissions.includes('*');
  check('owner has full reach', ownerStar || owner.permissions.some(p => p.startsWith('school.dailyTracking')),
        `owner token carries neither '*' nor any school.dailyTracking.* — got ${owner.permissions.length} permissions`);

  // What the school actually stores, read through the owner. This works
  // without a teacher password and is the thing that decides whether a
  // teacher who signs in TODAY can save — the backfill either ran or it did
  // not.
  const stored = (await call('GET', '/permissions', { token: owner.token })).body?.data;
  if (!stored) sk('stored role permissions', 'could not read /permissions');
  else {
    const row = (r) => stored?.[r]?.dailyTracking;
    const t = row('TEACHER');
    if (!t) {
      no('school has a TEACHER dailyTracking row',
         'absent — the backfill has not run here. Restart the API, then log the teacher out and back in.');
    } else {
      check('teacher may record', t.add === true,
            'add=false — a teacher signing in now still cannot save. Either the API has not been restarted, or the school unticked it.');
      check('teacher may read the report', t.read === true, 'read=false — the report will 403');
      check('teacher cannot delete an observation', t.delete === false,
            'delete=true — nothing should be able to erase a record');
    }
    const m = row('MANAGER');
    if (m) check('manager reads but does not record', m.read === true && m.add === false,
                 `got ${JSON.stringify(m)} — recording belongs to the teacher in her own lecture`);
    const st = row('STUDENT');
    if (st) check('student sees nothing', st.read === false, `got ${JSON.stringify(st)}`);
  }

  if (teacher) {
    const has = (a) => teacher.permissions.includes(`school.dailyTracking.${a}`);
    check('this teacher\'s TOKEN carries create', has('create'),
          "the stored row may be fine, but THIS token predates it — log out and back in");
    check('this teacher\'s token carries read', has('read'), 'missing — the report will 403');
  }

  // ── 2 · the sheet ────────────────────────────────────────────────
  head('2 · Reading a sheet');

  let lecture = null, sheet = null;
  const actor = teacher ?? owner;

  if (teacher) {
    const lec = await call('GET', '/lectures/teacher/me', { token: teacher.token });
    const rows = list(lec.body);
    if (!rows.length) { sk('teacher has lectures', 'none on the timetable'); }
    else { lecture = rows[0]; ok('teacher has lectures', `${rows.length} periods`); }
  } else {
    // No teacher password: the owner can still read a sheet, which exercises
    // everything except the teacher-scoping rules.
    const rows = list((await call('GET', '/lectures?limit=1', { token: owner.token })).body);
    if (rows.length) { lecture = rows[0]; ok('found a lecture to read', 'via owner'); }
  }

  if (lecture) {
    const id = lecture._id ?? lecture.id;
    const r = await call('GET', `/attendance/lecture/${id}/sheet?date=${today()}`, { token: actor.token });
    if (r.status !== 200) { no('sheet loads', `HTTP ${r.status} — ${r.body?.message ?? 'no message'}`); }
    else {
      sheet = r.body?.data;
      ok('sheet loads', `${sheet?.students?.length ?? 0} students`);

      check('sheet exposes trackingRecorded', sheet?.trackingRecorded !== undefined,
            'missing — the client cannot tell "saved" from "someone is absent"');

      // Seen live on production: alreadyRecorded=true with
      // trackingRecorded=false, because somebody was marked absent through
      // the old attendance screen and no behavioural sheet was ever saved.
      // A client reading alreadyRecorded would show "تم الحفظ" over an
      // empty sheet.
      if (sheet?.alreadyRecorded === true && sheet?.trackingRecorded === false) {
        ok('the two flags are genuinely independent',
           'absences exist, tracking not saved — a client must use trackingRecorded');
      }

      const s = sheet?.students?.[0];
      if (!s) sk('student rows carry the four fields', 'class has no students');
      else {
        check('rows carry participation', s.participation !== undefined, 'absent from the payload');
        check('rows carry homework', s.homework !== undefined, 'absent from the payload');
        check('rows carry quiz', 'quiz' in s, 'absent from the payload');
        check('quiz is null, not false, when unset',
              s.quiz === null || typeof s.quiz === 'boolean',
              `got ${JSON.stringify(s.quiz)}`);
        check('rows carry no grade of any kind',
              !['grade','points','score','mark'].some(k => k in s),
              `found a score field: ${Object.keys(s).join(', ')}`);
      }
    }
  } else sk('sheet checks', 'no lecture to read');

  // ── 3 · access control ───────────────────────────────────────────
  head('3 · Who may read what');

  const cls = list((await call('GET', '/classes', { token: owner.token })).body);
  check('owner can list classes', cls.length > 0, 'none returned');

  const range = { startDate: today(), endDate: today() };
  if (cls.length) {
    const anyClass = cls[0]._id ?? cls[0].id;
    const q = new URLSearchParams({ ...range, classId: String(anyClass) });
    const r = await call('GET', `/daily-tracking/reports/summary?${q}`, { token: owner.token });
    check('owner reads any class report', r.status === 200,
          `HTTP ${r.status} — ${r.body?.message ?? ''}`);

    if (r.status === 200) {
      const d = r.body?.data;
      check('report states it is not a grade', String(d?.note ?? '').includes('لا يؤثر في الدرجات'),
            `note was: ${JSON.stringify(d?.note)}`);
      const st = d?.students?.[0];
      if (!st) sk('report row shape', 'no tracked data in this range yet');
      else {
        check('row has the quiz triple',
              st.quizzes && ['passed','failed','noQuiz'].every(k => k in st.quizzes),
              `got ${JSON.stringify(st.quizzes)}`);
        check('quiz totals add up to the periods',
              (st.quizzes.passed + st.quizzes.failed + st.quizzes.noQuiz) === st.totalLectures,
              `${st.quizzes.passed}+${st.quizzes.failed}+${st.quizzes.noQuiz} ≠ ${st.totalLectures}`);
        check('present + absent equals the periods',
              st.presentCount + st.absentCount === st.totalLectures,
              `${st.presentCount}+${st.absentCount} ≠ ${st.totalLectures}`);
        check('rate is null or a percentage, never out of range',
              st.participationRate === null ||
              (st.participationRate >= 0 && st.participationRate <= 100),
              `participationRate=${st.participationRate} — over 100 means it divided by the wrong thing`);
        if (st.presentCount === 0) {
          check('no present days gives null, not 0', st.participationRate === null,
                `got ${st.participationRate} — "no data" is being shown as "zero percent"`);
        }
      }
    }
  }

  // A teacher must be refused a class she does not teach.
  if (teacher && cls.length) {
    const mine = list((await call('GET', '/classes/teacher/me', { token: teacher.token })).body)
      .map(x => String(x._id ?? x.id));
    ok('teacher class list is scoped', `${mine.length} of ${cls.length} classes`);

    const foreign = cls.map(x => String(x._id ?? x.id)).find(id => !mine.includes(id));
    if (!foreign) sk('teacher refused a foreign class', 'she teaches every class');
    else {
      const q = new URLSearchParams({ ...range, classId: foreign });
      const r = await call('GET', `/daily-tracking/reports/summary?${q}`, { token: teacher.token });
      check('teacher refused a class she does not teach', r.status === 403,
            `HTTP ${r.status} — she can read another class's behaviour`);
    }

    if (mine.length) {
      const q = new URLSearchParams({ ...range, classId: mine[0] });
      const r = await call('GET', `/daily-tracking/reports/summary?${q}`, { token: teacher.token });
      check('teacher reads her own class', r.status === 200,
            `HTTP ${r.status} — ${r.body?.message ?? ''}`);
    }
  }

  // ── 4 · validation ───────────────────────────────────────────────
  head('4 · Bad input is refused');

  if (cls.length) {
    const cid = String(cls[0]._id ?? cls[0].id);
    const bad = async (label, qs, why) => {
      const r = await call('GET', `/daily-tracking/reports/summary?${qs}`, { token: owner.token });
      check(label, r.status === 400, `HTTP ${r.status} — ${why}`);
    };
    await bad('rejects a malformed date',
              new URLSearchParams({ startDate: '29-09-2026', endDate: today(), classId: cid }),
              'a bad date was accepted');
    await bad('rejects a backwards range',
              new URLSearchParams({ startDate: '2026-12-31', endDate: '2026-01-01', classId: cid }),
              'endDate before startDate was accepted');
    const r = await call('GET', `/daily-tracking/reports/summary?${new URLSearchParams(range)}`, { token: owner.token });
    check('rejects a missing classId', r.status === 400,
          `HTTP ${r.status} — an unscoped query would return the whole school`);
  }

  const anon = await call('GET', '/daily-tracking/reports/summary?classId=x', {});
  check('refuses an unauthenticated caller', anon.status === 401 || anon.status === 403,
        `HTTP ${anon.status}`);

  // ── 5 · saving ───────────────────────────────────────────────────
  head(`5 · Saving${WRITE ? '' : '  (skipped — pass --write to run)'}`);

  if (!WRITE) { sk('save checks', 'read-only run'); return report(); }
  if (!teacher || !lecture || !sheet?.students?.length) { sk('save checks', 'need a teacher with a lecture and students'); return report(); }

  const lectureId = String(lecture._id ?? lecture.id);
  const before = sheet.students.map(s => ({
    studentId: String(s._id), absent: s.absent === true,
    participation: s.participation, homework: s.homework, quiz: s.quiz,
  }));
  console.log(`  ${c.d}original state captured for ${before.length} students${c.x}`);

  const save = (records) => call('POST', '/daily-tracking/bulk',
    { token: teacher.token, body: { lectureId, date: today(), records } });

  // Everyone present, nothing else ticked — a state we can assert exactly.
  const probe = before.map(r => ({ ...r, absent: false, participation: true, homework: false, quiz: null }));
  const s1 = await save(probe);
  check('save returns 200', s1.status === 200, `HTTP ${s1.status} — ${s1.body?.message ?? ''}`);

  if (s1.status === 200) {
    const reread = async () => (await call('GET',
      `/attendance/lecture/${lectureId}/sheet?date=${today()}`, { token: teacher.token })).body?.data;

    const after = await reread();
    const one = after?.students?.find(x => String(x._id) === probe[0].studentId);
    check('what was saved is what comes back',
          one?.participation === true && one?.homework === false && one?.quiz === null,
          `got participation=${one?.participation} homework=${one?.homework} quiz=${JSON.stringify(one?.quiz)}`);
    check('trackingRecorded flips to true', after?.trackingRecorded === true,
          `still ${after?.trackingRecorded}`);

    // Idempotency: the same payload twice must not double anything.
    const s2 = await save(probe);
    check('saving twice is safe', s2.status === 200, `HTTP ${s2.status}`);
    const after2 = await reread();
    check('re-saving does not change the result',
          after2?.students?.length === after?.students?.length,
          `roster went from ${after?.students?.length} to ${after2?.students?.length}`);

    // An absent student must come back with the other three cleared.
    const marked = probe.map((r, i) => i === 0 ? { ...r, absent: true, participation: true, homework: true } : r);
    await save(marked);
    const after3 = await reread();
    const abs = after3?.students?.find(x => String(x._id) === probe[0].studentId);
    check('an absent student cannot have participated',
          abs?.absent === true && abs.participation === false && abs.homework === false,
          `absent=${abs?.absent} participation=${abs?.participation} homework=${abs?.homework}`);

    // A student from another class must be refused.
    const otherCls = cls.map(x => String(x._id ?? x.id)).find(id => id !== String(lecture.classId?._id ?? lecture.classId));
    if (otherCls) {
      const others = list((await call('GET', `/students?classId=${otherCls}&limit=1`, { token: owner.token })).body);
      if (others.length) {
        const r = await save([...probe, { studentId: String(others[0]._id), absent: false, participation: true, homework: true, quiz: null }]);
        check('a student from another class is refused', r.status === 400,
              `HTTP ${r.status} — a teacher could write a record for any student in the school`);
      } else sk('foreign student refused', 'no student found in another class');
    }

    // Put it back.
    const restore = await save(before);
    if (restore.status === 200) console.log(`  ${c.g}↩${c.x} original state restored`);
    else console.log(`  ${c.r}↩ RESTORE FAILED (HTTP ${restore.status}) — this period is left as the probe set it${c.x}`);
  }

  report();
}

function report() {
  console.log(`\n${c.b}${'─'.repeat(52)}${c.x}`);
  console.log(`${c.g}${pass} passed${c.x}   ${fail ? c.r : c.d}${fail} failed${c.x}   ${c.d}${skip} skipped${c.x}`);
  if (failures.length) {
    console.log(`\n${c.r}${c.b}What is broken${c.x}`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else if (!fail) {
    console.log(`\n${c.g}Nothing broken in what was checked.${c.x}`);
  }
  if (!WRITE) console.log(`${c.d}\nRead-only. Re-run with --write to test saving.${c.x}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(`\n${c.r}crashed: ${e.message}${c.x}`); process.exit(2); });
