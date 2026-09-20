/**
 * Loads مواهب المملكة's timetable from the PDF the school built in aSc.
 *
 * The school already has a working timetable; it lives in a PDF and in nobody's
 * account. The generator cannot reproduce it — the school's teaching plans are
 * attached to three phantom grade levels with no classes on them, so every
 * class reads as underfilled and a commit is refused. Fixing that is the right
 * job and a slow one. This is the fast one: take what the school already
 * decided and put it in front of the teachers and the parents.
 *
 * Reads through the API rather than the database, so it obeys the same
 * permissions, the same tenant scoping and the same conflict checks a person
 * clicking would. A lecture this script cannot create is one the UI would have
 * refused too.
 *
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run import:mwahb -- --dry-run
 *   NASAQ_EMAIL=… NASAQ_PASSWORD=… npm run import:mwahb -- --commit
 *
 * --dry-run resolves every name and prints what it found without writing.
 * Run it until the report is clean. Nothing is written without --commit.
 */
import * as fs from 'fs';
import * as path from 'path';

const API = process.env.NASAQ_API ?? 'https://api.nasaqedu.org';
const COMMIT = process.argv.includes('--commit');
const TERM_NAME = process.env.NASAQ_TERM ?? 'الترم الاول';

const DATA = path.join(__dirname, 'data', 'mwahb-timetable.json');

let TOKEN = '';

async function call(method: string, endpoint: string, body?: any) {
  const res = await fetch(`${API}${endpoint}`, {
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

  if (!res.ok) {
    throw new Error(`${method} ${endpoint} → ${res.status}: ${JSON.stringify(data?.message ?? res.statusText)}`);
  }
  if (data && typeof data === 'object' && typeof data.status === 'boolean' && 'data' in data) return data.data;
  return data;
}

const list = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  for (const key of ['data', 'items', 'docs', 'results']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  if (Array.isArray(value?.data?.data)) return value.data.data;
  return [];
};

const idOf = (value: any) => String(value?._id ?? value?.id ?? value ?? '');

/** اسم المادة، أيًّا كان الحقل الذي وصلت فيه. أول نسخة طبعت undefined. */
const subjectNameOf = (row: any) =>
  String(row?.subjectName ?? row?.name ?? row?.title ?? row?.subject?.subjectName ?? '');

/**
 * Arabic names do not compare as typed.
 *
 * The PDF writes «التربية الاسلامية» and the system «التربية الإسلامية»; one
 * has a bare alif, the other a hamza. Same for ة/ه at the end of a teacher's
 * name. Comparing raw strings would report a dozen subjects missing that are
 * sitting right there.
 */
const fold = (value: string) =>
  String(value ?? '')
    .replace(/[ً-ْٰ]/g, '')     // التشكيل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    // الأرقام العربية أرقام. أول نسخة من هذه الدالة كانت تحذفها مع الرموز،
    // فصار «ثاني/بنات ١» و«ثاني/بنات ٢» مفتاحًا واحدًا، واختفى فصل بأكمله
    // من الاستيراد بينما تضاعف الآخر.
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^ء-ي0-9a-zA-Z]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/**
 * ما يسمّيه الـPDF وما يسمّيه النظام.
 *
 * الجدول مكتوب باختصارات المعلمات: «إنجليزي» و«بدنية». والنظام يخزّن الاسم
 * الرسمي: «اللغة الإنجليزية» و«التربية البدنية». لا حيلة عامة تربط بينهما،
 * فهذه قائمة صريحة — وأي اسم لا يُطابَق يُطبع مع قائمة مواد المدرسة كاملة
 * بدلًا من أن يُخمَّن.
 */
const SUBJECT_ALIASES: Record<string, string[]> = {
  'إنجليزي': ['اللغة الإنجليزية', 'انجليزي', 'الإنجليزية', 'English'],
  'رياضيات': ['الرياضيات'],
  'بدنية': ['التربية البدنية', 'التربية البدنيه'],
  'الدراسات الإجتماعيات': ['الدراسات الاجتماعية', 'الاجتماعيات', 'دراسات اجتماعية'],
  'لغتي': ['اللغة العربية', 'لغتي الجميلة'],
  'علوم': ['العلوم'],
  'التربية الاسلامية': ['التربية الإسلامية', 'التربية الدينية'],
  'التربية الفنية': ['التربية الفنيه', 'الفنية'],
  'الحساب الذهني': ['حساب ذهني'],
  'اللغة الصينية': ['الصينية', 'صيني'],
  'المهارات الرقمية': ['المهارات الرقميه', 'الحاسب الآلي'],
  'المهارات الحياتية والأسرية': ['المهارات الحياتية', 'المهارات الأسرية'],
  'جمباز': ['الجمباز'],
  'تدريب نافس': ['نافس'],
};

/** كل ما قد يُكتب به اسم المادة، مطبَّعًا، بترتيب الأولوية. */
const subjectKeys = (name: string) => {
  const folded = fold(name);
  const bare = folded.replace(/^ال/, '');

  return [
    folded,
    bare,
    `ال${bare}`,
    ...(SUBJECT_ALIASES[name] ?? []).map(fold),
  ];
};

/** نصاب الصف: ما يأخذه فصل واحد، لا مجموع فصوله. */
const periodsForGrade = (perClass: Map<string, number>) =>
  Math.max(...perClass.values());

/** فصول الصف الواحد يُفترض أن تتساوى؛ اختلافها خطأ في الجدول يستحق الذكر. */
const unevenAcrossClasses = (perClass: Map<string, number>) =>
  new Set(perClass.values()).size > 1;

/**
 * ما يقصده الـPDF حين لا يكفي الاسم الأول.
 *
 * الجدول يكتب أسماء الدلع وأسماء مزدوجة، والمدرسة حسمتها:
 *
 *   «نور»            دلع مناير بندر الشرعبي، معلمة الجمباز
 *   «جوهرة»          جوهرة سليمان لا جوهرة الجعيد — الثانية في كيجي٢
 *   «فاطمة / بسمة»   فاطمة وحدها
 *
 * القيمة جزء مميِّز من الاسم الرباعي لا الاسم كاملًا: هجاء الاسم في الجدول
 * ليس هجاءه في المنصة دائمًا، والمطابقة على «الشرعبي» تصمد لاسم
 * يُكتب «مناير» ويُنادى «نور». وأي تجاوز لا يطابق معلمة واحدة بالضبط يُبلَّغ عنه ولا
 * يُخمَّن — تعيين حصة لمعلمة غير التي تدخل الفصل أسوأ من تركها بلا اسم.
 */
const TEACHER_OVERRIDES: Record<string, string> = {
  'نور': 'الشرعبي',
  'نور / جوهرة': 'الشرعبي',
  'جوهرة': 'جوهرة سليمان',
  'فاطمة / بسمة': 'فاطمة سعد',
};

/** The PDF names a teacher by her first name only. */
const firstNameOf = (value: string) => fold(value).split(' ')[0] ?? '';

type Cell = [string, string] | null;

interface Row {
  className: string;
  classId: string;
  day: string;
  slot: number;
  subject: string;
  teacherLabel: string;
  subjectOfferingId?: string;
  teacherId?: string | null;
}

async function main() {
  const email = process.env.NASAQ_EMAIL;
  const password = process.env.NASAQ_PASSWORD;

  if (!email || !password) {
    console.error('حط NASAQ_EMAIL و NASAQ_PASSWORD في البيئة.');
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(DATA, 'utf8'));

  console.log(COMMIT ? '📝 تنفيذ — هيكتب في قاعدة البيانات\n' : '🔍 تجربة — مش هيكتب حاجة\n');
  console.log(`المصدر: ${plan.source}\n`);

  const auth = await call('POST', '/auth/login', { identifier: email, password });
  TOKEN = auth.accessToken;

  // ---- الترم -----------------------------------------------------------
  const terms = list(await call('GET', '/terms'));
  const term = terms.find((row: any) => fold(row?.name) === fold(TERM_NAME));

  if (!term) {
    console.error(`❌ مفيش ترم اسمه «${TERM_NAME}». الموجود: ${terms.map((t: any) => t.name).join(' · ')}`);
    process.exit(1);
  }
  console.log(`الترم: ${term.name}\n`);

  // ---- الفصول والمواد والمعلمات ---------------------------------------
  const classes = list(await call('GET', '/classes/list'));
  const subjects = list(await call('GET', '/subjects/list'));
  const teachers = list(await call('GET', '/teachers?page=1&limit=500'));
  const offerings = list(await call('GET', `/subject-offerings/by-term/${idOf(term)}`));

  const classByName = new Map<string, any>();
  for (const row of classes) classByName.set(fold(row?.name), row);

  // كل مادة تُفهرَس باسمها وباسمها بلا «ال» وبـ«ال» عليه، فيلتقي اختصار
  // الـPDF بالاسم الرسمي من الجهتين.
  const subjectByName = new Map<string, any>();
  for (const row of subjects) {
    const name = subjectNameOf(row);
    if (!name) continue;
    for (const key of subjectKeys(name)) {
      if (key && !subjectByName.has(key)) subjectByName.set(key, row);
    }
  }

  /** أول مفتاح يُطابِق مادة موجودة. */
  const findSubject = (name: string) => {
    for (const key of subjectKeys(name)) {
      const hit = subjectByName.get(key);
      if (hit) return hit;
    }
    return null;
  };

  const matchedSubjects = new Map<string, string>();

  /** First name → every teacher who answers to it. More than one is a stop. */
  const teachersByFirstName = new Map<string, any[]>();
  for (const row of teachers) {
    const key = firstNameOf(row?.name);
    if (!key) continue;
    teachersByFirstName.set(key, [...(teachersByFirstName.get(key) ?? []), row]);
  }

  /**
   * من تدخل الفصل فعلًا: التجاوز الصريح أولًا، ثم الاسم الأول.
   *
   * التجاوز يُطابَق على جزء من الاسم الرباعي، فإن طابق أكثر من معلمة عاد
   * بهنّ جميعًا ليُبلَّغ عن الالتباس بدل أن يُختار أوّلهنّ.
   */
  const resolveTeacher = (label: string): any[] => {
    const override = TEACHER_OVERRIDES[label];

    if (override) {
      const needle = fold(override);
      return teachers.filter((row: any) => fold(row?.name).includes(needle));
    }

    return teachersByFirstName.get(firstNameOf(label)) ?? [];
  };

  const matchedTeachers = new Map<string, string>();

  /** (subject, grade) → the offering the lectures will point at. */
  const offeringBySubjectGrade = new Map<string, any>();
  for (const row of offerings) {
    offeringBySubjectGrade.set(
      `${idOf(row?.subjectId)}|${idOf(row?.gradeLevelId)}`,
      row,
    );
  }

  // ---- حلّ الأسماء ------------------------------------------------------
  const rows: Row[] = [];
  const problems: string[] = [];
  const missingSubjects = new Set<string>();
  const ambiguous = new Map<string, string[]>();
  const unknownTeachers = new Set<string>();
  const missingOfferings = new Map<
    string,
    { subject: any; grade: string; gradeId: string; perClass: Map<string, number> }
  >();

  for (const entry of plan.classes) {
    const cls = classByName.get(fold(entry.systemClass));

    if (!cls) {
      problems.push(`❌ فصل غير موجود: «${entry.systemClass}» (${entry.pdfTitle})`);
      continue;
    }

    const gradeId = idOf(cls.gradeLevelId);

    for (const day of plan.days) {
      const cells: Cell[] = entry.grid[day] ?? [];

      cells.forEach((cell, index) => {
        if (!cell) return;

        const [subjectName, teacherLabel] = cell;
        const slot = index + 1;

        const subject = findSubject(subjectName);
        if (!subject) {
          missingSubjects.add(subjectName);
          return;
        }
        matchedSubjects.set(subjectName, subjectNameOf(subject));

        // The offering is what a lecture hangs on. Creating the missing ones
        // on the class's own grade also rebuilds the teaching plan there,
        // which is where it should have been all along.
        const key = `${idOf(subject)}|${gradeId}`;
        const offering = offeringBySubjectGrade.get(key);

        if (!offering) {
          // العدّ لكل فصل على حدة، لا لكل صف.
          //
          // الخطة تُخزَّن مرة واحدة للصف وتنطبق على كل فصوله، فلو جمعنا
          // حصص «أولى/بنين» و«أولى/بنات» معًا لكتبنا للصف الأول ضِعف
          // نصابه — عشر حصص تربية إسلامية بدل خمس — ولانهار فحص الجاهزية
          // على رقم لا وجود له في جدول أحد.
          const seen =
            missingOfferings.get(key) ??
            { subject, grade: cls.name, gradeId, perClass: new Map<string, number>() };

          seen.perClass.set(cls.name, (seen.perClass.get(cls.name) ?? 0) + 1);
          missingOfferings.set(key, seen);
        }

        const candidates = resolveTeacher(teacherLabel);
        if (candidates.length === 0) unknownTeachers.add(teacherLabel);
        if (candidates.length > 1) {
          ambiguous.set(teacherLabel, candidates.map((row: any) => row.name));
        }
        if (candidates.length === 1) {
          matchedTeachers.set(teacherLabel, candidates[0].name);
        }

        rows.push({
          className: cls.name,
          classId: idOf(cls),
          day,
          slot,
          subject: subjectName,
          teacherLabel,
          subjectOfferingId: offering ? idOf(offering) : undefined,
          teacherId: candidates.length === 1 ? idOf(candidates[0]) : null,
        });
      });
    }
  }

  // ---- التقرير ----------------------------------------------------------
  const byClass = new Map<string, number>();
  for (const row of rows) byClass.set(row.className, (byClass.get(row.className) ?? 0) + 1);

  console.log('الحصص المقروءة من الـPDF:');
  for (const [name, count] of byClass) console.log(`   ${name.padEnd(22)} ${count}`);
  console.log(`   ${'الإجمالي'.padEnd(22)} ${rows.length}\n`);

  if (problems.length) problems.forEach((line) => console.log(line));

  if (matchedSubjects.size) {
    console.log(`مطابقة المواد (${matchedSubjects.size}):`);
    for (const [pdfName, systemName] of matchedSubjects) {
      const same = fold(pdfName) === fold(systemName);
      console.log(`   ${same ? '·' : '↔'} ${pdfName.padEnd(28)} ${same ? '' : '→ ' + systemName}`);
    }
    console.log('');
  }

  if (missingSubjects.size) {
    console.log(`❌ مواد مش موجودة في النظام (${missingSubjects.size}):`);
    for (const name of missingSubjects) console.log(`   · ${name}`);
    console.log(`\n   مواد المدرسة (${subjects.length}) — قارن وقولي أنهي واحدة تقابل أنهي:`);
    for (const row of subjects) console.log(`      - ${subjectNameOf(row)}`);
    console.log('');
  }

  if (missingOfferings.size) {
    console.log(`\n➕ عروض مواد هتتعمل على صف الفصل نفسه (${missingOfferings.size}):`);
    for (const row of missingOfferings.values()) {
      const periods = periodsForGrade(row.perClass);
      const spread = [...row.perClass.entries()]
        .map(([name, count]) => `${name}:${count}`)
        .join('  ');

      console.log(
        `   · ${subjectNameOf(row.subject)} → صف «${row.grade}» — ${periods} حصة أسبوعيًا` +
          (unevenAcrossClasses(row.perClass) ? `   ⚠️ فصول الصف مش متساوية → ${spread}` : ''),
      );
    }
  }

  const overridden = [...matchedTeachers.entries()].filter(
    ([label]) => TEACHER_OVERRIDES[label],
  );

  if (overridden.length) {
    console.log(`\nمعلمات محسومة يدويًا (${overridden.length}):`);
    for (const [label, name] of overridden) {
      console.log(`   ↔ «${label}»`.padEnd(28) + `→ ${name}`);
    }
  }

  if (unknownTeachers.size) {
    console.log(`\n⚠️ معلمات مش متعرّف عليهن (${unknownTeachers.size}) — الحصة هتتكتب بدون معلم:`);
    for (const name of unknownTeachers) console.log(`   · ${name}`);
    console.log(`\n   معلمات المدرسة (${teachers.length}):`);
    for (const row of teachers) console.log(`      - ${row?.name}`);
  }

  if (ambiguous.size) {
    console.log(`\n🛑 أسماء ملتبسة — أكثر من معلمة بنفس الاسم الأول (${ambiguous.size}):`);
    for (const [label, names] of ambiguous) {
      console.log(`   · «${label}» ← ${names.join('  |  ')}`);
    }
    console.log('   الحصص دي هتتكتب بدون معلم لحد ما تحسم الاختيار.');
  }

  /*
   * الحصة المشتركة: معلمة واحدة وأكثر من فصل في الوقت نفسه.
   *
   * الجمباز في مواهب يُدرَّس لأربعة فصول مجتمعة في الحوش — ترتيب حقيقي لا
   * خطأ في الجدول. غير أن فهرسًا فريدًا على (المعلمة، اليوم، الحصة) يمنع
   * ذلك، فكل حصة بعد الأولى كان السيرفر سيرفضها ويترك الجدول ناقصًا.
   *
   * الفهرس يستثني الحصص بلا معلمة، فتُكتب هذه بلا اسم: المادة تظهر للطالب
   * في مكانها، والاسم يُضاف حين يتعلّم النظام مفهوم الحصة المشتركة.
   */
  const occupied = new Map<string, string>();
  const joint: string[] = [];

  for (const row of rows) {
    if (!row.teacherId) continue;

    const cell = `${row.teacherId}|${row.day}|${row.slot}`;
    const taken = occupied.get(cell);

    if (taken) {
      joint.push(`${row.className} · ${row.subject} · ${row.day} حصة ${row.slot} (مع ${taken})`);
      row.teacherId = null;
      continue;
    }
    occupied.set(cell, `${row.className} · ${row.subject}`);
  }

  if (joint.length) {
    console.log(`\n🤝 حصص مشتركة — معلمة واحدة وأكثر من فصل (${joint.length}):`);
    for (const line of joint) console.log(`   · ${line}`);
    console.log('   دي هتتكتب بدون اسم معلمة — الفهرس الفريد بيمنع تكرار المعلمة');
    console.log('   في نفس الخانة. المادة هتظهر للطالب عادي.');
  }

  const existing = list(await call('GET', `/lectures?termId=${idOf(term)}&limit=1000`));
  const touched = new Set(rows.map((row) => row.classId));
  const toReplace = existing.filter((row: any) => touched.has(String(row.classId?._id ?? row.classId)));

  console.log(`\nالجدول الحالي في الترم: ${existing.length} حصة`);
  console.log(`منها في الفصول اللي هنكتبها: ${toReplace.length} حصة — هتتمسح الأول`);
  console.log('⚠️ التحضيرات المربوطة بالحصص دي هتتفصل عن الجدول (مش هتتمسح).');

  if (!COMMIT) {
    console.log('\n🔍 مكتبناش حاجة. راجع فوق، وبعدين شغّل بـ --commit.');
    return;
  }

  if (missingSubjects.size || problems.length) {
    console.log('\n🛑 فيه مواد أو فصول ناقصة. صلّحها الأول — مش هكتب جدول ناقص.');
    return;
  }

  // ---- التنفيذ ----------------------------------------------------------
  for (const row of missingOfferings.values()) {
    const created = await call('POST', '/subject-offerings', {
      subjectId: idOf(row.subject),
      gradeLevelId: row.gradeId,
      termId: idOf(term),
      periodsPerWeek: periodsForGrade(row.perClass),
    });
    offeringBySubjectGrade.set(`${idOf(row.subject)}|${row.gradeId}`, created);
    console.log(`➕ عرض مادة: ${subjectNameOf(row.subject)} → ${row.grade}`);
  }

  let removed = 0;
  for (const lecture of toReplace) {
    try { await call('DELETE', `/lectures/${idOf(lecture)}`); removed += 1; }
    catch (error: any) { console.log(`   ✖ تعذر حذف حصة: ${error.message.slice(-70)}`); }
  }
  console.log(`\n🧹 اتمسح ${removed} حصة`);

  let written = 0;
  const failures: string[] = [];

  for (const row of rows) {
    // findSubject لا fold: الاسم في الـPDF ليس الاسم في المنصة، و«الدراسات
    // الإجتماعيات» لا يُطابِق «الدراسات الإجتماعية» بالتطبيع وحده — فيعود
    // المفتاح فارغًا، ويصل إلى الخادم معرّف فارغ يرفضه بـ400.
    const offeringId =
      row.subjectOfferingId ??
      idOf(
        offeringBySubjectGrade.get(
          `${idOf(findSubject(row.subject))}|${idOf(classByName.get(fold(row.className))?.gradeLevelId)}`,
        ),
      );

    if (!offeringId) {
      failures.push(`${row.className} · ${row.day} · حصة ${row.slot} · ${row.subject} — مفيش عرض مادة`);
      continue;
    }

    try {
      await call('POST', '/lectures', {
        classId: row.classId,
        subjectOfferingId: offeringId,
        termId: idOf(term),
        ...(row.teacherId ? { teacherId: row.teacherId } : {}),
        dayOfWeek: row.day,
        slot: row.slot,
      });
      written += 1;
    } catch (error: any) {
      // «المعلمة مشغولة» بلا اسم الفصل المانع تترك القارئ يفتّش يدويًا في
      // ثلاثمئة حصة. الحصة المانعة معروفة للخادم، فلتُذكر.
      let blocker = '';

      if (/already teaching/i.test(error.message) && row.teacherId) {
        try {
          const clash = list(
            await call('GET', `/lectures?termId=${idOf(term)}&teacherId=${row.teacherId}&limit=1000`),
          ).find(
            (other: any) => other?.dayOfWeek === row.day && Number(other?.slot) === row.slot,
          );

          const name = clash?.classId?.name ?? clash?.classId?.className;
          if (name) blocker = ` ← مشغولة في «${name}»`;
        } catch {
          // التشخيص مساعدة لا شرط.
        }
      }

      failures.push(
        `${row.className} · ${row.day} · حصة ${row.slot} · ${row.subject}${blocker} — ${error.message.slice(-70)}`,
      );
    }
  }

  console.log(`\n✅ اتكتب ${written} من ${rows.length} حصة`);

  if (failures.length) {
    console.log(`\n❌ فشل ${failures.length}:`);
    failures.forEach((line) => console.log(`   · ${line}`));
  }
}

main().catch((error) => {
  console.error('\n💥 ' + error.message);
  process.exit(1);
});
