# فحص سجل المتابعة اليومي

```bash
# قراءة فقط — آمن على الإنتاج
node scripts-qa/daily-tracking-check.mjs

# بحساب معلّمة (يفحص قصر الفصول عليها)
TEACHER_ID=teacher@school TEACHER_PW='...' node scripts-qa/daily-tracking-check.mjs

# يفحص الحفظ كمان — يكتب ثم يُعيد الحالة كما كانت
TEACHER_ID=... TEACHER_PW=... node scripts-qa/daily-tracking-check.mjs --write

# بيئة أخرى
API=https://staging.example node scripts-qa/daily-tracking-check.mjs
```

`--write` يحفظ كشفًا حقيقيًا ثم يُعيده إلى ما كان عليه. اقرأ سطر
`↩ original state restored` في آخر التشغيل. إن ظهر `RESTORE FAILED`
فالحصة تُركت على حالة الفحص ويجب إصلاحها يدويًا.

الحفظ لا يحذف غيابًا قائمًا، فعذر الأسرة ومراجعة المديرة لا يضيعان.

الخروج بصفر = لم يُكتشف عطل. بغير صفر = القائمة في آخر التشغيل.

---

# فحص يوم المرحلة (الروضة)

على مدرسة اختبار جديدة، **لا على مدرسة حقيقية**.

```bash
# ١. ابنِ مدرسة نظيفة: روضة + ابتدائي، والخميس قصير
node scripts-qa/seed-test-school.mjs

# ٢. انسخ السطر الذي يطبعه في آخره وشغّله
API=... TERM=... KG=... PRIMARY=... EMAIL=... PW=... \
  node scripts-qa/verify-stage-day.mjs
```

السكربت الثاني يضبط يوم الروضة على ١٤، ويقرأ الأرقام، ويتأكد أن الابتدائية
لم تتحرك، ثم **يمسح الرقم ويعيد كل شيء كما كان**.

المتوقع: ٣٨ للمرحلتين قبل، ثم ٦٦ للروضة و٣٨ للابتدائية، ثم ٣٨ للاثنتين بعد
المسح. الخميس ٦ من ٨ يصير ١٠ من ١٤ — يُقاس بالنسبة لا حرفيًا.

`verify-stage-day.mjs` **يكتب** في مرحلة. لا توجّهه إلى مدرسة حقيقية.
