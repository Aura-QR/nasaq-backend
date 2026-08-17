# Nasaq Backend — Full Context

A complete working context for the Nasaq backend: what it is, how it is put together, the domain rules that are not obvious from the code, and what is currently broken or missing.

Written to be read cold. Everything here was verified against the source, and the security findings were verified against a booted app with real tokens — not inferred from reading.

**Companion files:** `Nasaq_Teachers_Students_Attendance.postman_collection.json` (107 requests) and `Nasaq_Master_Verification.postman_collection.json` (189 requests). Both are in the repo root. They are the executable version of this document — where the two disagree, trust the collections, because they run.

---

## 1 · What Nasaq is

A multi-tenant school-management SaaS. One deployment serves many schools; every school's data is isolated by a `schoolId` that the server derives from the JWT and never accepts from the client.

**Stack:** NestJS 10 · MongoDB via Mongoose · JWT (passport-jwt) · CASL for permissions · Swagger at `/api/docs`.

**Languages:** all user-facing messages are Arabic. Code, comments and commits are English.

**Repo:** `Aura-QR/nasaq-backend`, branch `main`. Every push to `main` auto-deploys to Coolify.

### Running it

```bash
npm install
# .env — see .env.example
MONGODB_URI=mongodb://localhost:27017/nasaq
PORT=3000
JWT_SECRET=...
JWT_EXPIRE_IN=1d
TRUST_PROXY_HOPS=1     # security control, see §4
CORS_ORIGIN=           # comma-separated extras

npm run start:dev
npm test               # 38 pass, 14 fail — see §12
npm run build
```

There is no local mongod in the dev setup. To verify anything end to end:

```bash
docker run -d --name mongo -p 27077:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27077/scratch PORT=3999 JWT_SECRET=x \
  npx ts-node -r tsconfig-paths/register src/main.ts
npx newman run Nasaq_Teachers_Students_Attendance.postman_collection.json \
  --env-var baseUrl=http://127.0.0.1:3999
```

> **`npm run build` proves almost nothing.** It cannot catch a dependency-injection error, and it cannot catch a guard that silently passes. A bad `@UseGuards` once compiled cleanly and took the deployed server down on boot. Boot the app before pushing anything that touches guards or modules.

---

## 2 · The request pipeline

Every request passes through, in this order:

**1 · Three global guards** — registered in `app.module.ts:114-116` as `APP_GUARD`:

| Guard | Job |
|---|---|
| `JwtAuthGuard` | Validates the bearer token. Skipped on `@Public()` handlers. |
| `TenantGuard` | Requires `user.schoolId`, loads the school, rejects if suspended. Enforces `@PlatformOnly()`. |
| `AbilitiesGuard` | Evaluates `@CheckAbilities`. **Returns `true` when a handler has no `@CheckAbilities`** — this single line is the root of §11. |

Because these are global, a controller must **not** re-declare them with `@UseGuards`. A class-level `@UseGuards(AbilitiesGuard)` constructs the guard in that module's injector, which usually does not import `CaslModule`, and the whole app fails to boot with `UnknownDependenciesException`.

`RolesGuard` is the exception — it depends only on `Reflector`, so attaching it locally is safe, and it is not global. `@Roles(...)` therefore does nothing unless `RolesGuard` is in that route's `@UseGuards`.

**2 · Global `ValidationPipe`** with `whitelist`, `forbidNonWhitelisted`, `transform`. An unknown body property is a `400`, which is why the collections test `checkInAt` being rejected on self check-in. Note it validates **bodies**, not query strings typed as `any` — see §10.

**3 · `ResponseInterceptor`** wraps every successful return:

```json
{ "status": true, "message": "Success", "data": { } }
```

If the service returns an object carrying `totalDocs` or `totalPages`, a `pagination` block is added. **If the returned object already has a boolean `status` field, it is passed through untouched** — that is the escape hatch for hand-built responses.

**4 · `GlobalExceptionFilter`** on failure:

```json
{ "status": false, "message": "…", "statusCode": 403 }
```

It also forwards a `data` key when the thrown exception's response carries one — used by the duplicate check-in `409`, which returns the existing record inside the error.

### Envelope inconsistencies to know about

- Most creates return the document at `data`.
- `POST /teachers` returns it at **`data.teacher`**.
- `POST /subjects` returns it at **`data.subject`**.
- `GET /teacher-attendance/me` returns **`data.data` + `data.meta`**, not the usual `pagination` block.

These are not cosmetic. Both Postman collections carry a `pickId()` helper in every id capture specifically because reading `data._id` on those two endpoints yields `undefined`, sets the variable to nothing in silence, and fails a request three folders later pointing at the wrong place.

---

## 3 · Multi-tenancy

`src/tenancy/plugins/tenant-scoped.plugin.ts` is applied to every school-scoped schema. It:

- adds a required, indexed `schoolId` field
- injects `schoolId` from `AsyncLocalStorage` on `pre('validate')` for new documents, and **rejects any attempt to save under a different school or to mutate `schoolId` once set**
- adds a `$match` to every aggregation
- adds a `where` to thirteen query methods:

```
find  findOne  findOneAndUpdate  findOneAndDelete  findOneAndReplace
replaceOne  updateOne  updateMany  deleteOne  deleteMany
countDocuments  count  distinct
```

The list matters because the Model helpers compile down to these: `findById → findOne`, `findByIdAndUpdate → findOneAndUpdate`, `findByIdAndDelete → findOneAndDelete`. Any method missing from the list is a cross-tenant hole reachable by anyone holding an id from another school. `findOneAndDelete`, `findOneAndReplace`, `replaceOne` and `distinct` were all missing until recently.

**If you add a query method anywhere, check it is on that list.**

Escape hatch: `.setOptions({ skipTenantScope: true })`, used by the login lookup and by `TenantGuard` loading the school itself.

---

## 4 · Auth, roles, permissions

### Login

`POST /auth/login` with `{ identifier, password, schoolSlug }`. `identifier` is an email or username; the service tries platform super-admin, then school admin, then teacher, then student. Returns:

```json
{ "accessToken": "…", "user": { "id", "name", "email", "role", "schoolId" }, "permissions": [ ] }
```

The JWT payload becomes `req.user` as `{ userId, email, role, schoolId, permissions }`.

**Permissions are baked into the token.** Changing a role's permissions in the database has no effect until the user logs out and back in.

### Roles

`OWNER · MANAGER · SUPERVISOR · TEACHER · STUDENT · SUPER_ADMIN`

`SUPER_ADMIN` is platform-level: it has `schoolId: null` and `TenantGuard` refuses to let it perform school-scoped actions.

### CASL

`src/casl/casl-ability.factory.ts` maps flat permission strings to CASL rules:

```
school.<entity>.<action>   →   can(action, Subject)
```

with `add → create` and `edit → update` at generation time (`permissions.service.ts:106-107`).

> **The `['*']` trap.** `OWNER` and `SUPERVISOR` log in with `permissions: ['*']`, which expands to `can('manage', 'all')`. That satisfies **every** `@CheckAbilities`, so a stored `exams.add: false` on those roles can never take effect. Any rule that must bind an admin has to be enforced in the service, not through permissions. `ExamsService.create()` does exactly this.

### The default permission table

`src/permissions/default-permissions.ts` is the **single source of truth**. It exists because the table used to exist twice — once in `PermissionsService` and once inlined in `SchoolsService.register()` — and registration seeded from its own copy, so editing the other one changed nothing for any real school, silently. Do not inline another copy.

Current shape (abridged):

| Entity | OWNER | TEACHER | STUDENT |
|---|---|---|---|
| students | all | read | — |
| classes / lectures / library | all | read | library: read |
| attendance | all | **no read**, add, edit, delete | read |
| gradesCriteria | all | read | — |
| exams | read, delete | all* | — |
| projects | read, delete | all | — |
| preparation | read, delete | all | — |
| financial | all | — | — |

\* teacher `exams.add: true` is real, but `ExamsService` additionally requires `role === 'TEACHER'`, which is what actually keeps admins out.

Teacher `attendance.delete` is deliberate: attendance is absence-based, so deleting the record is how a teacher undoes a mistaken absence. It ships together with `assertMayTouchRecord()`, which scopes a teacher's edit and delete to classes they teach on that record's own date. **Never grant that permission without that check** — it would otherwise let any teacher clear any absence in the school.

### `TRUST_PROXY_HOPS`

`main.ts` sets `app.set('trust proxy', <number>)`. It must be a **hop count**, never `true`. With a number, Express walks `X-Forwarded-For` from the right and skips exactly that many trusted hops, so anything a client prepended is ignored. With `true` the whole chain is trusted and any caller can claim any IP — which would defeat the school-network check in teacher check-in.

Verify after any infrastructure change: call `GET /teacher-attendance/detect-ip` normally, then again with a junk `X-Forwarded-For`. **The answer must not change.** Coolify/Traefik alone = 1; add 1 for Cloudflare.

---

## 5 · The domain model

The academic structure is a chain. Almost every bug in this codebase traces back to someone skipping a link in it.

```
Stage  (المرحلة: ابتدائي / متوسط / ثانوي)
  └── GradeLevel  (الصف الأول …)
        │
AcademicYear (2026/2027)
  └── Term  (الفصل الأول / الثاني / الثالث)
        │
Subject  (الرياضيات — school-wide catalogue entry)
  └── SubjectOffering  =  Subject × GradeLevel × Term      ← the real unit of work
        ├── GradesCriteria   (1:1, the weight distribution)
        ├── TeacherAssignment (who may teach it)
        ├── Exam
        └── Project

Class  (1/1)  =  GradeLevel × AcademicYear
  ├── Enrollment  (Student × Class × AcademicYear, unique)
  └── Lecture  =  Class × SubjectOffering × Term × Teacher × dayOfWeek × slot
```

### SubjectOffering is the key concept

A `Subject` is just a name. **A `SubjectOffering` is "Maths, for Grade 1, in Term 1"** — and it is what everything else hangs off. Grading criteria, exams, projects and teacher assignments all reference the offering, never the subject. Unique on `(schoolId, subjectId, gradeLevelId, termId)`.

### Lecture is the timetable, and it is also the authorization source

A lecture is one slot in the weekly timetable. Two unique indexes:

- `(schoolId, classId, dayOfWeek, slot, termId)` — one lecture per class per slot
- `(schoolId, teacherId, dayOfWeek, slot, termId)` — partial, skipping `teacherId: null`, so a class can have an unstaffed slot but a teacher cannot be in two places at once

**`teacherId` is optional** (`default: null`), representing a "needs a teacher" slot. This is why an empty-string `teacherId` in a request silently stores `null` and returns `201` — a real trap that cost a whole debugging session.

Lectures are also how the system answers *"is this the teacher's class?"* — see `GET /classes/teacher/me` and `AttendanceService.assertMayRecordForClass()`. Note this is **not** the same as `Class.teacherInChargeId`, which is the form-teacher relationship: a maths teacher may teach six classes and be in charge of one, or none.

### Enrollment

`(schoolId, studentId, academicYearId)` unique. Status is one of `active | withdrawn | transferred | graduated`. Creating a student with a `classId` enrolls them, which is why student creation fails with *"لا توجد معايير رسوم"* until a `FeeConfig` and a default `InstallmentPlan` exist — enrollment builds the financial record.

---

## 6 · Grading — the whole logic

This is the most intricate part of the system and the part most often misunderstood.

### The distribution is school policy

`GradesCriteria` is 1:1 with a `SubjectOffering` and says how 100 marks split:

```json
{
  "final": 40,
  "quizzes": 15,     "quizzesCount": 3,
  "assignments": 20, "assignmentsCount": 4,
  "activities": 10,
  "projects": 15,    "projectsCount": 1,
  "passingGrade": 60
}
```

The five weights **must total exactly 100** or the API refuses (`grades-criteria.service.ts:52-57`). `passingGrade` is optional.

**Only school admins may write it.** Teachers work inside it. The reason is fairness at promotion time: two students in `1/1` and `1/2` are compared against each other, so they must be measured with the same ruler. If each teacher chose their own weighting, they would not be.

### A teacher does not choose an exam's mark

`ExamsService.create()` derives it (`exams.service.ts:176-188`):

| examType | mark |
|---|---|
| `quiz` | `quizzes / quizzesCount` → 15/3 = **5** |
| `assignment` | `assignments / assignmentsCount` → 20/4 = **5** |
| `activity` | `activities` → **10** |
| `final` | `final` → **40** |

If that type's weight is 0, creation is refused: *"نوع الامتحان غير مكون في معايير التقييم"*. Only one `final` per class per offering.

If the offering has **no criteria at all**, creation is now refused with *"لا يوجد توزيع درجات لهذه المادة"*. It previously invented a `40/20/10/15/15` criteria and persisted it — silently handing school policy to whichever teacher created the first exam. That is fixed; do not reintroduce it.

### Exams are teachers-only

`ExamsService.create()` throws unless `user.role === 'TEACHER'`. This is enforced in the service, not through permissions, for the `['*']` reason in §4 — and it is also what keeps `createdBy` honest. That field is declared `ref: 'Teacher'`, so an admin-authored exam stored an id resolving to nothing: every populate returned `null` and the exam never appeared in `GET /exams/teacher/me` for the teacher who actually gives it.

### How a grade is computed

`calculateStudentTermGrade(studentId, offeringId)` (`grades-criteria.service.ts:339`):

1. find the criteria for the offering — no criteria means `hasGrade: false`, grade 0
2. gather every `Exam` for the offering, sorted by `createdAt`, bucketed by `examType`
3. read the student's `ExamResult.achievedGrade` for each, defaulting to 0
4. gather `Project` records and the student's `Submission.achievedGrade`
5. sum: `final[0] + activity[0] + first N assignments + first N quizzes + first N projects`

> **Only the first `N` count**, where `N` is `assignmentsCount` / `quizzesCount` / `projectsCount` ordered by creation date. A fourth quiz under `quizzesCount: 3` exists, can be sat and graded, and contributes **nothing** to the total. Nothing warns anyone. This is the sharpest edge in the grading code.

`calculateStudentYearlySubjectResults()` then averages across the terms in which the subject was **actually graded** (`gradedTermCount`, not the number of terms it was offered), and compares against the passing grade.

### Passing grade resolution

1. the subject's own `passingGrade`, taken from the **latest term** in which the subject was offered and has one
2. otherwise the school's `settings.defaultPassingGrade` (default 50)

The response carries `passingGradeSource` naming which it used. The school setting is a **fallback**, not an override — the UI copy *"تُستخدم فقط عندما لا تكون للمادة درجة نجاح خاصة"* is accurate.

`Subject.isRequiredForPromotion` (default true) feeds promotion decisions.

---

## 7 · Attendance — two systems, opposite polarity

Getting these confused causes real data errors.

### Student attendance is **absence-based**

A record existing means the student was **absent**. There is no `status` field. Marking someone present again means **deleting** the record.

Rules:

- a teacher may record only for a class they have a lecture for **on that weekday**, scoped to the term the date falls in — `assertMayRecordForClass()`
- edit and delete apply the same check against the record's own date — `assertMayTouchRecord()`
- admins are unrestricted
- `recordedBy` is stamped, so a disputed record has an author

`GET /attendance/lecture/:lectureId/sheet?date=` returns the lecture, its class, the full roster and who is already marked absent — everything the screen needs in one call, replacing three.

### Teacher attendance is **presence-based**

A record existing means the teacher **checked in**. Unique on `(schoolId, teacherId, date)`.

`POST /teacher-attendance/check-in` takes `{ lat, lng, mockLocationSuspected? }` — the client cannot supply `checkInAt`, and sending it is a `400`. Two independent signals:

| Signal | Test |
|---|---|
| `gps` | Haversine distance from `settings.location` ≤ `checkInRadiusMeters` (default 150) |
| `network` | `req.ip` is in `settings.schoolNetworkIps` |

**Either one passing is enough.** Both failing is a `403` carrying the real distance. Both results are stored, so an off-site-but-on-network check-in is visibly `gps:false, network:true`.

A second check-in the same day returns `409` **carrying the existing record** in `data`, so the client can render it rather than treating it as an error.

Admins can create manual entries (`method: 'manual'`, no verification claimed, future dates rejected), correct records, delete them, and list who is absent today. `teacherCheckInEnabled` gates the whole feature and cannot be turned on without a location.

---

## 8 · Financial

Rooted in `StudentFinancialRecord`, created at enrollment. One record per student per year, holding:

- **tuition** — from `FeeConfig` (per academic year × grade level), plus an optional expatriate surcharge percentage applied when the student's `nationalityCode` is not in the school's `localNationalityCodes`
- **installments** — from an `InstallmentPlan`; one plan is the school default. Each installment carries `dueDates`, `status`, `paidAmount` and a `PaymentEvent[]` audit trail supporting payments and refunds
- **bus** — opt-in enrollment, own fee and installments
- **trips** — from `FinancialTrip` templates, per-student enrollment
- **additional fees** — one-off, paid per student
- **discounts** — snapshotted onto the record at application time, so later edits to the discount do not rewrite history

Changing the school's `localNationalityCodes` recomputes the surcharge school-wide — folder 09 of the master collection tests exactly that.

---

## 9 · Module map

| Area | Modules |
|---|---|
| Structure | `stages` `grade-levels` `academic-years` `terms` `classes` |
| Curriculum | `subjects` `subject-offerings` `lectures` `teacher-assignments` |
| People | `students` `teachers` `admin` `managers` `enrollments` |
| Teaching | `attendance` `teacher-attendance` `preparation` `library` `projects` `exams` `grades-criteria` |
| Money | `financial` `expenses` |
| Platform | `platform` (schools, super-admin auth) `dashboards` `permissions` `casl` `tenancy` |
| Cross-cutting | `interceptors` `filters` `pagination` `common` `config` `email` `tasks` |

Self-service routes follow one of two shapes: `/<entity>/me` (`teachers/me`, `students/me`) or `/<entity>/teacher|student/me` (`lectures/teacher/me`, `exams/teacher/me`, `classes/teacher/me`, `attendance/student/me`). Both exist; there is no single convention.

---

## 10 · Filtering and pagination — read this before touching filters

Nine services implement `filtering(filters, pagination, user?)`: `students` `teachers` `subjects` `library` `projects` `preparation` `attendance` `exams` `grades-criteria`.

### The shared pattern

```ts
async filtering(filters: any, pagination: PaginationDto = {}) {
  const query: any = {};
  const textSearchFields  = ['name', 'address', …];   // → { $regex, $options: 'i' }
  const exactMatchFields  = ['gender', 'email', …];   // → exact
  // objectIdFields / dateFields in some modules only

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (key === 'page' || key === 'limit') continue;
    …
    else { query[key] = stringValue; }                // ← catch-all
  }

  const total = await model.countDocuments(query);
  const meta  = getPagination(pagination.page, pagination.limit, total);
  const isPaginationRequested =
    pagination.page !== undefined || pagination.limit !== undefined;

  let q = model.find(query).sort({ createdAt: -1 }).populate(…);
  if (isPaginationRequested) q = q.skip(meta.skip).limit(meta.limit);

  const rows = await q.exec();
  return isPaginationRequested
    ? { data: rows, totalDocs: meta.total, totalPages: meta.totalPages }
    : rows;                                            // ← bare array
}
```

Controllers feed it with `@Query() queryParams: any`, splitting off `page` and `limit`.

### Field lists as they actually stand

| Module | text (regex) | exact |
|---|---|---|
| `students` | name, firstName, familyName, fatherName, nationality, address, previousSchool, notes, schoolEmail | gender, phoneNumber, email, classId |
| `teachers` | name, qualification, experience, specialization, address | email, phoneNumber |
| `subjects` | subjectName, subjectCode | — |
| `projects` | academicYear, title | — |
| `preparation` | name | — |
| `attendance` | name | + objectId: studentId, classId, _id · date: date |
| `exams` | — | examType, gradesCriteriaId, classIds, subjectOfferingId |

`students` additionally resolves `academicYearId` by looking up active enrollments and rewriting the filter to `_id: { $in: [...] }`. `attendance` uses a separate `buildFilterQuery()`.

`lectures` does **not** use this pattern — `findAll(termId, classId, teacherId, dayOfWeek, slot)` takes explicit typed parameters, lower-cases `dayOfWeek`, and guards `slot` against `''` becoming `0`.

### What is wrong with it, concretely

**1 · Two different shapes from one endpoint.** With no `page`/`limit` you get a bare array; with either, you get `{data, totalDocs, totalPages}` which the interceptor turns into a `pagination` block. Clients must handle both. `teacher-attendance` is different again — `{data, meta}`.

**2 · No whitelist.** The final `else` puts *any* unrecognised query key straight into the Mongo filter. `GET /students?password=x` becomes `{ password: 'x' }`. Nothing validates it because the controller types the query as `any`, so the global `ValidationPipe` never sees a DTO. Harmless today but it is an open door, and it means typos silently return zero rows instead of erroring.

**3 · No date ranges anywhere.** `attendance` casts `date` to a single exact `Date`. There is no `from`/`to` on any endpoint. This is probably the single most requested missing filter.

**4 · Regex is unanchored and unescaped.** A user-supplied `.*` or a long pathological pattern goes straight to Mongo, and none of these fields have text indexes, so every search is a collection scan.

**5 · Sort is hardcoded.** `createdAt: -1` almost everywhere, `date: -1` for attendance, `name: 1` for classes. No `sortBy`/`order` parameter exists.

**6 · The seven field lists drifted.** `teachers` cannot be filtered by `isActive`; `students` can. `subjects` has no exact-match list at all. Nothing keeps them consistent.

**7 · `countDocuments` + `find` are two round trips** on every call, and the count ignores `populate`-based filters entirely — so filtering by a populated field is impossible.

If the task is to rework filters, the highest-value changes in order: **a shared filter builder with a per-module whitelist**, **one response shape**, **date ranges**, then **sorting**.

---

## 11 · What is missing — verified, not guessed

### The big one: 69 write routes have no authorization at all

`AbilitiesGuard` returns `true` when a handler carries no `@CheckAbilities`. Most controllers never added one. The result, **confirmed against a booted app using a real student's token**:

```
POST   /stages         -> 201   a student created a school stage
POST   /subjects       -> 201   a student created a subject
POST   /classes        -> 201   a student created a class
POST   /teachers       -> 201   a student created a TEACHER ACCOUNT, password included
PATCH  /classes/:id    -> 200   a student edited a class
DELETE /classes/:id    -> 200   a student deleted a class
```

`POST /teachers` is privilege escalation: the caller sets the password, so any student can mint themselves a teacher login.

Modules affected: `stages` `grade-levels` `academic-years` `terms` `classes` `subjects` `subject-offerings` `lectures` `teacher-assignments` `students` `teachers` `library` `enrollments`, plus parts of `exams` and `projects`. Some of the 69 are legitimately open (`auth/login`, `schools/register`, `students/set-password`, the student-facing `exams/:id/start` and `/grade`) — but most are not.

The fix per route is one decorator, because the permission table in §4 already says the right thing. The pattern to copy is `grades-criteria.controller.ts`, which was fixed this way:

```ts
@Post()
@CheckAbilities({ action: 'create', subject: 'GradesCriteria' })
```

Do this module by module, and add a refusal test per module — a fix with no test is how this class of bug survives.

### Other known gaps

| | |
|---|---|
| **No rate limiting** anywhere, including login and the OTP flow |
| **OTP is hardcoded `000000`** (`auth.service.ts:251`) — deliberate for testing, must not ship to real customers |
| **CORS is effectively open** — the origin callback ends in `return callback(null, true)`, allowing everything regardless of the checks above it |
| **Orphaned lectures** — `DELETE /subjects/:id` cascades to offerings but not to lectures; `DELETE /subject-offerings/:id` has no dependency guard at all. Leftover lectures reference a dead offering and populate to `null`. *Unresolved product decision: cascade, or refuse the delete while lectures depend on it.* |
| **`GET /schools/me/settings` is open to every role**, so a student can read `schoolNetworkIps` |
| **No soft delete, no audit log** beyond `recordedBy` on the two attendance models |
| **Frontend gaps** — `attendance/lecture/:id/sheet`, `enrollments/promotion-preview`, `enrollments/bulk-promote`, `library/by-subject`, `lectures/copy-from`, `exams/teacher/me`, `teacher-assignments` create/delete, and two student `gradesCriteria` routes have no API function on the frontend |

---

## 12 · Traps that have already cost time

**Route order.** Nest matches in declaration order. A literal path declared **after** `@Get(':id')` is swallowed by it, and the request arrives as `findOne('teacher')` — failing the ObjectId cast with *"صيغة معرف غير صحيحة"*, a message that blames the caller for a route that does not exist. This has been hit three times: `/projects/submissions`, `/exams/teacher/me`, `/classes/my-classes`. **Every literal segment goes above the wildcard.**

**Guards declared but not enforced.** The pattern behind almost every security bug here: `@CheckAbilities` without a guard, `@Roles` without `RolesGuard`, `exams.add: false` overridden by `['*']`, the permission table that existed twice. **When you add a rule, prove it refuses.**

**`select: false` does not apply to a document you just built.** `Teacher.password` and `Admin.password` are `select: false`, which affects *queries*. A freshly constructed document still carries the hash, so `teachers.service.create` and `students.service.create` strip `password` and `otp` explicitly before returning. Conversely, the three login lookups need `.select('+password')`.

**Test baseline.** `npm test` gives **38 pass / 14 fail**. The 14 are five suites (`tenancy` ×3, `dashboards`, `managers`) timing out on `mongoose.connect` — they fail identically on older commits. Confirm any new failure also fails on the base commit before chasing it.

---

## 13 · The Postman collections

Both are in the repo root and both must run with **No Environment** selected, from the first request, in order — every id is captured from an earlier response.

**`Nasaq_Teachers_Students_Attendance…json`** — 107 requests, 12 folders. `00` sets up a brand-new school every run, so it is re-runnable. `05` student attendance, `07` exams, `09` teacher check-in including a spoofed `X-Forwarded-For` test, `10` student refusals, `11` grading-criteria refusals.

**`Nasaq_Master_Verification…json`** — 189 requests, 23 folders. Broader: the full financial model, discounts, buses, trips, expenses, dashboards, tenancy isolation.

Both carry a collection-level pre-request script that inspects the URL **and the body** for unset `{{variables}}` and throws before sending. That is deliberate: without it a request goes out with an empty id and the server answers `400 invalid id`, which reads as an API bug rather than a skipped step. If you see *"Missing collection variable(s): X"*, run the collection from the top.

---

## 14 · Recent history

Eighteen commits since the current push cycle began, in reverse order:

```
bead28b  test(postman): cover the grading-criteria refusals
d75c6b4  fix(grading): the weight distribution is school policy, not a teacher's
f6cd981  feat: added doc and postman collections
dd58144  feat(classes): add GET /classes/teacher/me
54d6f07  feat(exams): add GET /exams/teacher/me
4ac80bb  fix(security): stop returning password hashes; add lecture filters
b36d19d  fix(teachers): GET /teachers/me returned 403 to every teacher
e18c724  fix(permissions): one source of truth for default role permissions
2a475bf  fix(attendance): remove the local @UseGuards that broke boot
ff6c905  feat(exams): restrict exam creation to teachers
dd39ce0  fix(attendance): let teachers undo a mistaken absence
014cb49  fix(config): validate TRUST_PROXY_HOPS
cce4438  fix(projects): move GET /projects/submissions above @Get(':id')
8482732  fix(tenancy): scope findOneAndDelete and four other query methods
0ef0ea7  fix(teacher-attendance): return the existing record on a duplicate check-in
261046c  fix(security): stop trusting client-supplied X-Forwarded-For
7c452b1  fix(security): register AbilitiesGuard globally
```

Two breaking changes the frontend needs to absorb: `POST /exams` now returns `400` when the subject has no grading criteria, and the school-settings and grading-criteria screens must be hidden from teachers and students, which now receive `403`.

---

## 15 · House rules

- **Verify against the source, not against a summary or an API response.** Several confident claims in this project turned out to be wrong when checked against the code, including some of mine.
- Boot the app before pushing anything touching guards, modules or DI.
- User-facing strings in Arabic, everything else in English.
- `main` auto-deploys. There is no staging.
- When you fix an authorization rule, add the refusal test in the same change.
