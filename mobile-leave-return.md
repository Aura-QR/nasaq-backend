# Mobile: «تسجيل العودة من الاستئذان», and the leave reason is now required

**For:** Azza (`nasaq_mobile`).
**Backend:** `caecd32` + `e985242`, live and tested on the QA school. **Web:** done (`77ace0b`).

## 1. The leave reason is required (important: do this first)
`POST /duty/leave-requests` (teachers) and `POST /staff-attendance/leave-requests` (staff) now **refuse a request without `reason`** with 400 «سبب الاستئذان مطلوب، بحد أقصى 500 حرف». The web already requires it.
- In the app's leave forms, make the reason field required: label «سبب الاستئذان (مطلوب)», keep the send button disabled while it is empty, and always send `reason`.
- **Until this ships, a leave request sent from the app without a reason fails.**

## 2. Coming back from a leave
Until now a استئذان meant leaving early: the person checked out and the day was over. Now, someone with an approved leave can come back and record it. The school is told, and the rest of the day is recorded.

### API (the person's own token)
| Who | Endpoint |
|---|---|
| Teacher | `POST /teacher-attendance/me/leave-return` |
| Staff (STAFF, SUPERVISOR, MANAGER checking in as staff) | `POST /staff-attendance/me/leave-return` |

Body, same as check-out: `{ "lat": 24.71, "lng": 46.67, "mockLocationSuspected": false }`. It is verified exactly like a check-in: the GPS radius or the school network.

- 200 → `{ leaveRequestId, departedAt, returnedAt, distanceMeters, verification }`. Message «تم تسجيل عودتك من الاستئذان».
- 400 «لا يوجد استئذان معتمد لك اليوم» · 409 «تم تسجيل عودتك من الاستئذان بالفعل» · 403 off site (the same message as check-in).

**What the server does:** if the person checked out when leaving, that time is kept on the leave as `departedAt`, and the day's record is **reopened** (`checkOutAt` becomes null). So after coming back, the check-out button shows again, and they check out normally at the end of the day.

### Knowing whether to show the button
Read today's approved leave:
- Teacher: `GET /duty/leave-requests?date=YYYY-MM-DD&status=approved` (a teacher only gets her own).
- Staff: `GET /staff-attendance/leave-requests?date=YYYY-MM-DD&status=approved&staffId=<own id>`.

Each leave now also has `departedAt`, `returnedAt` (null until they come back), `returnDistanceMeters` and `returnVerification`.

### The check-in screen (teacher and staff)
Under the check-in/check-out button, when there is an approved leave today:
- **Not back yet:** a card «لديك استئذان معتمد اليوم» · «الانصراف الساعة {leaveAt} — {reason}. إذا عدت إلى المدرسة فسجّل عودتك من موقع المدرسة لتُبلَّغ الإدارة.», with the button **«تسجيل العودة من الاستئذان»**. It reads the location as check-in does, calls the endpoint, then reloads today's attendance (the check-out button comes back).
- **Back:** a green line «سُجّلت عودتك من الاستئذان الساعة {returnedAt} (خرجت الساعة {departedAt}).»

### The school's side (owner panel)
- New notices to administrators:
  - **`leave_returned`** (teacher): title «عادت {name} من الاستئذان», body «خرجت الساعة 10:00 وعادت الساعة 11:20».
  - **`staff_leave_returned`** (staff): «عاد {name} من الاستئذان».
  - `data`: `{ leaveRequestId, teacherId|staffId, …Name, date, departedAt, returnedAt }`.
  - Route them like `leave_requested` / `staff_leave_requested`: to the teacher leave screen and the staff leave screen.
- On both leave lists, when `returnedAt` is set, show «عادت الساعة …» (teacher) or «عاد الساعة …» (staff).

All text is formal Arabic (فصحى), as written above.

## Test (QA school; enable staff/teacher check-in and set a location there first, then restore it)
1. Send a leave request without a reason: the app stops it. Send it with a reason: it arrives, and the owner gets «طلب استئذان».
2. The owner approves it. The person checks in, then checks out (leaving).
3. On the check-in screen, the return card shows. Tap it away from the school: the off-site message shows. Tap it at the school: success, and the check-out button is back.
4. The owner gets «عاد/عادت … من الاستئذان»; the leave list shows the return time.
5. Tap it again: «تم تسجيل عودتك من الاستئذان بالفعل».
6. Check out at the end of the day: it works.
