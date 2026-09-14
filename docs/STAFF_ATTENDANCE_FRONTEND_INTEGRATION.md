# تكامل حضور وانصراف المدير والإداري والمشرف — Web & Mobile

هذا الملف هو عقد التكامل مع إضافة الباك إند الخاصة بحسابات `MANAGER` و`SUPERVISOR`.
التنفيذ موجود في `src/staff-attendance/`، ويلزم نشر نسخة الباك إند التي تحتوي عليه قبل استخدام المسارات الجديدة.

## 1. نطاق الميزة وطريقة توجيه الحسابات

| نوع الحساب في تسجيل الدخول `role` | الحضور الشخصي | مسار الحضور الشخصي | إدارة حضور الإداريين والمشرفين |
| --- | --- | --- | --- |
| `MANAGER` | متاح | `/staff-attendance` | متاحة |
| `SUPERVISOR` | متاح | `/staff-attendance` | متاحة |
| `OWNER` | غير مشمول | — | متاحة |
| `TEACHER` | الميزة الحالية للمعلمين | `/teacher-attendance` | غير متاحة |
| `STUDENT` | نظام غياب الطلاب الحالي | `/attendance` | غير متاحة |
| `SUPER_ADMIN` | غير مشمول | — | غير متاحة مباشرة بحساب المنصة |

- المدير المقصود هنا حساب `Admin` بدور `MANAGER`، والمشرف حساب `Admin` بدور `SUPERVISOR`.
- المعلم الذي يحمل `isManager: true` يظل دوره `TEACHER`؛ استخدم له مسارات المعلمين، ولا تنشئ له سجلًا ثانيًا في حضور الإداريين.
- وجود سجل حضور يعني أن الشخص حاضر في ذلك اليوم. الغياب يُحسب من الحسابات المؤهلة التي ليس لها سجل.
- لا يوجد طلب لتسجيل «غائب» مباشرة. حذف سجل الحضور يعيد الشخص إلى كشف الغياب لذلك اليوم إذا كان يوم عمل.
- المسارات القديمة للطلاب والمعلمين تحتفظ بعقودها الحالية. لا تفترض أن شكل استجابتها مطابق لشكل `/staff-attendance`.
- يمكن عرض تبويبين في شاشة إدارة الحضور: «المعلمون» و«الإداريون والمشرفون»، ولكل تبويب مصدر بياناته.

## 2. الاتصال والصلاحيات

المسارات أدناه تضاف إلى عنوان الباك إند الموجود في إعدادات التطبيق. لا توجد بادئة `/api` في كود التطبيق للمسارات التشغيلية. توثيق Swagger في `/api/docs`، قسم `Staff Attendance`.

```http
Authorization: Bearer <school-user-token>
Content-Type: application/json
```

- استخدم توكن تسجيل الدخول الحالي. المدرسة تُستخرج من التوكن على الخادم.
- لا ترسل `schoolId` أو `recordedBy` في الطلب. لا يمكن اختيار مدرسة أخرى بهيدر.
- التسجيل الذاتي يأخذ هوية الشخص من التوكن؛ لا ترسل `staffId` أو `role` أو توقيت الجهاز في `check-in` و`check-out`.
- الحقول غير المعرفة في طلبات الجسم أو الاستعلام المعرّفة بـ DTO تُرفض بـ `400`.
- صلاحيات هذه المسارات تعتمد على `role` مباشرة. لا تنتظر مفتاحًا جديدًا مثل `school.staffAttendance.create` داخل `permissions`.
- الحسابات الإدارية الثلاثة `OWNER` و`MANAGER` و`SUPERVISOR` تستطيع عرض السجلات والتقارير والتسجيل اليدوي والتعديل والحذف لجميع الإداريين والمشرفين داخل المدرسة، بما في ذلك سجلاتها هي.

## 3. إعداد المدرسة وتفعيل التسجيل الذاتي

### قراءة الإعدادات

```http
GET /schools/me/settings
```

مثال مقتطف من الاستجابة الفعلية؛ يمكن أن توجد إعدادات أخرى:

```json
{
  "status": true,
  "message": "Success",
  "data": {
    "timezone": "Asia/Riyadh",
    "staffCheckInEnabled": true,
    "teacherCheckInEnabled": false,
    "location": { "lat": 24.7136, "lng": 46.6753 },
    "checkInRadiusMeters": 150,
    "schoolNetworkIps": ["203.0.113.10"],
    "workSchedule": [
      { "day": "sunday", "isWorkingDay": true, "startTime": "07:30", "endTime": "14:00" },
      { "day": "monday", "isWorkingDay": true, "startTime": "07:30", "endTime": "14:00" },
      { "day": "tuesday", "isWorkingDay": true, "startTime": "07:30", "endTime": "14:00" },
      { "day": "wednesday", "isWorkingDay": true, "startTime": "07:30", "endTime": "14:00" },
      { "day": "thursday", "isWorkingDay": true, "startTime": "07:30", "endTime": "14:00" },
      { "day": "friday", "isWorkingDay": false },
      { "day": "saturday", "isWorkingDay": false }
    ]
  }
}
```

`staffCheckInEnabled` مفتاح جديد، وقيمته الافتراضية `false`. إذا لم يوجد في بيانات مدرسة قديمة، تعامل معه كـ `false`.
هو مستقل عن `teacherCheckInEnabled`، ويشمل المدير والإداري والمشرف معًا.

### تعديل الإعدادات

```http
PATCH /schools/me/settings
```

```json
{
  "staffCheckInEnabled": true,
  "location": { "lat": 24.7136, "lng": 46.6753 },
  "checkInRadiusMeters": 150,
  "schoolNetworkIps": ["203.0.113.10"]
}
```

- الصلاحيات: `OWNER`، `MANAGER`، `SUPERVISOR`.
- النجاح `200`، وبنفس غلاف قراءة الإعدادات، وتحت `data` الإعدادات المحفوظة.
- التفعيل يتطلب موقعًا محفوظًا أو موقعًا في الطلب نفسه؛ وإلا `400`.
- الموقع والشبكة والمنطقة الزمنية وجدول العمل إعدادات مشتركة مع حضور المعلمين.
- `checkInRadiusMeters`: عدد صحيح من `20` إلى `2000`، والافتراضي `150` مترًا.
- يمكن إرسال `workSchedule` أيضًا؛ إرسال المصفوفة يستبدل الجدول بالكامل. اقرأ الجدول الحالي وأرسل الأيام السبعة كاملة عند تعديله.
- اليوم غير الموجود في الجدول، أو الجدول الفارغ، يُعامل كيوم عمل دون أوقات محددة؛ املأ جميع الأيام لتعريف الإجازات بوضوح.
- إيقاف التسجيل الذاتي يمنع الحضور والانصراف بالموقع. التسجيل اليدوي والتقارير تظل متاحة.
- عنوان IP في المثال للتوضيح فقط؛ احفظ عنوان شبكة المدرسة الحقيقي.

### اكتشاف عنوان الشبكة

```http
GET /staff-attendance/detect-ip
```

```json
{ "status": true, "data": { "ip": "203.0.113.10" } }
```

استخدمه أثناء اتصال الجهاز بشبكة المدرسة، ثم احفظه ضمن `schoolNetworkIps` عبر إعدادات المدرسة. الطلب لا يحفظ العنوان تلقائيًا.

## 4. ملخص جميع المسارات الجديدة

| Method | المسار | الصلاحيات | الغرض | النجاح |
| --- | --- | --- | --- | --- |
| `POST` | `/staff-attendance/check-in` | `MANAGER`, `SUPERVISOR` | حضور الشخص الحالي | `200` |
| `POST` | `/staff-attendance/check-out` | `MANAGER`, `SUPERVISOR` | انصراف الشخص الحالي | `200` |
| `GET` | `/staff-attendance/me` | `MANAGER`, `SUPERVISOR` | السجل الشخصي | `200` |
| `GET` | `/staff-attendance/staff` | الأدوار الإدارية الثلاثة | قائمة الأشخاص المؤهلين | `200` |
| `GET` | `/staff-attendance/detect-ip` | الأدوار الإدارية الثلاثة | عنوان الشبكة الحالي | `200` |
| `POST` | `/staff-attendance` | الأدوار الإدارية الثلاثة | تسجيل يدوي | `201` |
| `GET` | `/staff-attendance` | الأدوار الإدارية الثلاثة | قائمة السجلات | `200` |
| `GET` | `/staff-attendance/absent` | الأدوار الإدارية الثلاثة | كشف الغياب اليومي | `200` |
| `GET` | `/staff-attendance/summary` | الأدوار الإدارية الثلاثة | تقرير فترة | `200` |
| `PATCH` | `/staff-attendance/:id` | الأدوار الإدارية الثلاثة | تصحيح سجل | `200` |
| `DELETE` | `/staff-attendance/:id` | الأدوار الإدارية الثلاثة | حذف سجل | `200` |

المقصود بـ `:id` معرّف سجل الحضور `_id`، وليس `staffId`.

## 5. التسجيل الذاتي وشكل السجل

### تسجيل الحضور

```http
POST /staff-attendance/check-in
```

```json
{
  "lat": 24.7136,
  "lng": 46.6753,
  "mockLocationSuspected": false
}
```

`lat` و`lng` أرقام مطلوبة. نطاق `lat` من `-90` إلى `90`، ونطاق `lng` من `-180` إلى `180`.
`mockLocationSuspected` اختياري؛ يدوَّن للمراجعة ولا يسبب الرفض تلقائيًا.

التحقق:

| GPS داخل النطاق | الاتصال من شبكة معتمدة | النتيجة |
| --- | --- | --- |
| نعم | نعم | يقبل، تحقق كامل |
| نعم | لا | يقبل، تحقق بالموقع فقط |
| لا | نعم | يقبل، تحقق بالشبكة فقط |
| لا | لا | يرفض بـ `403` |

الإحداثيات مطلوبة حتى عند الاتصال بشبكة معتمدة. الخادم يستخرج IP من الاتصال، ولا يقبل IP من جسم الطلب.
وقت الحضور يؤخذ من ساعة الخادم. يوم السجل يحدَّد حسب `settings.timezone`.

مثال استجابة `200`، وهو أيضًا شكل السجل الذي تعيده القوائم:

```json
{
  "status": true,
  "message": "تم تسجيل حضورك",
  "data": {
    "_id": "60d5ecb8b5c9c22b8c8b4570",
    "schoolId": "60d5ecb8b5c9c22b8c8b4561",
    "staffId": "60d5ecb8b5c9c22b8c8b4563",
    "role": "MANAGER",
    "name": "أحمد محمد",
    "date": "2026-09-14T00:00:00.000Z",
    "checkInAt": "2026-09-14T04:45:00.000Z",
    "checkOutAt": null,
    "method": "location",
    "checkOutMethod": null,
    "coordinates": { "lat": 24.7136, "lng": 46.6753 },
    "checkOutCoordinates": null,
    "distanceMeters": 0,
    "checkOutDistanceMeters": null,
    "verification": { "gps": true, "network": true },
    "checkOutVerification": null,
    "mockLocationSuspected": false,
    "checkOutMockLocationSuspected": false,
    "recordedBy": null,
    "notes": "",
    "lateMinutes": 15,
    "earlyLeaveMinutes": null,
    "workMinutes": null,
    "expectedWorkMinutes": 390,
    "isWorkingDay": true,
    "createdAt": "2026-09-14T04:45:00.000Z",
    "updatedAt": "2026-09-14T04:45:00.000Z",
    "__v": 0
  }
}
```

- `staffId` دائمًا نص معرّف الحساب؛ لا يتحول إلى كائن populated في القوائم.
- `name` نسخة محفوظة من `Admin.username`، و`role` نسخة من الدور وقت إنشاء السجل.
- `recordedBy` هو معرّف آخر إداري سجّل يدويًا أو عدّل السجل؛ يكون `null` عند التسجيل الذاتي دون تعديل إداري.
- `lateMinutes` و`earlyLeaveMinutes` بالدقائق، و`null` تعني عدم وجود قياس، وليست صفرًا.
- `workMinutes` تظل `null` حتى تسجيل الانصراف.
- `isWorkingDay: false` يعني حضورًا في يوم إجازة. التسجيل فيه مسموح، وتظهر أيام الإجازة منفصلة في إحصائية التقرير.
- `__v` حقل داخلي لا يحتاج إلى عرضه أو إرساله.

### تسجيل الانصراف

```http
POST /staff-attendance/check-out
```

نفس جسم طلب الحضور. النجاح `200`:

```json
{
  "status": true,
  "message": "تم تسجيل انصرافك",
  "data": {
    "_id": "60d5ecb8b5c9c22b8c8b4570",
    "staffId": "60d5ecb8b5c9c22b8c8b4563",
    "checkInAt": "2026-09-14T04:45:00.000Z",
    "checkOutAt": "2026-09-14T10:30:00.000Z",
    "checkOutMethod": "location",
    "checkOutCoordinates": { "lat": 24.7136, "lng": 46.6753 },
    "checkOutDistanceMeters": 0,
    "checkOutVerification": { "gps": true, "network": true },
    "workMinutes": 345,
    "earlyLeaveMinutes": 30,
    "expectedWorkMinutes": 390
  }
}
```

المثال السابق مقتطف؛ `data` الفعلية تحتوي السجل الكامل بنفس حقول سجل الحضور.
يتطلب سجل حضور لنفس يوم المدرسة. تسجيل انصراف يوم سابق عبر هذا المسار غير مدعوم؛ يستخدم الإداري تعديل السجل يدويًا.
اعرض تحقق الانصراف من `checkOutVerification` ومسافته من `checkOutDistanceMeters`، لأن `verification` و`distanceMeters` يخصان الحضور.

### تكرار الحضور أو الانصراف

لا تنشئ الواجهة سجلات مكررة عند الضغط مرتين أو إعادة الطلب بعد انقطاع الشبكة. الخادم يعيد `409`:

```json
{
  "status": false,
  "message": "تم تسجيل الحضور لهذا اليوم بالفعل",
  "statusCode": 409,
  "data": {
    "alreadyCheckedIn": true,
    "record": {
      "_id": "60d5ecb8b5c9c22b8c8b4570",
      "staffId": "60d5ecb8b5c9c22b8c8b4563",
      "checkInAt": "2026-09-14T04:45:00.000Z",
      "checkOutAt": null
    }
  }
}
```

`record` في المثال مقتطف، والاستجابة تعيد السجل الموجود كاملًا. عند تكرار الانصراف تكون العلامة `alreadyCheckedOut: true`.
اقرأ `data.record` لتحديث الشاشة، أو أعد جلب `/me` عند غيابه. لا تعتبر `409` نجاح تسجيل جديد، ولا تعرضه كعطل عام.

## 6. السجل الشخصي وقائمة السجلات

```http
GET /staff-attendance/me?date=2026-09-14&page=1&limit=10
GET /staff-attendance?role=SUPERVISOR&dateFrom=2026-09-01&dateTo=2026-09-30&page=1&limit=10
```

| Query | النوع | الملاحظات |
| --- | --- | --- |
| `staffId` | Mongo ObjectId | فلتر شخص في قائمة الإدارة؛ يُتجاهل في `/me` وتُفرض هوية صاحب التوكن |
| `role` | `MANAGER` أو `SUPERVISOR` | دور السجل المحفوظ؛ يُتجاهل في `/me` |
| `date` | `YYYY-MM-DD` | تاريخ محدد؛ له الأولوية على النطاق |
| `dateFrom` | `YYYY-MM-DD` | بداية شاملة |
| `dateTo` | `YYYY-MM-DD` | نهاية شاملة، ويجب ألا تسبق البداية |
| `method` | `location` أو `manual` | طريقة تسجيل الحضور |
| `page` | عدد صحيح ≥ 1 | الافتراضي 1 |
| `limit` | عدد صحيح من 1 إلى 100 | الافتراضي 10 |

كل الفلاتر اختيارية. الترتيب بالأحدث أولًا.

```json
{
  "status": true,
  "data": [],
  "meta": { "total": 0, "page": 1, "limit": 10, "totalPages": 0 }
}
```

عند وجود نتائج تكون عناصر `data` سجلات كاملة بالشكل الموضح سابقًا. بيانات التصفح في `meta` على المستوى الأعلى، وليست تحت `pagination` أو `data.meta`.

## 7. اختيار الشخص والتسجيل اليدوي

### مصدر قائمة الاختيار

```http
GET /staff-attendance/staff
GET /staff-attendance/staff?role=MANAGER
```

```json
{
  "status": true,
  "data": [
    {
      "staffId": "60d5ecb8b5c9c22b8c8b4563",
      "name": "أحمد محمد",
      "email": "ahmed@example.invalid",
      "role": "MANAGER"
    }
  ]
}
```

القائمة غير مقسمة إلى صفحات، وتضم الحسابات الحالية المؤهلة في المدرسة. استخدم `staffId` منها في التسجيل اليدوي والفلاتر.
لا تستخدم معرّفات المعلمين أو مالك المدرسة؛ يرفضها التسجيل اليدوي بـ `404`.

### إنشاء سجل يدوي

```http
POST /staff-attendance
```

```json
{
  "staffId": "60d5ecb8b5c9c22b8c8b4563",
  "date": "2026-09-14",
  "checkInAt": "2026-09-14T07:45:00+03:00",
  "checkOutAt": "2026-09-14T13:30:00+03:00",
  "notes": "تم التسجيل بواسطة الإدارة"
}
```

- `staffId` و`date` و`checkInAt` مطلوبة.
- `checkOutAt` اختياري؛ احذفه إذا كان الموظف لم ينصرف بعد.
- `notes` اختياري، بحد أقصى 2000 حرف.
- الوقت بصيغة ISO كاملة مع الثواني ومع `Z` أو إزاحة مثل `+03:00`. `07:45` وحدها غير مقبولة هنا.
- يجب أن يقع الوقت في نفس `date` وفق المنطقة الزمنية للمدرسة، وألا يكون في المستقبل.
- الانصراف لا يسبق الحضور. يسمح النظام بسجل واحد لكل شخص لكل يوم.
- لا يشترط تفعيل التسجيل الذاتي أو إرسال إحداثيات للتسجيل اليدوي.

النجاح `201`:

```json
{
  "status": true,
  "message": "تم تسجيل الحضور يدويًا",
  "data": {
    "_id": "60d5ecb8b5c9c22b8c8b4570",
    "staffId": "60d5ecb8b5c9c22b8c8b4563",
    "method": "manual",
    "checkOutMethod": "manual",
    "recordedBy": "60d5ecb8b5c9c22b8c8b4564",
    "verification": { "gps": false, "network": false },
    "lateMinutes": 15,
    "earlyLeaveMinutes": 30,
    "workMinutes": 345
  }
}
```

`data` الفعلية هي السجل الكامل؛ المثال مقتطف.

### تصحيح سجل

```http
PATCH /staff-attendance/60d5ecb8b5c9c22b8c8b4570
```

```json
{
  "checkInAt": "2026-09-14T07:30:00+03:00",
  "checkOutAt": "2026-09-14T14:00:00+03:00",
  "notes": "تصحيح وقت الحضور والانصراف"
}
```

الحقول الثلاثة اختيارية، ويمكن إرسال واحد منها. لا يمكن نقل السجل إلى شخص أو تاريخ آخر بهذا الطلب.
النجاح `200`: `{ "status": true, "message": "تم تعديل سجل الحضور", "data": <السجل الكامل> }`.
التوقيت المعدل تصبح طريقته `manual` وتُمسح إحداثياته وبيانات التحقق السابقة، وتُحدّث الدقائق المحسوبة و`recordedBy`.
إرسال `notes: ""` يمسح الملاحظات. لمسح سجل أو إعادة يومه إلى غير مسجل، استخدم الحذف.

### حذف سجل

```http
DELETE /staff-attendance/60d5ecb8b5c9c22b8c8b4570
```

```json
{ "status": true, "message": "تم حذف سجل الحضور بنجاح" }
```

بعد النجاح حدّث القائمة وكشف الغياب والتقرير والسجل الشخصي عند الحاجة.

## 8. كشف الغياب

```http
GET /staff-attendance/absent?date=2026-09-14
GET /staff-attendance/absent?date=2026-09-14&role=SUPERVISOR
```

`date` اختياري؛ الافتراضي اليوم في منطقة المدرسة الزمنية. لا يقبل تاريخًا مستقبليًا.

```json
{
  "status": true,
  "date": "2026-09-14",
  "isWorkingDay": true,
  "totalAbsent": 1,
  "absentStaff": [
    {
      "staffId": "60d5ecb8b5c9c22b8c8b4565",
      "name": "خالد علي",
      "email": "khaled@example.invalid",
      "role": "SUPERVISOR"
    }
  ]
}
```

في يوم إجازة: `isWorkingDay: false` و`totalAbsent: 0` و`absentStaff: []`.
القائمة تحت `absentStaff` مباشرة، وليس `data`.
تُحسب من المديرين والمشرفين الموجودين حاليًا في المدرسة؛ نموذج `Admin` الحالي لا يحتوي حالة `isActive` مستقلة للموظف.
لذلك الكشف التاريخي يستخدم قائمة الحسابات الحالية، ولا يعيد بناء تاريخ التعيين أو الحذف.
كشف اليوم يعني «لم يسجل حتى الآن»؛ قد يظهر الشخص قبل موعد وصوله. لا توجد مهلة تأخير تغيّر عضوية الكشف.

## 9. تقرير الفترة

```http
GET /staff-attendance/summary?dateFrom=2026-09-01&dateTo=2026-09-30
```

`dateFrom` و`dateTo` مطلوبان وشاملان. `staffId` و`role` اختياريان. لا توجد pagination لهذا التقرير.

```json
{
  "status": true,
  "dateFrom": "2026-09-01",
  "dateTo": "2026-09-30",
  "totalStaff": 1,
  "data": [
    {
      "staffId": "60d5ecb8b5c9c22b8c8b4563",
      "name": "أحمد محمد",
      "role": "MANAGER",
      "daysPresent": 2,
      "daysLate": 1,
      "totalLateMinutes": 15,
      "daysLeftEarly": 1,
      "totalEarlyLeaveMinutes": 30,
      "totalWorkMinutes": 345,
      "totalExpectedWorkMinutes": 780,
      "daysMissingCheckOut": 1,
      "daysLatenessNotTracked": 0,
      "daysEarlyLeaveNotTracked": 0,
      "daysOnDayOff": 0
    }
  ]
}
```

| الحقل | المعنى |
| --- | --- |
| `totalStaff` | عدد أصحاب السجلات في نتيجة الفترة، وليس إجمالي موظفي المدرسة |
| `daysPresent` | عدد أيام وجود سجل، بما فيها حضور أيام الإجازة |
| `daysLate` / `totalLateMinutes` | أيام التأخر ومجموع دقائقه |
| `daysLeftEarly` / `totalEarlyLeaveMinutes` | أيام الانصراف المبكر ومجموع دقائقه |
| `totalWorkMinutes` | مجموع وقت العمل المقاس للأيام التي لها انصراف |
| `totalExpectedWorkMinutes` | مجموع مدة الدوام المتوقعة المحفوظة في سجلات الفترة |
| `daysMissingCheckOut` | سجلات حضور لم يُسجَّل انصرافها |
| `daysLatenessNotTracked` | سجلات لا يوجد بها قياس للتأخر |
| `daysEarlyLeaveNotTracked` | سجلات لها انصراف ولكن دون قياس للانصراف المبكر |
| `daysOnDayOff` | أيام الحضور التي كانت إجازة في جدول المدرسة |

التقرير يضم من لديه سجل واحد على الأقل في الفترة. لا يعيد `daysAbsent` ولا أصحاب الحضور الصفري.
لا تحسب الغياب بطرح `daysPresent` من عدد أيام التقويم. استخدم كشف الغياب اليومي.
الاسم والدور في التقرير من أحدث سجل مطابق للفلاتر، وتبقى السجلات التاريخية قابلة للعرض حتى إذا حذف الحساب.
الإحصاءات تقرأ القيم المحفوظة وقت التسجيل أو التصحيح؛ تعديل جدول المدرسة وحده لا يعيد حساب السجلات القديمة.
نظام استئذان المعلمين الحالي لم يُمدَّد إلى الإداريين هنا؛ لا تتوقع حقول `earlyLeaveApproved` أو `approvedLeaveAt` في سجلاتهم.

## 10. التوقيت وحالات شاشة «حضوري»

1. افحص `role` لإظهار الصفحة للمدير أو المشرف.
2. اقرأ إعدادات المدرسة للحصول على `timezone` و`staffCheckInEnabled`.
3. احسب تاريخ اليوم في منطقة المدرسة الزمنية، ثم اطلب `/staff-attendance/me?date=YYYY-MM-DD`.
4. لا يوجد سجل: أظهر زر «تسجيل الحضور» إذا كان التسجيل الذاتي مفعّلًا.
5. يوجد سجل و`checkOutAt === null`: اعرض وقت الحضور وزر «تسجيل الانصراف» إذا كان التسجيل الذاتي مفعّلًا.
6. يوجد انصراف: اعرض وقتي الحضور والانصراف ومدة العمل.
7. عند الضغط اطلب إحداثيات حديثة، وأرسل الطلب، وعطّل الزر أثناء انتظار النتيجة.
8. بعد نجاح الطلب أو `409` حدّث الحالة من السجل الذي يعيده الخادم أو من `/me`.
9. عند تعطل الشبكة بعد الإرسال، تحقق من `/me` قبل إعادة المحاولة؛ قد يكون الطلب الأول قد حُفظ.

نقاط مهمة للويب والموبايل:

- `date` في السجل مفتاح يوم مدرسة ممثّل بمنتصف الليل UTC. خذ أول 10 أحرف منه للتاريخ؛ تحويل هذا الحقل إلى منطقة جهاز مختلفة قد يعرض يومًا خطأ.
- `checkInAt` و`checkOutAt` لحظات زمنية فعلية. اعرضها بتوقيت المدرسة، وأظهر اسم المنطقة عند الحاجة.
- لا تستخدم `new Date().toISOString().slice(0, 10)` لحساب اليوم؛ قد يختلف يوم UTC عن يوم المدرسة.
- أوقات `workSchedule` بصيغة `HH:mm` تعني توقيت المدرسة المحلي.
- في نموذج التسجيل اليدوي، حوّل الوقت الذي يختاره المستخدم في منطقة المدرسة إلى ISO بإزاحته الصحيحة أو إلى UTC. لا تضف `Z` مباشرة إلى ساعة محلية، ولا تثبّت `+03:00` لجميع المدارس.
- في الويب شغّل تحديد الموقع على HTTPS أو localhost. في الموبايل اطلب إذن الموقع وتعامل مع رفضه أو توقف خدمة الموقع.
- عند تعذر الإحداثيات، وجّه المستخدم للتسجيل اليدوي بواسطة الإدارة؛ لا ترسل قيمًا افتراضية بدل الموقع الحقيقي.
- عرض علامة «تحقق بالموقع فقط» أو «تحقق بالشبكة فقط» يعتمد على قيم `verification` الفعلية.
- تعطيل التسجيل الذاتي لا يخفي السجل السابق؛ أظهر حالة تعطيل الخدمة مع البيانات المتاحة.

مثال TypeScript لتوجيه الواجهة وحساب اليوم:

```ts
type Role = 'OWNER' | 'MANAGER' | 'SUPERVISOR' | 'TEACHER' | 'STUDENT' | 'SUPER_ADMIN';

function personalAttendancePath(role: Role): string | null {
  if (role === 'MANAGER' || role === 'SUPERVISOR') return '/staff-attendance';
  if (role === 'TEACHER') return '/teacher-attendance';
  return null;
}

function schoolDate(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const read = (key: string) => parts.find(p => p.type === key)!.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

type StaffAttendanceState = 'not_checked_in' | 'checked_in' | 'checked_out';

function attendanceState(record?: { checkOutAt: string | null }): StaffAttendanceState {
  if (!record) return 'not_checked_in';
  return record.checkOutAt ? 'checked_out' : 'checked_in';
}
```

## 11. الأخطاء

شكل الخطأ العام:

```json
{
  "status": false,
  "message": "التسجيل الذاتي للإداريين والمشرفين غير مفعّل",
  "statusCode": 400
}
```

| HTTP | حالات متوقعة | تعامل الواجهة |
| --- | --- | --- |
| `400` | خدمة معطلة، موقع مدرسة غير مضبوط، طلب غير صالح، تاريخ أو ترتيب أوقات غير صالح، انصراف دون حضور | اعرض `message` ولا تغيّر حالة التسجيل إلى نجاح |
| `401` | توكن مفقود أو غير صالح أو منتهي | طبّق مسار تسجيل الدخول المعتاد |
| `403` | دور غير مسموح، مدرسة موقوفة، أو فشل تحقق الموقع والشبكة | اعرض سبب الرفض؛ لا تعاود الطلب آليًا دون تغيير السبب |
| `404` | سجل أو حساب مؤهل غير موجود ضمن المدرسة | حدّث القائمة أو أعد اختيار الشخص |
| `409` | سبق تسجيل الحضور أو الانصراف، بما في ذلك الطلبات المتزامنة | اقرأ `data.record` وحدّث الشاشة |

قد تتغير نصوص الرسائل؛ اعتمد على HTTP وعلى `alreadyCheckedIn`/`alreadyCheckedOut` للحالات البرمجية، واعرض `message` كنص للمستخدم.

## 12. قائمة التنفيذ والقبول لفريقي Web وMobile

- [ ] إضافة صفحة «حضوري» للمدير والإداري والمشرف، مع فصلها عن شاشة إدارة الجميع.
- [ ] إضافة مفتاح `staffCheckInEnabled` إلى إعدادات المدرسة، وقراءة القيمة المفقودة كـ `false`.
- [ ] ربط الموقع والشبكة وجدول الدوام والمنطقة الزمنية بالإعدادات الحالية.
- [ ] تنفيذ الحالات الثلاث: لم يسجل / حضر / انصرف، بناءً على سجل اليوم من الخادم.
- [ ] منع الضغط المتكرر أثناء الطلب، ومعالجة `409` وفقد الاتصال بعد الإرسال.
- [ ] استخدام `/staff-attendance/staff` لقائمة الأشخاص في التسجيل اليدوي والفلاتر.
- [ ] إضافة الإدخال اليدوي والتعديل والحذف، وتحديث البيانات المرتبطة بعد كل عملية.
- [ ] إظهار سجلات الحضور مع pagination من `meta` وكشف الغياب من `absentStaff`.
- [ ] إضافة تقرير فترة مع عرض القيم غير المقاسة والسجلات دون انصراف بوضوح.
- [ ] اختبار `MANAGER` و`SUPERVISOR` فعليًا، واختبار مستخدمين من مدرستين مختلفتين.
- [ ] اختبار الإذن المرفوض للموقع، الخدمة المعطلة، فشل GPS والشبكة معًا، ونجاح أحدهما فقط.
- [ ] اختبار يوم إجازة وتاريخ قرب منتصف الليل وتاريخ يدوي بإزاحة منطقة المدرسة.
- [ ] إبقاء المعلم صاحب `isManager: true` على تدفق `/teacher-attendance` الحالي.

## 13. ملاحظات النشر والتحقق من الباك إند

- لا تحتاج سجلات الطلاب أو المعلمين إلى تحويل بيانات. السجلات الجديدة تستخدم مجموعة `staffAttendance`.
- يتضمن المخطط فهرسًا فريدًا على `{ schoolId, staffId, date }` لمنع التكرار. تأكد من إنشاء فهارس الموديل عند النشر إذا كانت بيئتك تعطل `autoIndex`.
- بعد نشر الباك إند، فعّل `staffCheckInEnabled` للمدرسة المطلوبة من الإعدادات. لا توجد عملية في هذا التغيير تفعّله تلقائيًا لكل المدارس.
- يجب أن يعكس `TRUST_PROXY_HOPS` في إعداد الخادم عدد الوكلاء العكسيين الفعليين حتى يكون IP المستخدم في التحقق صحيحًا.
- اختبارات التكامل المحلية تستخدم JWT فعليًا وMongoDB محليًا بقاعدة مؤقتة مستقلة، وتشمل الصلاحيات وعزل المدارس والتكرار والتقارير وصحة استجابات HTTP.

أوامر التحقق:

```sh
npm run build
npm test -- --runInBand src/staff-attendance/staff-attendance.spec.ts src/teacher-attendance/teacher-attendance.spec.ts src/auth/route-authorization.spec.ts
```

اختبار `staff-attendance.spec.ts` يتطلب MongoDB محليًا على `127.0.0.1:27017`؛ ينشئ قاعدة باسم عشوائي يبدأ بـ `nasaq_staff_attendance_test_` ثم يحذف قاعدة الاختبار التي أنشأها فقط.
