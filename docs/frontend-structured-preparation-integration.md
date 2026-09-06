# Frontend Integration — Structured Lesson Preparation

**Audience:** frontend developer implementing the teacher preparation form, school curriculum management, and student lesson view.

**Contract:** the backend implementation in this repository. Examples below describe responses from the running application, including its global response wrapper. Object examples may omit unrelated fields.

## 1. What changes in the frontend

Replace upload-as-submission with a two-step form:

1. **المعلومات الأساسية:** select a curriculum lesson, enter warm-up and vocabulary, edit objectives, and select reusable digital content.
2. **إعداد الدرس:** enter teaching details and add at least one homework, activity, enrichment, or quiz resource.

Provide separate **حفظ المسودة** and **إرسال للمراجعة** actions. Creating or saving a preparation does not submit it. Uploading a PDF does not submit it either.

Keep supporting attachments and the existing review screens. Add the `draft` status throughout the UI.

| API status | Suggested label | Frontend behavior |
| --- | --- | --- |
| `draft` | مسودة | Editable; not counted as submitted; cannot be reviewed |
| `pending` | بانتظار المراجعة | Submitted successfully; do not submit it again |
| `approved` | معتمد | Show approval; a content edit returns it to draft |
| `needs_revision` | يحتاج إلى تعديل | Show `reviewNote`; allow editing and resubmission |

**There is no `submitted` status string in this API.** Use `pending` for submitted/awaiting-review records. Existing records retain their current review statuses.

## 2. Authentication and response handling

Use your configured backend base URL. The routes below have no additional `/api` prefix in the Nest application. Swagger is served at `/api/docs`.

```http
Authorization: Bearer <school-user-token>
Content-Type: application/json
```

The verified token determines the school. Do not send `schoolId`, `submittedBy`, `reviewStatus`, or other server-owned fields in preparation create/update bodies. Unknown DTO fields return HTTP 400.

### Success envelope

```json
{
  "status": true,
  "message": "تم إنشاء التحضير بنجاح",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "reviewStatus": "draft",
    "lessonId": null,
    "objectives": [],
    "digitalContentIds": []
  }
}
```

With Axios, the preparation is `response.data.data`. With `fetch`, it is `(await response.json()).data`. The backend unwraps service-level `{ message, data }` results into this envelope; do not expect a second nested `data` inside the preparation payload.

Paginated responses use:

```json
{
  "status": true,
  "message": "Success",
  "data": [],
  "pagination": { "totalDocs": 162, "totalPages": 2 }
}
```

The empty `data` above illustrates the response shape, not actual catalogue contents. `pagination` can be omitted when both totals are zero. Treat a missing pagination object plus an empty array as an empty result.

### Error envelope

```json
{
  "status": false,
  "message": "يجب إضافة هدف واحد على الأقل",
  "statusCode": 400
}
```

Display `message`. The global exception filter returns only the first DTO validation message, rather than an array of field errors.

## 3. IDs and permissions

Keep these IDs distinct:

| Field | Meaning |
| --- | --- |
| `catalogSubjectId` | Platform catalogue subject selected during import |
| `subjectId` | This school's Subject ID; used in curriculum queries/import |
| `gradeLevelId` | This school's GradeLevel ID |
| `subjectOfferingId` | Subject + grade + term offering; used by the lecture and library |
| Preparation `subject` | A subject-offering reference or archived snapshot; not the school's Subject ID |
| `lessonId` | This school's CurriculumLesson ID; never a CatalogLesson ID |
| `digitalContentIds` | Library document IDs |

Resolve the lecture's offering using the existing academic-data flow. Its `subjectId` and `gradeLevelId` drive the curriculum dropdowns. Pass the offering's own `_id` when creating a library item for that offering.

| Feature | Access |
| --- | --- |
| Read platform catalogue | Authenticated school users; platform admins can also read |
| Read school units/lessons | OWNER, MANAGER, SUPERVISOR, TEACHER |
| Import/create/edit/delete school curriculum | OWNER, MANAGER |
| Preparation create/read/update/delete | Corresponding Preparation ability; teachers are restricted to their own work |
| Submit/add/delete preparation resource | Preparation `update` ability; ownership enforced |
| Review | Preparation `update` ability; teachers and students cannot review |
| Create library item | OWNER, MANAGER, SUPERVISOR, TEACHER in school context |
| Update/delete library item | Existing staff administration roles; teachers are not enabled |
| Student-view | STUDENT and staff roles; student class/status restrictions and teacher ownership enforced |

Do not assume every manager has preparation create/update abilities; use the existing permission system. Curriculum administration uses explicit role checks. The dedicated student-view route works with the existing student role even without a Preparation `read` permission.

## 4. School setup: import the curriculum

This is an owner/manager screen, separate from the teacher's preparation form.

### Browse catalogue

```http
GET /catalog/subjects?page=1&limit=100
GET /catalog/subjects/:catalogSubjectId/units
```

Subjects are paginated (default 10 per page, maximum 100). Fetch all pages if building a complete dropdown. Each subject has `_id`, `name`, and `sourceId`. Units have `_id`, `name`, `order`, `catalogSubjectId`, and a nested `lessons` array. Catalogue data contains names, not objective suggestions.

### Import into school subject and grade

```http
POST /curriculum/import
```

```json
{
  "catalogSubjectId": "507f1f77bcf86cd799439012",
  "subjectId": "507f1f77bcf86cd799439013",
  "gradeLevelId": "507f1f77bcf86cd799439014"
}
```

Response `data`:

```json
{ "createdUnits": 8, "createdLessons": 45 }
```

Import copies the tree into this school. Reimporting preserves existing names/objectives and does not duplicate rows. It can restore missing lessons, including an imported lesson deliberately deleted earlier. Refresh the school curriculum after completion.

If the catalogue is empty, platform seeding is still required. School frontend code must not call `/catalog/seed` or store a platform-admin token.

### Manual curriculum management

| Method and route | JSON body / behavior |
| --- | --- |
| `GET /curriculum/units?subjectId=...&gradeLevelId=...` | Array of school units |
| `GET /curriculum/units/:unitId/lessons` | Array of school lessons, including `objectives` |
| `POST /curriculum/units` | `subjectId`, `gradeLevelId`, `name`, `order` |
| `PATCH /curriculum/units/:unitId` | Optional `name`, `order`; cannot remap subject/grade |
| `DELETE /curriculum/units/:unitId` | Unit must be empty; otherwise 409 |
| `POST /curriculum/units/:unitId/lessons` | `name`, `order`, optional `objectives` |
| `PATCH /curriculum/lessons/:lessonId` | Optional `name`, `order`, `objectives` |
| `DELETE /curriculum/lessons/:lessonId` | Referenced lessons cannot be deleted; returns 409 |

Names must be nonblank and at most 300 characters. `order` is a nonnegative integer. Objective entries are strings of at most 2,000 characters. Successful deletions return `data: { "deleted": true }`.

An empty curriculum should show an owner/manager import action, or tell the teacher that the school's curriculum needs setup. Do not replace the required curriculum lesson with free text at submission.

## 5. Teacher form: loading and creating

Load these independently once the lecture/offering is known:

```http
GET /preparation/reference-lists
GET /curriculum/units?subjectId=:schoolSubjectId&gradeLevelId=:gradeLevelId
GET /library?subjectOfferingId=:offeringId
```

Then load `GET /curriculum/units/:unitId/lessons` after unit selection. Read `teachingStrategies` and `teachingAids` from reference-list response `data`; do not hardcode their Arabic values. These are defaults, not enums. Store user selections as strings and use `strategiesOther` for free text.

`GET /library?subjectOfferingId=...` gives an exact-offering picker. The backend also accepts school-wide items with no offering, and items from another offering with the same school subject and grade. A broader reusable-content picker may use `GET /library` or `/library/by-subject/:subjectId` and filter relevant items. Submission revalidates the selection.

### Create a draft

```http
POST /preparation
```

```json
{
  "lecture": "507f1f77bcf86cd799439015",
  "weekOf": "2026-09-06"
}
```

Only `lecture` is required. Store the returned `_id` and use PATCH for subsequent saves. Avoid repeated POST calls from autosave or double-clicks; single creation is not an idempotent endpoint.

`weekOf` accepts a `YYYY-MM-DD` date within the desired week. The server normalizes it to Saturday and defaults it to the current week if omitted. Normalized reads also include `lessonDate`, derived from the lecture's weekday. Preserve date-only strings in the UI to avoid timezone shifts.

### Select a lesson and handle suggestions

Selecting a lesson should populate editable objective rows from the selected school lesson.

- On create, supplying `lessonId` without `objectives` copies the lesson's suggestions.
- On PATCH, changing to a different lesson without `objectives` copies the new lesson's suggestions.
- Sending `objectives: []` explicitly keeps an empty list.
- Sending `lessonId` sets `lessonTitle` from the selected lesson name.
- The server verifies that the lesson belongs to the lecture's school subject and grade.

When changing lessons after the teacher has edited objectives, let them decide whether to keep their current objectives or use the new suggestions. Send the chosen array explicitly. Reset dependent lesson selections when switching to a different subject/grade.

## 6. Save the two form steps

```http
PATCH /preparation/:preparationId
```

### Step 1: المعلومات الأساسية

```json
{
  "lessonId": "507f1f77bcf86cd799439016",
  "warmUp": "مراجعة سريعة لمفهوم الجمع",
  "vocabulary": "المجموع، الحد",
  "objectives": ["أن يجمع الطالب عددين"],
  "digitalContentIds": ["507f1f77bcf86cd799439017"]
}
```

### Step 2: إعداد الدرس

```json
{
  "teachingStrategies": ["العصف الذهني"],
  "strategiesOther": "",
  "teachingAids": ["السبورة التقليدية"],
  "thinkingSkills": "المقارنة والاستنتاج",
  "closure": "تلخيص خطوات الحل",
  "teacherInstructions": "حل التدريب قبل الحصة القادمة"
}
```

| Field | Type / limit | Required at submit | Student-visible |
| --- | --- | --- | --- |
| `lessonId` | School lesson ObjectId string | Yes | Yes, ID only |
| `warmUp` | String, 10,000 characters | No | Yes |
| `vocabulary` | String, 10,000 characters | No | Yes |
| `objectives` | String array; 2,000 characters per entry | At least one nonblank entry | Yes |
| `digitalContentIds` | Library ObjectId string array | At least one valid item | Yes, IDs only |
| `teachingStrategies` | String array; 2,000 characters per entry | No | No |
| `strategiesOther` | String, 10,000 characters | No | No |
| `teachingAids` | String array; 2,000 characters per entry | No | No |
| `thinkingSkills` | String, 10,000 characters | No | Yes |
| `closure` | String, 10,000 characters | No | Yes |
| `teacherInstructions` | String, 10,000 characters | No | Yes |

Send only editable fields, not the entire GET response. PATCH replaces supplied arrays; it does not append to them. Omit unchanged fields, use `[]` to clear arrays, and `""` to clear text. Treat text as plain text when rendering.

Changing content, week, lecture, or supporting files returns the preparation to `draft` and clears its review. Even sending an unchanged content field can trigger this reset. Avoid background PATCH calls on untouched approved/pending records.

## 7. Digital content: reusable library picker

The form may include an inline “add content” dialog, but it creates a Library item through `/library`. After creation, add the returned `_id` to the form's `digitalContentIds` and save the preparation.

### Create a link item

```http
POST /library
```

```json
{
  "title": "شرح الجمع",
  "kind": "link",
  "link": "https://example.com/lesson",
  "subjectOfferingId": "507f1f77bcf86cd799439018"
}
```

Title must be at least two characters. `kind` defaults to `link`; a link item needs an HTTP/HTTPS URL. Prefer the exact `subjectOfferingId` from the lecture. Omitting all subject-mapping fields creates a school-wide item.

### Upload a file item

```ts
const form = new FormData();
form.append('title', title);
form.append('kind', 'file');
form.append('subjectOfferingId', offeringId);
form.append('file', selectedFile);

const response = await fetch(`${apiBase}/library`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const body = await response.json();
if (!response.ok || !body.status) throw new Error(body.message);
const libraryItem = body.data;
// Add libraryItem._id to digitalContentIds, then save the preparation.
```

Do not set multipart `Content-Type` manually; the browser supplies its boundary. Send the binary field `file`, not a JSON FileRef. The server generates file metadata.

Limits: one file, 20 MB. Supported extensions: `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.png`, `.jpg`, `.jpeg`, `.mp4`, `.mp3`.

File item response `data` contains:

```json
{
  "_id": "507f1f77bcf86cd799439017",
  "title": "عرض الدرس",
  "kind": "file",
  "link": null,
  "file": {
    "filename": "generated-name.pptx",
    "originalName": "lesson.pptx",
    "path": "/uploads/library/generated-name.pptx",
    "size": 15360
  }
}
```

Resolve `file.path` against the backend origin for previews/downloads. Use `link` for link items. Older items without `kind` should be treated as links. Removing an item from a preparation means updating `digitalContentIds`; it does not mean deleting the reusable Library record.

## 8. تكليفات الحصة: resources

Create the draft first; resource routes need its ID.

### Inline homework/activity/enrichment/quiz

```http
POST /preparation/:preparationId/resources
```

```json
{
  "type": "homework",
  "title": "تدريبات الجمع",
  "description": "حل الأسئلة من 1 إلى 5",
  "startAt": "2026-09-06T07:00:00.000Z",
  "dueAt": "2026-09-07T18:00:00.000Z",
  "totalGrade": 10,
  "link": "https://example.com/exercise"
}
```

Types and labels: `homework` → واجب, `activity` → نشاط, `enrichment` → إثراء, `quiz` → اختبار.

Title is required when neither reference below is set; maximum 300 characters. Description is optional, maximum 10,000 characters. Dates are optional ISO strings; `dueAt` must not precede `startAt`. `totalGrade` is optional and nonnegative. Optional links must use HTTP/HTTPS. Omit unused fields rather than sending empty date or URL strings.

### Link an existing exam or project

```json
{ "type": "quiz", "examId": "507f1f77bcf86cd799439019" }
```

```json
{ "type": "activity", "projectId": "507f1f77bcf86cd799439020" }
```

Use one reference only. An exam must use `quiz`; a project must use `activity`. The referenced record must belong to the same school and exact subject offering, and include the preparation's class. Filter existing exam/project pickers accordingly. The resource response keeps references as IDs and does not populate exam answers.

### Read and remove resources

`POST .../resources` returns the created resource in `data`. Reload `GET /preparation/:id` to refresh the resource list and draft status. That detail response includes `resources` and `resourcesCount`.

```http
DELETE /preparation/:preparationId/resources/:resourceId
```

Deletion returns `data: { "deleted": true }`. Adding/deleting resources returns the parent to draft. Deleting the last resource is allowed while drafting; submission then fails until another is added.

There is no resource PATCH route or standalone GET-resources route. For a replace action, create the replacement successfully before deleting the old resource, then refresh the detail. The resource endpoint does not upload files. Its optional `files` array stores FileRef metadata (`filename`, `originalName`, `path`, `size`) for existing attachments; do not pass browser `File` objects in JSON.

## 9. Supporting preparation attachments

These remain separate from required digital content and resources.

| Action | Route | Multipart field |
| --- | --- | --- |
| Create with supporting files | `POST /preparation` | Repeated `files` |
| Replace supporting files while saving | `PATCH /preparation/:id` | Repeated `files` |
| Append supporting files | `POST /preparation/:id/files` | Repeated `files` |
| Remove one supporting file | `DELETE /preparation/:id/files/:filename` | None; URL-encode filename |

Existing preparation upload limits are 10 files per request, 20 MB each. Supported MIME types are PDF, JPEG/PNG images, and MP4. Use the Library uploader for Office documents.

When PATCH includes uploaded files, it replaces the preparation's existing supporting files. Use the append route if retaining old attachments is intended. Omitting files on PATCH preserves them.

Structured arrays in multipart must be JSON strings:

```ts
const form = new FormData();
form.append('objectives', JSON.stringify(objectives));
form.append('digitalContentIds', JSON.stringify(digitalContentIds));
form.append('teachingStrategies', JSON.stringify(teachingStrategies));
form.append('teachingAids', JSON.stringify(teachingAids));
for (const file of supportingFiles) form.append('files', file);
```

For ordinary form saves without supporting files, prefer JSON. An attachment's existence must not make the UI show the preparation as submitted.

## 10. Submit and review

### Submission sequence

1. Finish any in-flight saves/uploads/resource changes.
2. Save the latest form changes through PATCH.
3. Check that a lesson is selected, objectives contain nonblank text, digital content is selected, and a resource exists.
4. Disable repeated submission while the request runs.
5. Call `POST /preparation/:id/submit` without a body.
6. On success, show `pending` and refresh detail/weekly data.

Submission accepts only `draft` or `needs_revision`. The server checks all references again and trims/removes blank objective entries. A supporting file does not replace any required component.

Success is HTTP 201:

```json
{
  "status": true,
  "message": "تم إرسال التحضير للمراجعة",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "reviewStatus": "pending",
    "objectives": ["أن يجمع الطالب عددين"]
  }
}
```

When school lesson suggestions are empty, submission saves these objectives as future suggestions. It does not overwrite existing suggestions. Refresh cached curriculum lessons after submission if the suggestions are displayed elsewhere.

### Existing review route

```http
PATCH /preparation/:id/review
```

```json
{
  "reviewStatus": "needs_revision",
  "reviewNote": "يرجى توضيح الأهداف"
}
```

Review outcomes accepted by the existing route are `pending`, `approved`, and `needs_revision`. `reviewNote` is optional and at most 1,000 characters. Drafts cannot be reviewed. Show `reviewedByName`, `reviewedAt`, and `reviewNote` on staff/teacher screens as appropriate.

## 11. Read models, list filters, and legacy data

### Opening the editor

```http
GET /preparation/:id
```

For staff, `lessonId` and `digitalContentIds` are populated documents on this detail route. Mutation responses and list records can contain IDs instead. Normalize references before using a form or sending a write:

```ts
type Ref<T extends { _id: string }> = string | T | null;
const idOf = (value: Ref<{ _id: string }>): string | null =>
  typeof value === 'string' ? value : value?._id ?? null;

const formValues = {
  lessonId: idOf(preparation.lessonId),
  objectives: preparation.objectives ?? [],
  digitalContentIds: (preparation.digitalContentIds ?? [])
    .map(idOf)
    .filter((id): id is string => Boolean(id)),
  warmUp: preparation.warmUp ?? '',
};
```

Detail includes `resources` and `resourcesCount`; mutation responses do not consistently include those fields. Reload detail after mutations when updating the resource panel. Always build an explicit PATCH DTO rather than spreading the read model.

### Preparation list

```http
GET /preparation?weekOf=2026-09-06&reviewStatus=draft&page=1&limit=20
```

Supported filters: `name` (teacher name), `lessonTitle`, `lecture`, `subject` (offering ID), `submittedBy`, `classId`, `termId`, `reviewStatus`, `weekOf`, `weekFrom`, `weekTo`. Aliases: `teacherId` → `submittedBy`, `lectureId` → `lecture`. Unknown filters return 400; `lessonId` is not currently a supported list filter. Do not combine exact `weekOf` with a date range.

### Weekly screen

```http
GET /preparation/weekly?weekOf=2026-09-06&teacherId=:teacherId
```

An optional `termId` is also supported. Teachers always get their own week. With a teacher selected, response `data` contains `weekOf`, `teacher`, `stats`, and `days`; each day's slots contain a preparation or `null`.

- A draft preparation is present in its slot but does not count as submitted.
- Teacher-specific stats include `total`, `submitted`, `missing`, `draft`, `pending`, and `needsRevision`.
- `missing = total - submitted`, so missing includes draft slots. Do not add `draft` to `missing` again.
- Without a teacher selection, staff receive teacher summary rows with coverage percentages; that summary has a different shape and no per-teacher `draft` field.

### Existing and archived rows

Older rows may have `lessonId: null`, preserved `lessonTitle`, no structured content, and existing approval/review status. Display them using their saved title and attachments. Do not auto-PATCH on load to fill defaults: it can invalidate their reviews.

Archived `lecture` and `subject` fields may be snapshots instead of IDs. Do not assume every reference can be sent back directly. Editing legacy content returns it to draft; completing the structured requirements is necessary before submitting again.

### Bulk creation compatibility

`POST /preparation/bulk` still accepts `lectureIds` (1–40), optional `lessonTitle`, optional `weekOf`, and supporting uploads. It creates drafts and returns per-lecture created/skipped results. It does **not** accept structured fields such as `lessonId`, `objectives`, or `digitalContentIds`. To prepare several classes, save content and resources on each resulting preparation and submit each one separately.

## 12. Student lesson view

```http
GET /preparation/:id/student-view
```

Response `data` contains only:

```ts
interface StudentPreparation {
  _id: string;
  lessonId: string | null;
  lessonTitle: string;
  warmUp: string;
  vocabulary: string;
  objectives: string[];
  digitalContentIds: string[];
  thinkingSkills: string;
  closure: string;
  teacherInstructions: string;
}
```

Students can read only pending/approved preparations for their active enrolled classes. Legacy students with no enrollment records use their stored class. Drafts, needs-revision rows, and inaccessible records return 404.

The route does not return teaching strategies/aids, review notes, supporting preparation files, or resource cards. Digital content remains Library IDs and can be resolved with existing Library read endpoints. Do not build student resource rendering against the staff detail response.

There is no new student discovery/list endpoint in this change. Use preparation IDs supplied by an authorized frontend flow. Ordinary preparation list/detail reads still require Preparation `read` permission, which students do not have by default. If that permission is granted, the backend applies student filtering/projection there too. The weekly endpoint remains staff-only in behavior.

## 13. Error behavior

| HTTP | Example / cause | Frontend action |
| --- | --- | --- |
| 400 | `يتعين عليك إضافة إثراء أو واجب أو اختبار أو نشاط واحد على الأقل` | Focus resource section |
| 400 | `يجب إضافة هدف واحد على الأقل` | Focus objectives |
| 400 | `يجب إضافة محتوى رقمي واحد على الأقل` | Focus digital-content picker |
| 400 | `يجب اختيار درس من المنهج` | Focus lesson picker |
| 400 | `الدرس لا ينتمي إلى مادة وصف المحاضرة` | Reload curriculum for selected offering/grade |
| 400 | Invalid/deleted digital content or linked resource | Refresh picker data and repair selection |
| 400 | Already pending/approved on submit | Refresh status; do not retry submission blindly |
| 401 | Invalid/expired authentication | Use existing reauthentication flow |
| 403 | Missing ability, wrong role, or another teacher's work | Show access message; hide unavailable action |
| 404 | Missing/inaccessible preparation, unit, or lesson | Show unavailable state; avoid repeated retries |
| 409 | Preparation changed during submit/review | Preserve unsaved local inputs, reload server data, let user reconcile |
| 409 | Duplicate library link/title or referenced curriculum deletion | Show server message and refresh relevant data |

Client validation improves feedback, but server validation determines whether submission succeeds. Do not automatically replay create/resource requests after ambiguous network failures; first reload to check whether the record was created.

## 14. Suggested frontend acceptance checks

- Save a draft with only its lecture, navigate away, and reopen it.
- Complete step 1, save, then complete step 2 without losing earlier fields.
- Load objective suggestions, edit them, and explicitly clear them.
- Add a Library link and a PowerPoint upload inline; both are reusable afterwards.
- Remove digital content from the preparation without deleting its Library record.
- Add inline homework and linked exam/project resources; reject incompatible selections.
- Verify submission fails for each missing required component and succeeds with all four.
- Verify an approved preparation returns to draft after editing; drafts cannot be reviewed.
- Append versus replace supporting files and confirm the intended attachment behavior.
- Show draft slots separately from submitted coverage in the weekly screen.
- Open legacy records without silently modifying them.
- Verify student screens never receive internal teaching fields and cannot open another class's preparation.
- Switch schools and clear/query-key all cached curriculum, preparation, and objective data by school context.
- Handle stale IDs, permission errors, conflicts, and empty catalogue/curriculum states.

Backend design and operational seeding instructions: [Structured lesson preparation](./structured-lesson-preparation.md).
