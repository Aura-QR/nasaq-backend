# دليل تكامل الواجهة الأمامية مع نظام الجدول المدرسي
# (Timetable Frontend Integration Guide)

---

## 1. نبذة عن التحديث وقاعدة العمل الجديدة (Business Rule)

### المشكلة السابقة:
كان النظام يقبل الخطط الدراسية طالما أن مجموع الحصص أقل من أو يساوي سعة الأسبوع (`demand <= capacity`). هذا كان ينتج عنه توليد جدول فيه أيام أو فترات فارغة داخل اليوم الدراسي (مثلاً خطة بها 35 حصة لأسبوع سعته 38 حصة تترك 3 حصص فارغة).

### القاعدة الصارمة الحالية:
**مجموع حصص مواد الصف يجب أن يساوي تماماً سعة أيام الأسبوع:**
$$\text{مجموع حصص مواد الصف (Demand)} = \text{سعة الأسبوع الفعلية (Weekly Capacity)}$$

- **إذا كان المجموع أقل (Underfilled):** تُعتبر الخطة ناقصة، ويُمنع اعتماد وتوليد الجدول الفعلي، ويتم إرجاع عدد الحصص الناقصة (`missing`) للمدير لاستكمالها.
- **إذا كان المجموع أكبر (Overbooked):** تُعتبر الخطة متجاوزة للسعة، ويُمنع اعتماد الجدول مع إرجاع عدد الحصص الزائدة (`excess`).
- **إذا تساوى المجموع بالكامل:** تصبح حالة الفصل متوافقة وجاهزة للتوليد والاعتماد.

> [!IMPORTANT]
> - يُسمح لمدير المدرسة بحفظ خطة المواد تدريجياً أثناء الإدخال.
> - يُسمح للمدير بإجراء **معاينة تجريبية (`mode: 'preview'`)** للجدول حتى لو كانت الخطة ناقصة لمعرفة كيف سيبدو وتحديد الخانات الفارغة.
> - **يُمنع منعاً باتاً اعتماد وحفظ الجدول في قاعدة البيانات (`mode: 'commit'`)** إلا بعد اكتمال خطة جميع الفصول بنسبة 100%.

---

## 2. نقاط الـ API ونماذج الاستجابة (Backend API Contracts)

### أ. فحص جاهزية وصلاحية الجدول (Feasibility Check)
- **المسار:** `GET /lectures/feasibility`
- **المدخلات (Query Params):**
  - `termId` (إجباري): معرف الفصل الدراسي.
  - `classIds` (اختياري): معرفات فصول محددة مفصولة بفواصل، وإذا تُركت فارغة يفحص كل الفصول النشطة.

#### نموذج الاستجابة (Response Payload):
```json
{
  "termId": "65b1234567890abcdef12345",
  "slotsPerWeek": 38,
  "periodsPerDay": 8,
  "workingDays": ["sunday", "monday", "tuesday", "wednesday", "thursday"],
  "totalPeriodsNeeded": 114,
  "existingLectures": 0,
  "feasible": false,
  "classes": [
    {
      "classId": "65b1234567890abcdef12346",
      "name": "٤/١",
      "gradeLevelId": "65a1234567890abcdef12340",
      "demand": 35,
      "capacity": 38,
      "free": 3,
      "missing": 3,
      "excess": 0,
      "ok": false
    },
    {
      "classId": "65b1234567890abcdef12347",
      "name": "٥/١",
      "gradeLevelId": "65a1234567890abcdef12341",
      "demand": 38,
      "capacity": 38,
      "free": 0,
      "missing": 0,
      "excess": 0,
      "ok": true
    }
  ],
  "problems": [
    {
      "type": "class_underfilled",
      "message": "٤/١ has 35 planned periods but its week has 38 slots. Add 3 periods to the grade's teaching plan.",
      "blocking": true,
      "classId": "65b1234567890abcdef12346",
      "className": "٤/١",
      "gradeLevelId": "65a1234567890abcdef12340",
      "required": 35,
      "capacity": 38,
      "missing": 3
    }
  ],
  "teachers": [
    {
      "teacherId": "65c1234567890abcdef12350",
      "name": "أ. فاطمة",
      "load": 24,
      "capacity": 38,
      "free": 14,
      "ok": true
    }
  ],
  "unassignedSubjects": []
}
```

---

### ب. توليد واعتماد الجدول (Generate / Commit Timetable)
- **المسار:** `POST /lectures/generate`
- **مدخلات الطلب (Request Body):**
```json
{
  "termId": "65b1234567890abcdef12345",
  "mode": "preview",
  "onExisting": "skip",
  "maxSamePerDay": 2,
  "includeUnstaffed": true
}
```
*القيم المتاحة لـ `mode`:*
- `"preview"`: للمعاينة فقط (لا يكتب في قاعدة البيانات).
- `"commit"`: للاعتماد والحفظ النهائي في قاعدة البيانات.

#### سلوك النظام عند الرفض في وضع `commit`:
إذا تم استدعاء `mode: "commit"` مع وجود أي فصل ناقص (`class_underfilled`) أو زائد (`class_overbooked`)، فإن الباك إند يرفض الحفظ ويرد بالآتي:
```json
{
  "mode": "commit",
  "termId": "65b1234567890abcdef12345",
  "slotsPerWeek": 38,
  "placed": 0,
  "written": 0,
  "failed": 0,
  "deleted": 0,
  "unplaced": 0,
  "skippedClasses": 0,
  "classes": [],
  "classPlans": [
    {
      "classId": "65b1234567890abcdef12346",
      "name": "٤/١",
      "gradeLevelId": "65a1234567890abcdef12340",
      "demand": 35,
      "capacity": 38,
      "free": 3,
      "missing": 3,
      "excess": 0,
      "ok": false
    }
  ],
  "problems": [
    {
      "type": "class_underfilled",
      "message": "٤/١ has 35 planned periods but its week has 38 slots. Add 3 periods to the grade's teaching plan.",
      "blocking": true,
      "classId": "65b1234567890abcdef12346",
      "className": "٤/١",
      "gradeLevelId": "65a1234567890abcdef12340",
      "required": 35,
      "capacity": 38,
      "missing": 3
    }
  ]
}
```

---

## 3. نماذج TypeScript للفرونت إند (Frontend Data Types)

يمكن نسخ هذه الواجهات مباشرة إلى ملف `types/timetable.ts` في مشروع الفرونت إند:

```typescript
// types/timetable.ts

export type TimetableProblemType =
  | 'no_working_days'             // لا توجد أيام عمل محددة
  | 'nothing_planned'             // لم يتم إدخال أي حصص لأي مادة
  | 'class_underfilled'           // [جديد] خطة الفصل ناقصة عن سعة الأسبوع
  | 'class_overbooked'            // خطة الفصل تتجاوز سعة الأسبوع
  | 'teacher_overloaded'          // المعلم تم إسناد حصص له أكثر من طاقته أو أوقات تفرغه
  | 'subject_unassigned'          // مادة في الخطة بدون معلم مسند (تحذيري)
  | 'assignment_wrong_term'       // إسناد يخص ترم آخر
  | 'assignment_pinned_elsewhere' // معلم مسند لفصل خارج مرحلة المادة
  | 'assignment_pin_conflict'     // تضارب معلمين مسندين لنفس الفصل والمادة
  | 'assignment_shared';          // مادة مشتركة بين معلمين بدون تخصيص فصول

export interface TimetableProblem {
  type: TimetableProblemType;
  message: string;
  blocking: boolean;
  classId?: string;
  className?: string;
  gradeLevelId?: string;
  required?: number;
  capacity?: number;
  missing?: number;               // عدد الحصص المتبقية لاكتمال الأسبوع
  excess?: number;                // عدد الحصص الزائدة عن الأسبوع
  teacherId?: string;
  teacherName?: string;
}

export interface ClassPlanSummary {
  classId: string;
  name: string;
  gradeLevelId: string;
  demand: number;                 // مجموع حصص المواد المدخلة
  capacity: number;               // سعة الأسبوع
  free: number;                   // الفارق (capacity - demand)
  missing: number;                // النقص إن وجد
  excess: number;                 // الزيادة إن وجدت
  ok: boolean;                    // true فقط إذا كان demand === capacity
}

export interface TeacherLoadSummary {
  teacherId: string;
  name: string;
  load: number;
  capacity: number;
  free: number;
  ok: boolean;
}

export interface FeasibilityReport {
  termId: string;
  slotsPerWeek: number;
  workingDays: string[];
  periodsPerDay: number;
  totalPeriodsNeeded: number;
  existingLectures: number;
  feasible: boolean;              // الجاهزية العامة للاعتماد (true تعني لا توجد أخطاء حاجبة)
  classes: ClassPlanSummary[];
  teachers: TeacherLoadSummary[];
  problems: TimetableProblem[];
  unassignedSubjects: Array<{
    classId: string;
    className: string;
    subjectName: string;
    periodsPerWeek: number;
  }>;
}

export interface GenerateTimetableDto {
  termId: string;
  classIds?: string[];
  mode?: 'preview' | 'commit';
  onExisting?: 'skip' | 'replace';
  maxSamePerDay?: number;
  includeUnstaffed?: boolean;
}
```

---

## 4. خطة تجربة المستخدم والشاشات (UX & Screen Specifications)

### الشاشة 1: شاشة توزيع حصص المواد (Curriculum / Subject Offerings)
> **الموقع:** شاشة تحديد نصاب المواد لكل صف دراسي (مثل: الصف الرابع: رياضيات 6، علوم 4...).

#### المتطلبات:
1. **شريط التقدم الحي (Live Week Capacity Meter):**
   - استدعاء سعة الأسبوع الحالية للمدرسة (`slotsPerWeek`).
   - حساب فوري لمجموع حصص الصف أثناء كتابة المستخدم في الحقول.
   - حالات العرض:
     - **أقل من السعة (ناقص):** شريط برتقالي:
       `⚠️ الحصص الموزعة: 35 من 38 حصة أسبوعياً (متبقي توزيع 3 حصص)`
     - **يساوي السعة تماماً (متوافق):** شريط أخضر:
       `✅ الخطة مكتملة ومتطابقة تماماً مع سعة الأسبوع (38 / 38 حصة)`
     - **أكبر من السعة (فائض):** شريط أحمر:
       `❌ تجاوزت سعة الأسبوع: 40 من 38 حصة (يجب تقليص حصتين)`
2. **حرية الحفظ الجزئي:**
   - السماح بحفظ التعديلات في أي وقت دون إعاقة، حتى يتمكن المستخدم من الإدخال على مراحل.

---

### الشاشة 2: لوحة فحص الجاهزية (Feasibility Dashboard)
> **الموقع:** شاشة تجهيز الجدول قبل التوليد (`/timetable/feasibility`).

#### المتطلبات:
1. **جدول جاهزية الفصول (Class Readiness Table):**
   - عرض جدول يحتوي على:
     - اسم الفصل (مثل: ٤/١، ٤/٢).
     - الحصص المقررة (`demand`).
     - سعة الأسبوع (`capacity`).
     - حالة الفصل:
       - إذا `ok === true`: بادج أخضر `مكتمل`.
       - إذا `missing > 0`: بادج برتقالي `ناقص (باقي {missing} حصص)`.
       - إذا `excess > 0`: بادج أحمر `تجاوز السعة ({excess}+)`.
2. **صندوق المشاكل الحاجبة (Blocking Errors Banner):**
   - عند وجود أخطاء من نوع `class_underfilled`، يتم عرض بطاقة تنبيه واضحة:
     > 🔴 **خطة غير مكتملة:**
     > فصل **٤/١** لديه **35** حصة موزعة، وسعة الأسبوع **38** حصة.
     > يلزم إضافة **3** حصص إضافية في خطة الصف الرابع.
     > `[زر: تعديل خطة الصف الرابع]` (ينقل مباشرة للمرحلة المطلوبة).
3. **أزرار الإجراءات (Actions):**
   - **زر المعاينة التجريبية (Preview):** مفعل دائماً.
   - **زر اعتماد وتوليد الجدول (Commit / Generate):**
     - يكون معطلاً (`disabled={!report.feasible}`).
     - عند المرور بالفأرة (Tooltip): *"لا يمكن اعتماد الجدول لوجود فصول لم تكتمل خطتها الدراسية"*.

---

### الشاشة 3: شاشة المعاينة والاعتماد (Preview & Final Commit)
> **الموقع:** شاشة عرض شبكة الجدول بعد الضغط على "معاينة".

#### المتطلبات:
1. **تنبيه المعاينة الناقصة (Draft Banner):**
   - إذا تم فتح المعاينة وهناك فصول فيها نقص:
     > ⚠️ **تنبيه:** هذا الجدول يحتوي على خانات فارغة نظراً لنقص الحصص المقررة لبعض الفصول. يمكنك الاطلاع عليه، ولكن لن تتمكن من اعتماده كجدول رسمي حتى يتم استكمال الحصص.
2. **تأكيد الاعتماد (Confirm Commit Modal):**
   - عند الضغط على "اعتماد نهائي"، يتم التحقق مرة أخرى من استجابة `POST /lectures/generate`.
   - إذا كانت الاستجابة `written === 0` مع وجود `class_underfilled`:
     - يتم فتح Modal يوضح الفصول الناقصة ورسالة واضحة للمدير مع توجيهه لاستكمال الحصص.

---

## 5. مصفوفة الحالات والقرارات (Decision Matrix)

| حالة مجموع حصص الفصل | نوع المشكلة | هل يمنع المعاينة (`preview`)؟ | هل يمنع الاعتماد (`commit`)؟ | ماذا تعرض الواجهة للمستخدم؟ |
| :--- | :--- | :---: | :---: | :--- |
| $\text{Demand} < \text{Capacity}$ | `class_underfilled` | ❌ لا | ✅ **نعم (حاجب)** | تنبيه بعدد الحصص الناقصة مع زر سريع لتعديل الخطة |
| $\text{Demand} > \text{Capacity}$ | `class_overbooked` | ❌ لا | ✅ **نعم (حاجب)** | تنبيه بالحصص الزائدة مع طلب تقليصها لتطابق السعة |
| $\text{Demand} == \text{Capacity}$ | لا توجد مشكلة فصل | ❌ لا | ❌ **لا (مسموح)** | علامة صح خضراء وجاهزية تامة للاعتماد |
| معلم نصابه أكبر من السعة | `teacher_overloaded` | ❌ لا | ✅ **نعم (حاجب)** | تنبيه باسم المعلم والحصص الزائدة عن طاقته |
| مادة بدون معلم | `subject_unassigned` | ❌ لا | ❌ **لا (تحذيري)** | علامة تنبيه صفراء، وتُجدول الحصص بدون معلم مؤقتاً |

---

## 6. مثال كود React / Vue إرشادي (Frontend Example Component)

```tsx
// components/FeasibilityCheckBanner.tsx
import React from 'react';
import { FeasibilityReport } from '../types/timetable';

interface Props {
  report: FeasibilityReport;
  onNavigateToCurriculum: (gradeLevelId: string) => void;
  onCommit: () => void;
  onPreview: () => void;
  isSubmitting: boolean;
}

export const FeasibilityCheckBanner: React.FC<Props> = ({
  report,
  onNavigateToCurriculum,
  onCommit,
  onPreview,
  isSubmitting,
}) => {
  const underfilledProblems = report.problems.filter(
    (p) => p.type === 'class_underfilled'
  );

  return (
    <div className="space-y-4 p-6 bg-white rounded-xl shadow-sm border border-gray-100">
      {/* رأس التقرير */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">حالة جاهزية الجدول المدرسي</h3>
          <p className="text-sm text-gray-500">
            سعة الأسبوع: {report.slotsPerWeek} حصة لكل فصل
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold ${
            report.feasible
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-rose-50 text-rose-700 border border-rose-200'
          }`}
        >
          {report.feasible ? 'جاهز للاعتماد' : 'غير مكتمل'}
        </span>
      </div>

      {/* قائمة الفصول غير المكتملة */}
      {underfilledProblems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 font-semibold">
            <span className="text-lg">⚠️</span>
            <span>توجد فصول لم تكتمل خطتها الدراسية ({underfilledProblems.length} فصل):</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {underfilledProblems.map((prob) => (
              <div
                key={prob.classId}
                className="flex items-center justify-between p-3 bg-white rounded border border-amber-100"
              >
                <div>
                  <span className="font-bold text-gray-800">{prob.className}</span>: تم توزيع{' '}
                  <span className="text-amber-700 font-semibold">{prob.required}</span> من أصل{' '}
                  <span className="text-gray-600">{prob.capacity}</span> حصة
                  <span className="block text-xs text-rose-600 font-medium">
                    (متبقي {prob.missing} حصص)
                  </span>
                </div>
                {prob.gradeLevelId && (
                  <button
                    onClick={() => onNavigateToCurriculum(prob.gradeLevelId!)}
                    className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded transition"
                  >
                    تعديل الخطة
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* أزرار الإجراءات */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onPreview}
          disabled={isSubmitting}
          className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-lg transition"
        >
          معاينة الجدول
        </button>

        <button
          onClick={onCommit}
          disabled={!report.feasible || isSubmitting}
          title={!report.feasible ? 'يجب استكمال حصص جميع الفصول للاعتماد' : ''}
          className={`px-5 py-2.5 font-medium rounded-lg transition ${
            report.feasible && !isSubmitting
              ? 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? 'جاري الحفظ...' : 'اعتماد وتوليد الجدول الرسمي'}
        </button>
      </div>
    </div>
  );
};
```
