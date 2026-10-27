# Mobile: «وثيقة الإقامة» for non-Saudi students

**For:** Azza (`nasaq_mobile`).
**Backend:** live. **Web:** done (student portal, school review page, statistics).
**The app needs both sides:** the student's screen, and the school's screens in the admin panel (`lib/owner/`, at the end of this file).
**Why:** the ministry reviews the residency document (iqama or visit visa) of every non-Saudi student. The family uploads it from the app, the school reviews it, and the family gets a notification with the decision.

## Where

- A new screen **«وثيقة الإقامة»** in the student app, linked from the home screen or the «المزيد» menu.
- **Show the link only to non-Saudi students:** hide it when the profile (`GET /students/me`) has `nationalityCode == "SA"` or a `nationality` containing «سعود». The server refuses a Saudi student's upload anyway (400).

## API (student token)

### `GET /students/me/residency-documents`
```json
{
  "current": { …document } | null,
  "documents": [ …document, newest first ]
}
```
- `current` is the latest **approved** document (the one that counts).
- `documents[0]` is the latest submission. Use it for the status banner below.

**document:**
```json
{
  "_id": "…",
  "type": "iqama",               // iqama | visit_visa | passport | other
  "typeLabel": "إقامة",          // ready to show (the typed name for "other")
  "documentNumber": "2456789012",
  "issueDate": "2025-12-01T00:00:00.000Z",
  "expiryDate": "2026-11-15T00:00:00.000Z",
  "isExpired": false,
  "status": "pending",           // pending | approved | rejected
  "rejectionReason": null,       // text when rejected
  "uploadedByRole": "STUDENT",   // or OWNER / MANAGER… when the school uploaded it
  "createdAt": "…",
  "files": [{ "url": "/residency-documents/<id>/files/0", "originalName": "iqama.jpg", "mimeType": "image/jpeg", "size": 123456 }]
}
```

### `POST /students/me/residency-documents` (multipart/form-data)

| Field | |
|---|---|
| `type` | **required**: `iqama` · `visit_visa` · `passport` · `other` |
| `otherTypeLabel` | required when `type=other` (up to 60 characters) |
| `documentNumber` | optional (up to 40 characters) |
| `issueDate` | optional, `YYYY-MM-DD` |
| `expiryDate` | optional, `YYYY-MM-DD`, must be after `issueDate` |
| `files` | **1 or 2 files** under the **same** field name `files` (front and back). JPG, PNG, WEBP, HEIC or PDF, up to **10 MB** each |

- Returns 201 with the new document, `status: "pending"`.
- **A new upload while one is still pending replaces it.** So "upload again" is the way to correct a mistake.
- 400 errors carry an Arabic `message`: show it as is.

### Opening a file
`GET <file.url>` with the **`Authorization: Bearer` header**. These files are **not public links**: without the token the server answers 401, so `Image.network(url)` without headers will not work. Load the bytes with the auth header, then show an image viewer, or open PDFs with the device viewer.

## The screen

1. **Status banner** (from `documents[0]` and `current`):
   - No documents → «لم تُرفع وثيقة إقامة بعد. يرجى رفع صورة الإقامة أو تأشيرة الزيارة.»
   - `pending` → «وثيقتك قيد المراجعة لدى المدرسة.»
   - `rejected` → «رفضت المدرسة الوثيقة الأخيرة: {rejectionReason}. يرجى رفعها مرة أخرى.» (in red)
   - `current.isExpired` → «انتهت صلاحية وثيقتك. يرجى رفع وثيقة سارية.»
   - Approved and valid → no banner, just the card.
2. **«رفع وثيقة»** button → a form:
   - نوع الوثيقة: إقامة / تأشيرة زيارة / جواز سفر / أخرى (اسم الوثيقة appears for أخرى)
   - رقم الوثيقة (اختياري) · تاريخ الإصدار (اختياري) · تاريخ الانتهاء (اختياري)
   - Up to 2 images or PDFs, from the **camera or the gallery**. Compress camera photos so they stay under 10 MB.
   - A note: «تُرسل الوثيقة إلى المدرسة للمراجعة، وتصلك رسالة بالقرار.»
3. **Document cards**, newest first: type, number, issue and expiry dates, status chip (قيد المراجعة amber · مقبولة green · مرفوضة red · «منتهية» red when approved and expired), the rejection reason, and «عرض الملف» buttons.

## Notifications

New type **`residency_document_reviewed`**, sent to the student after the school decides. `data`: `{ documentId, status }`.
- Title: «تم قبول وثيقة الإقامة» or «تم رفض وثيقة الإقامة». The body has the reason when rejected.
- Tapping it opens the «وثيقة الإقامة» screen.

(`residency_document_submitted` goes to the school's admins; the web handles it.)

All text is formal Arabic (فصحى), as written above.

## The school's side (admin panel, `lib/owner/`)

Shown to OWNER, SUPERVISOR, SUPER_ADMIN, and MANAGER with `PermissionHelper.can('read', 'students')`. Accepting, rejecting, uploading and deleting need `can('update', 'students')`.

### 1. Review screen «وثائق الإقامة»
A sidebar item in `individuals`, after «إحصائيات الطلاب».

`GET /residency-documents?status=pending|approved|rejected` (default `pending`). Tabs: قيد المراجعة · المقبولة · المرفوضة. Each item is a document (same shape as above) plus:
```json
"student": { "_id", "name", "className", "nationality" }
```
- Show the student's name (it opens their profile), class and nationality, then the document card.
- On pending items: **«قبول»** → `PATCH /residency-documents/:id/review` with `{ "decision": "approved" }`.
- **«رفض»** → a dialog «سبب الرفض» (required, up to 300 characters; «يظهر السبب للطالب ليرفع الوثيقة مرة أخرى.») → `{ "decision": "rejected", "reason": "…" }`.
- A document already reviewed → 400 «تمت مراجعة هذه الوثيقة من قبل»: show it and reload.
- Empty pending tab: «لا توجد وثائق بانتظار المراجعة.»

### 2. On the student's profile (non-Saudi students only)
A section **«وثيقة الإقامة»** (hide it for Saudi students, same rule as above).

`GET /students/:id/residency-documents` → `{ current, documents }`:
- Pending documents first, with قبول / رفض.
- Then `current` (the approved one), highlighted. If there is none and nothing is pending: «لا توجد وثيقة إقامة معتمدة لهذا الطالب.»
- Then «الوثائق السابقة».
- **«رفع وثيقة»** → the same form as the student's, sent to `POST /students/:id/residency-documents` (same multipart fields). **The school's upload is approved immediately.** Put this note in the form: «الوثيقة التي ترفعها المدرسة تُعتمد مباشرة.»
- **«حذف»** on any document → confirm «حذف هذه الوثيقة وملفاتها نهائيًا؟» → `DELETE /residency-documents/:id`.

### 3. On «إضافة طالب» (add student)
When the chosen nationality is not Saudi, show a section **«وثيقة الإقامة (اختياري)»** with the same fields, and the note «تُرفع بعد حفظ الطالب وتُعتمد مباشرة، ويمكن رفعها لاحقًا من صفحة الطالب.»
- Optional, **but once the user starts filling it, it must be complete** (at least one file, plus the name when the type is «أخرى»). Otherwise show the error and don't create the student.
- After `POST /students` succeeds, take the new student's id and call `POST /students/:id/residency-documents`.
- If the upload fails, the student still exists. Show a warning that stays on screen: «تمت إضافة الطالب، لكن تعذر رفع وثيقة الإقامة: {message}. يمكن رفعها من صفحة الطالب.»
- Also show the section on «تعديل طالب» (same as the profile section above).

### 4. Notification
`residency_document_submitted` goes to the school's admins when a student uploads. `data`: `{ documentId, studentId }`. Tapping it opens the review screen.

## Test (QA school only, never مواهب)

1. Log in as a non-Saudi student: the link shows. A Saudi student: it does not.
2. Upload an iqama with two photos and dates: the card shows «قيد المراجعة».
3. Upload again: still one pending card, the new one.
4. From the web, the school rejects it with a reason: a push arrives, and the screen shows the reason in red.
5. Upload again and the school accepts: «مقبولة» shows, and «عرض الملف» opens the image.
6. A file larger than 10 MB, or a Word file: a clear message, nothing uploaded.
7. As the school owner: the student's upload shows in «وثائق الإقامة» and a notification arrives; accept it from the app.
8. On a non-Saudi student's profile, upload a document as the school: it shows as «مقبولة» directly. Delete it: it disappears.
