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
