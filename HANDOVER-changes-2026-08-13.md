# Nasaq backend — handover of changes pushed while you were away

**Range:** `6155f41` (your last commit, *"apply the otp feature & made six 0 for testing"*) → `54d6f07`
**14 commits · 29 files · +661 / −151 · 3 new files**
**Branch:** `main`, already deployed to the test server.

All of it is on `main` in small, single-purpose commits, so anything here can be reverted on its
own without dragging the rest with it.

**Read §1 and §9 first.** §1 is what changed for callers, §9 is what needs running on the
database. The rest is detail you can take in any order.

---

## 0. How this came about

We were verifying the Teacher Attendance feature against its spec and running the Postman
collection against the server. Most of what follows was found that way — by sending a request as
the wrong user and reading the status code, not by reading the code. That distinction matters,
because **almost every bug here is invisible in the source.** The code looks correct in each case.

---

## 1. Breaking changes — the short list

| Change | Was | Now |
|---|---|---|
| A student calling `POST /attendance` | **201** — recorded | **403** |
| An admin calling `POST /exams` | **201** | **403** — teachers only |
| `GET /teachers/me` as a teacher | **403** | **200** |
| Teacher `password` in any teacher/admin read | present | **removed** |
| A teacher deleting an attendance record | 403 | **allowed**, for their own classes only |
| `GET /projects/submissions` | 400 (unreachable) | works |
| 409 on duplicate teacher check-in | no body | now carries `data` |

Nothing else changed shape. The frontend has been given an updated API reference.

---

## 2. 🔴 `AbilitiesGuard` was never enforced on `attendance`

**Commit `7c452b1`**

`POST /attendance` had no guard at all. Any authenticated user — **including a student** — could
mark any student in any class absent, and nothing recorded who did it.

The obvious fix was to add the decorator:

```ts
@Post()
@CheckAbilities({ action: 'create', subject: 'Attendance' })
```

The build passed. It looked fixed. **It was not** — a student still got 201.

`AbilitiesGuard` was not an `APP_GUARD`, so every controller had to attach it itself:

```ts
@UseGuards(JwtAuthGuard, AbilitiesGuard)   // exams, financial, projects, preparation…
```

Sixteen controllers do. `attendance` did not — so `@CheckAbilities` there was **inert metadata
that nothing read**.

**This is the part worth keeping in mind: the failure is completely silent.** No error, no
warning, the build succeeds, and the route stays open. The only way to notice is to send the
request as an unauthorised user and look at the status code.

It is now registered globally in `app.module.ts`. The guard's first statement short-circuits:

```ts
if (!requiredAbilities) return true;   // no @CheckAbilities on this handler → allow
```

so **a route with no `@CheckAbilities` behaves exactly as before.** Making it global changes
nothing about existing behaviour; it only means a route that *does* declare abilities can no
longer be left unenforced.

### The follow-up that broke the boot — `2a475bf`

For consistency I also added the local `@UseGuards(JwtAuthGuard, AbilitiesGuard)` to
`attendance.controller`. **That broke startup:**

```
UnknownDependenciesException: Nest can't resolve dependencies of the AbilitiesGuard
(Reflector, ?) … in the AttendanceModule context.
```

A guard named in a class-level `@UseGuards` is constructed in **that module's** injector.
`AttendanceModule` does not import `CaslModule`, so `CaslAbilityFactory` could not be resolved.
The other sixteen controllers survive the same pattern only because their modules do import it —
which is also why `attendance` was the one missing the guard in the first place.

Removed. The global `APP_GUARD` resolves from the root injector, where `CaslModule` is imported.

> A build cannot catch a DI graph error. This shipped because I verified with `nest build` and
> not by starting the app. Everything after this was verified by booting against a real `mongod`.

**Worth a periodic sweep regardless:** a route that should be restricted but carries no
`@CheckAbilities` at all is still open, and the global guard cannot help with that.

```bash
grep -rn "@Post()\|@Patch(\|@Delete(" src --include="*.controller.ts" -A2 | grep -v "CheckAbilities"
```

---

## 3. 🔴 The school-network check could be forged from anywhere

**Commits `261046c`, `014cb49`**

`teacher-attendance.service.ts` read the client IP like this:

```ts
const xForwardedFor = req.headers?.['x-forwarded-for'];
const rawIp = (typeof xForwardedFor === 'string' ? xForwardedFor.split(',')[0].trim() : null)
  || req.ip || req.socket?.remoteAddress || '';
```

**`X-Forwarded-For` is a request header — the client sets it.** Nothing distinguished a value
appended by our reverse proxy from one typed by the caller, and the *first* element (the most
attacker-controlled position) was the one taken.

A teacher at home, 40 km away:

```bash
curl -X POST .../teacher-attendance/check-in \
  -H "Authorization: Bearer <their own token>" \
  -H "X-Forwarded-For: <school public IP>" \
  -d '{"lat":0,"lng":0}'
```

`networkPassed` → `true`. GPS fails, but the rule is *either* check, so the record is created —
and stored as `verification: { gps: false, network: true }`, which the admin report presents as
**"was on the school network."**

The school's public IP is not a secret; `/teacher-attendance/detect-ip` hands it to anyone
standing in the building. So the one signal the spec called *"cannot be faked without being on
the network"* was the **easier** of the two to fake, because it needs no app at all.

### Fix

`main.ts` now sets a proxy hop **count**, and `extractClientIp` reads `req.ip` only:

```ts
app.set('trust proxy', trustProxyHops);   // a NUMBER
```

With a number, Express walks `X-Forwarded-For` from the **right**, skipping exactly that many
trusted hops, and ignores anything the client prepended.

> ⚠️ **`app.set('trust proxy', true)` is not a fix.** It trusts the whole chain and restores the
> hole. The value must be the real hop count. Default is `1` (Coolify/Traefik alone); add 1 for
> Cloudflare or any extra proxy. Override with `TRUST_PROXY_HOPS`, documented in `.env.example`.

`TRUST_PROXY_HOPS` is parsed and range-checked rather than passed straight through — a typo would
otherwise become `NaN` or `0` and silently degrade the check with no symptom. Bad values fall back
to 1 with a startup warning.

**To verify after any deployment change:** call `GET /teacher-attendance/detect-ip` normally, then
again sending a junk `X-Forwarded-For`. **The answer must not change.**

The existing tests encoded the vulnerable behaviour — they passed the school IP via the header.
Their fixtures now set `req.ip` and deliberately carry a hostile `x-forwarded-for`, so trusting
the header again fails the suite.

---

## 4. 🟠 `findOneAndDelete` was not tenant-scoped

**Commit `8482732`**

`tenantScopedPlugin` hooked nine query methods:

```
find · findOne · findOneAndUpdate · updateOne · updateMany
deleteOne · deleteMany · countDocuments · count
```

**`findOneAndDelete` was not among them** — and that is what `Model.findByIdAndDelete` compiles
to. No `schoolId` was injected, so **an admin of school A holding a document id from school B
deleted school B's record.**

```bash
grep -rn "findByIdAndDelete\|findOneAndDelete" src --include="*.service.ts" | wc -l
# 30
```

Thirty call sites, all with the same hole. Added `findOneAndDelete`, `findOneAndReplace`,
`replaceOne` and `distinct`, with a comment listing which Model helper compiles to which hook so
the next addition is not missed.

Checked before applying: the weekly `TasksService` cron uses `skipTenantScope: true` on every
operation and only calls `find` and `updateOne`, so it is unaffected. That one could have failed
silently — a scoped delete in a context with no tenant store matches nothing and reports success.

**Worth confirming with two schools rather than by reading:** take a record id from school B and
try to delete it as school A's owner. Expected: **404**.

---

## 5. 🔴 Password hashes were returned by every teacher and admin read

**Commit `4ac80bb`**

`Student.password` already had `select: false`. `Teacher.password` and `Admin.password` did not,
so the bcrypt hash came back from `GET /teachers`, `/teachers/:id`, `/teachers/list` and the admin
equivalents.

Two things in the codebase show this was noticed locally and never fixed at the source:

- `teachers.service.ts` stripped it by hand, in `getMyProfile` only
- `enrollments.service.ts` worked around it with `select: '-password -otp -otpExpiry'`

### Adding `select: false` alone would have locked everyone out

Three lookups read the hash and **none of them asked for it**. All three now use
`.select('+password')`:

| File | Lookup |
|---|---|
| `auth.service.ts` | admin login |
| `auth.service.ts` | teacher login |
| `admin.service.ts` | admin login |

The student lookup already had it, which is why students were unaffected.

### And `select: false` does not apply to a document you just built

`POST /teachers` and `POST /students` still returned the hash, because the document was created in
memory rather than queried. Both now strip `password` and `otp` explicitly before returning.

**Verified against a running server:** all three login paths still work, a wrong password is still
rejected with 401, no endpoint returns a hash, and a newly created teacher or student can log in.

---

## 6. 🔴 Two copies of the default permission table

**Commit `e18c724`**

The default role permissions existed **twice**:

- `PermissionsService.getDefaultPermissions()`
- inlined in `SchoolsService.register()`

Registration seeds the per-school `Permission` documents from **its own copy**, so the one in
`PermissionsService` only ever ran as a fallback for schools that predate it.

I found this the hard way: I granted `TEACHER` the `attendance.delete` permission, the build
passed, and against a freshly registered school the teacher's JWT still came back with only
`school.attendance.create` and `.update`. Nothing errored. **The edit applied to a table nobody
reads.**

Both call sites now import from **`src/permissions/default-permissions.ts`** (new file). Please do
not inline another copy — the file says so at the top.

---

## 7. Exams

### 7.1 Creation restricted to teachers — `ff6c905`

Product decision from the school: an exam is a teaching act, so it is authored by the teacher who
gives it. **Admins keep read, edit and delete on every exam — only creation is restricted.**

Enforced in `ExamsService.create()`, **not** through permissions. The stored sets already say
`exams.add: false` for OWNER and SUPERVISOR, but both log in with `['*']`, which CASL expands to
`can('manage','all')` — that bypasses every `@CheckAbilities`, so the stored value never took
effect. The reasoning is in a comment at the check.

This also closes the `createdBy` defect. The field is declared `ref: 'Teacher'` but stored whoever
was logged in, so an admin-authored exam held an **Admin id in a Teacher reference**. Mongoose
does not verify the target exists, so it saved silently, and then:

1. every `populate('createdBy')` returned `null` — the exam had no author on screen
2. `GET /exams/teacher/me` filters `createdBy = caller`, so the exam never appeared for the
   teacher who actually gives it
3. the edit guard made it editable by that one admin and by nobody else

`createdBy` is now always a real `Teacher` **by construction**, not by validation.

### 7.2 `GET /exams/teacher/me` added — `54d6f07`

The route did not exist. `projects`, `subjects` and `lectures` all expose `.../teacher/me`, so the
frontend reasonably assumed exams did too and got a bare Express 404, `Cannot GET
/exams/teacher/me`.

The behaviour was already implemented — `filtering()` forces `createdBy = the caller` when the
caller is a TEACHER, so `GET /exams` already returned only their own. It simply had no predictable
address, and the inconsistency is what cost the time.

Declared **above** `@Get(':id')` so the wildcard does not swallow it, and `createdBy` is stripped
from the query first so one teacher cannot read another's exams by passing it.

---

## 8. Smaller fixes

### `GET /teachers/me` returned 403 to every teacher — `b36d19d`

It required `@CheckAbilities({ action: 'read', subject: 'Teacher' })`. `read Teacher` is
permission to read the teacher **directory**, and the TEACHER role does not have it. So no teacher
could load their own profile.

Pre-existing — identical at `b3cc8de`, before the guard became global; the method already carried
its own `@UseGuards`, so the check was enforced all along.

Reading yourself is identity, not directory access. The service scopes to `user.userId` from the
verified JWT, so there is nothing to authorise beyond being logged in. `GET /students/me` is built
the same way and was always correct. Swept the rest — this was the only `/me` route with an
ability check.

### Teachers can undo a mistaken absence — `dd39ce0`

Turning on the guard finally enforced the stored permission set, which gave TEACHER attendance
`add` and `edit` but **not** `delete`.

Attendance is absence-based: a record exists ⇒ that student was absent. **Deleting the record is
the undo.** A teacher could create a mistake and had no way to fix it.

Granting `delete` on its own would have been worse than the gap — `PATCH` and `DELETE` had **no
ownership check at all**, so any teacher could clear any absence anywhere in the school. The
permission and the check ship together:

- `assertMayTouchRecord()` applies the same rule as recording — the teacher must have a lecture
  for that class on **that record's own date**. Admins unrestricted.
- the TEACHER default becomes `attendance.delete: true`

### `GET /projects/submissions` was unreachable — `cce4438`

Declared **after** `@Get(':id')`. Nest matches in declaration order, so `"submissions"` was parsed
as an ObjectId and the route returned 400 `صيغة المعرف غير صحيحة`. Moved above the wildcard.

Also removed two debug lines — `exams.controller.ts` printed the full authenticated user (id,
role, permissions) to the server log on **every exam creation**.

### 409 on duplicate check-in now carries the record — `0ef0ea7`

The service attached the existing record so a double tap could show "you checked in at 07:52", but
`GlobalExceptionFilter` rebuilt every error response and forwarded only `message`.

The filter now forwards `data` **when, and only when, the thrower explicitly supplies it**.
Nothing else in the codebase throws with `data`, so no existing error response changes shape.

Manual entries also gained a date-format check, an `HH:mm`/ISO check on `checkInAt`, and rejection
of future dates — without which an admin could pre-fill next month and the "who was absent" report
would count people who have not come to work yet.

### Lecture filters and a teacher-assignments list — `4ac80bb`

`GET /lectures` declared only `termId`, `classId` and `teacherId`. **`dayOfWeek` and `slot` were
dropped silently** and the frontend saw an unfiltered list. Both are now read; `dayOfWeek` is
lower-cased so `'Sunday'` matches the stored `'sunday'`, and an empty `slot=` is ignored rather
than becoming slot 0.

`GET /teacher-assignments` did not exist — only `by-offering/:id` and `by-teacher/:id`, both
requiring an id up front, so an admin list screen had to fetch every teacher and fan out. Added,
filterable by `teacherId`, `subjectOfferingId` and `termId`.

---

## 9. ⚠️ Operational steps — these are not done yet

### 9.1 Grant existing schools the teacher-delete permission

Defaults only apply on first seed, so schools already registered still have
`attendance.delete: false`.

```bash
mongosh "$MONGODB_URI" scripts/grant-teacher-attendance-delete.js
```

Idempotent — re-running changes nothing.

### 9.2 Teachers must log in again

**Easy to forget, and 9.1 does nothing visible without it.** Permissions are baked into the JWT at
login and are not re-read per request.

### 9.3 Confirm the proxy hop count on the server

See §3. One `detect-ip` call with and without a forged header.

### 9.4 Optional — find exams with an unresolvable author

Exams created by an admin before `ff6c905` still hold an Admin id in `createdBy`.

```bash
mongosh "$MONGODB_URI" scripts/find-orphaned-exam-authors.js
```

**Read-only.** It reports and suggests rather than guessing, because choosing the right teacher for
an orphaned exam is a human decision.

---

## 10. Still open — decisions, not code

### 10.1 Deleting a subject orphans its lectures

`DELETE /subjects/:id` cascades to offerings, criteria, exams and projects — **but not lectures**.
They survive pointing at an offering that no longer exists, so `populate` returns null and the
timetable shows *"مادة غير محددة"*.

`DELETE /subject-offerings/:id` has **no dependency check at all**, and six collections reference
an offering: lectures, exams, projects, grades-criteria, library, teacher-assignments.

What leaving it costs, concretely:

- **The timetable slot stays blocked.** The ghost lecture still occupies its slot in the unique
  index, so adding a real lecture there returns 409 *"Class already has a lecture scheduled on
  sunday at slot 1"* while the user is looking at a row with no subject. That gets diagnosed as
  the wrong bug.
- **Copying the timetable propagates them** — `copySchedule` copies every lecture in the term, so
  each new term inherits and the count grows.
- **Teachers see them** in `GET /lectures/teacher/me`.
- **Attendance permission still passes.** `assertMayRecordForClass` only looks for a lecture, so a
  ghost lecture still authorises recording for that class.

**Decision needed:** cascade lectures away with the subject, or refuse the delete while lectures
depend on it? My suggestion is refuse for offerings (a small operation should not silently rewrite
a timetable) and cascade for subjects (already a large, deliberate destructive act). A cleanup
script only treats the symptom — it will regress the next time anyone deletes a subject.

### 10.2 No rate limiting anywhere

`ThrottlerModule` is not installed. `/auth/login` and `/students/request-password-setup` matter
more than check-in.

### 10.3 `teacher-attendance` pagination is inconsistent

It returns `{ data, meta }` nested inside `data`; every other paginated endpoint returns
`pagination: { totalDocs, totalPages }` at the top level. The frontend needs a second parser.
Nearly free to align now, expensive once screens depend on it.

### 10.4 `POST /subjects` has a different envelope

It returns the document under `data.subject`; every other create returns it under `data`. Not
harmful, but it silently broke two of my scripts before I noticed.

### 10.5 CORS is effectively open

`main.ts` builds an allow-list and then calls `callback(null, true)` in **both** branches, so
every origin is allowed. The list is decorative. Untouched — flagging it, not changing it.

### 10.6 The OTP is fixed at `000000`

`auth.service.ts` and `students.service.ts`, from your commit `6155f41`. Fine on the test server;
it must not reach production. Suggest binding it to an env var so local testing keeps the fixed
code and the server generates a random one:

```ts
const otp = process.env.OTP_FIXED_CODE
  ?? Math.floor(100000 + Math.random() * 900000).toString();
```

---

## 11. How this was verified

- `nest build` → exit 0 on every commit
- Unit suites: **38/38** (`teacher-attendance`, `financial`, `financial-calculation`,
  `promotion-preview`, and your two OTP specs — my changes do not break them)
- `teacher-attendance.spec.ts` grew from 12 to 14 tests: a spoofed-header regression guard and a
  future-date check
- **End-to-end against a running app on a real `mongod`** (`mongodb-memory-server`): 18/18 for the
  security fixes, 19/19 for the password and filter work, 9/9 for the new exams route

The five suites under `tenancy`, `dashboards` and `managers` fail locally — **they fail identically
on the base commit**, 14 tests, all `mongoose.connect` timeouts. Environmental, not a regression;
confirmed by stashing and re-running on `6155f41`.

---

## 12. Postman

Two collections in the project root, both updated for the above:

| File | |
|---|---|
| `Nasaq_Master_Verification.postman_collection.json` | 189 requests — financial, surcharge, grading, timetable, library |
| `Nasaq_Teachers_Students_Attendance.postman_collection.json` | 90 requests — everything on the teacher/student side plus both attendance modules |

Import and run top to bottom with **no environment selected**; every value is a collection
variable and an environment variable of the same name would win. Each run registers its own school
with a timestamped slug, so runs never collide.

**Two requests are worth keeping green above all others:**

- **09.4** — a check-in with a forged `X-Forwarded-For` must be refused. If it passes, any teacher
  can check in from home and the record will claim they were on the school network.
- **10.1** — a student must not be able to mark anyone absent. If it passes, `AbilitiesGuard` has
  stopped being a global `APP_GUARD`.

Both failures are silent in normal use. Nothing errors; the wrong thing simply succeeds.
