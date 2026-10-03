# Service Staff (Guards, Cleaners, Drivers) — API Notes

Handoff for the Web (React) and Mobile (Flutter) developers.

A school asked to record its guard's attendance. Guards keep the school's
hours and days exactly, so they are tracked like the administrators. What
needed care was making sure attendance is the **only** thing such an account
can reach.

**Backend is done and deployed** — verified end to end on the QA school.

**Web is done** (frontend `3626407`): the owner's «موظفو الخدمات» screen at
`/school/staff-members`, and a STAFF login lands on `/staff-attendance` with a
two-item sidebar. **Mobile is what remains** — section 3 below. The web pages
are a working reference: `src/pages/StaffMembers/StaffMembers.jsx`.

## What exists now

A new role, **`STAFF`** (موظف خدمات). It is an admin-type account with:

| Field | Example | Notes |
|---|---|---|
| `fullName` | `محمد السيد` | Shown everywhere instead of the username |
| `username` | `guard01` | What they sign in with — 4–20 chars, English letters/digits |
| `jobLabel` | `حارس` | Free text. Grants nothing |
| `email` | optional | A guard usually has none — see below |

## The four things most likely to trip you up

1. **A STAFF account reaches almost nothing.** Any route not written for it
   returns `403` — including reads like `GET /students`. Don't show it menus.
2. **They sign in with a username, not an email.** `POST /auth/login` already
   accepts a username in `identifier`.
3. **No email usually means no "forgot password".** The owner sets a new
   password from the staff screen instead.
4. **They are not managers.** They never appear in `/managers`, and must not
   appear in any manager list you build.

---

## 1. Managing staff — owner or supervisor

All four routes: roles **OWNER, SUPERVISOR**.

### List

```
GET /staff-members
```

```json
{
  "status": true,
  "data": [
    {
      "id": "6abfc1ac174889de97ea6f0f",
      "fullName": "محمد السيد",
      "username": "guard01",
      "email": "guard01@6abd430d44646b7d3edba1d1.staff.local",
      "jobLabel": "حارس",
      "hasEmail": false,
      "createdAt": "2026-10-02T09:12:00.000Z"
    }
  ]
}
```

`hasEmail: false` means the address is a generated placeholder. **Don't
display it** — show "لا يوجد بريد" or nothing.

### Add

```
POST /staff-members
```

```json
{
  "fullName": "محمد السيد",
  "username": "guard01",
  "password": "Guard@2026",
  "jobLabel": "حارس",
  "email": "optional@example.com"
}
```

| Field | Required | Rule |
|---|---|---|
| `fullName` | yes | max 100 |
| `username` | yes | 4–20, `A-Z a-z 0-9 . _ -` |
| `password` | yes | 6–100 |
| `jobLabel` | no | max 60 |
| `email` | no | valid email |

`409` `اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل` — taken anywhere on
the platform, not only this school.

**Show the owner the username and password after creating**, the way the
teacher flow does — that is how the guard gets them.

### Edit / reset password

```
PATCH /staff-members/:id
```

```json
{ "fullName": "...", "jobLabel": "...", "email": "...", "password": "NewPass1" }
```

All optional. Sending `password` is how the owner gets a guard with no
email back in.

### Remove

```
DELETE /staff-members/:id
```

Attendance already recorded keeps the name it was written with, so past
reports still read correctly.

Only ever touches STAFF accounts — a manager's id returns `404`.

---

## 2. What a STAFF account can do

Exactly these, and nothing else:

| Route | Purpose |
|---|---|
| `POST /staff-attendance/check-in` | Record arrival |
| `POST /staff-attendance/check-out` | Record leaving |
| `GET /staff-attendance/me` | Own attendance |
| `GET /staff-attendance/me/late-reason/pending` · `POST .../me/late-reason` | Explain a lateness |
| `POST /staff-attendance/leave-requests` · `GET /staff-attendance/leave-requests` | Own استئذان — the list returns only their own |
| `GET /schools/me/settings` | The check-in screen's on/off switch and location |
| `/notifications/*` | Their own notices |
| `POST /auth/forgot-password` · `reset-password` | With `role: "STAFF"` — only works if they have a real email |

**Same endpoints and payloads the managers' check-in already uses.** No new
check-in code is needed — only routing.

---

## 3. What the client must do

### After login, route by role

```
role === "STAFF"  →  check-in screen, and nothing else
```

| | Screen |
|---|---|
| **Web** | `/staff-attendance` (`StaffAttendance.jsx`) — plus `/staff-leave-requests` if you want leave |
| **Mobile** | `Routes.staffCheckIn` |

**No sidebar, no dashboard, no admin menus.** Everything else returns
`403`, so any screen that loads data on open will show an error. A small
header with the guard's name and a sign-out button is enough.

`permissions` in the login response is `[]` for STAFF. If your permission
helpers treat an empty array as "show everything" or crash on it, fix that
first.

### The owner's staff screen

A new list «موظفو الخدمات» beside the managers screen — **not inside the
managers list**. Name, job label, username, and actions: edit, set new
password, delete.

### Reports

Nothing to build. Guards already appear in the staff attendance report
(`GET /staff-attendance/staff`, `/summary`, `/absent`) with
`role: "STAFF"` and their `jobLabel`. If you show a role column, label it
«موظف خدمات».

---

## Business Logic Notes

### Why not a manager account with no permissions

That works today and was rejected on purpose. Four services notify "every
owner, manager and supervisor" — families' absence excuses **with medical
notes**, teacher latenesses, classroom observations. A job title hides
screens, not notifications; a guard would have received all of it on his
phone. STAFF is excluded from those notices by name, and a test fails if it
is ever added.

### Hours and days

Exactly the school's — same start time for lateness, same working days,
same holidays. There are no shifts and no per-guard schedule; the school
confirmed guards keep school hours.

### No smartphone?

Create the account anyway. The administration records their attendance by
hand from the staff attendance screen (the manual entry that already
exists). If they get a phone later, they sign in with the same account.

---

## Also fixed on the way — no client change needed

`GET`, `PATCH` and `DELETE /admin/:id` had no guard beyond being signed in.
Any teacher, student — or now guard — could PATCH the school owner's
password and sign in as the owner. No client used these routes; they are
platform-admin only now. If anything of yours called them, it gets `403`.

---

## How to test

QA school — owner `owner.202609301712@qa.nasaq.test` / `QaTest@2026`.
A guard already exists there: `guard51851` / `Guard@2026`.

1. Sign in as the guard → you land on check-in, nothing else visible.
2. Check in, then check out.
3. As the owner → staff attendance report → «محمد السيد · حارس» is listed.
4. As the owner → add a guard with no email → edit → set a new password →
   sign in with it.
5. As the guard, open any admin URL directly → `403`, handled gracefully.
