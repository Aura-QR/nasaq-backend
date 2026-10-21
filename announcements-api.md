# شاشة الإعلانات الذكية — home-screen announcements

**Backend:** built and tested; live once merged to `main` (which auto-deploys).
**Needed from:** web (`nasaq-frontend`) and mobile (`nasaq_mobile`): a carousel on every home screen, and one management page for the school.
**Nothing else changes:** no existing endpoint or response shape is touched.

## Update, 15 Oct 2026: student photos on the honor roll

- **New, optional:** each honor-roll name can carry a `photoUrl`, uploaded through the same `POST /announcements/uploads` as a slide's image. It comes back on the feed and on the admin view. It is `null` when there is no photo, and on every slide saved before this update.
- **Nothing breaks:** existing slides and clients keep working. A client that ignores `photoUrl` shows the names as before.
- **Deploy the backend first.** The API refuses unknown fields, so a server without this change answers the web form's `photoUrl` with a 400.
- **Web display changed too (no API change):**
  - A program's image now shows **whole, beside the text**. It used to be a faded background under the text.
  - The web no longer shows an image on honor-roll or video slides.
  - Mobile should follow; see [Mobile](#mobile-nasaq_mobile).

## Why

The client asked for an announcements area at the top of the platform's home screen. It should change on its own and show three kinds of content in the same space:

- **الطلاب المتميزون:** a title and a list of names, each with an optional photo
- **إعلان برنامج:** text, an image and an optional button
- **فيديو توعوي قصير:** a link to the clip on YouTube (or any https host). **Videos are never uploaded to our server.**

The school picks when each slide starts and stops showing, puts the slides in order, and can switch any slide off with one tap.

## How it works

- **One record per slide.** `type` is `honor_roll`, `program` or `video`, and decides which fields mean anything (see the table below).
- **Per school.** A school only ever sees and manages its own slides.
- **Who sees a slide:** `audiences` is any of `STUDENT`, `TEACHER`, `ADMIN` (owner, supervisor, manager). The default is all three. Service staff (`STAFF`) get no feed.
- **When:** a slide shows while it is switched on (`isActive`), `startsAt` has passed, and `endsAt` has not. `endsAt: null` means it runs until switched off.
- **Order:** `order`, lowest first. A new slide goes to the end.
- **Status** (admin list only) is computed, never sent: `live`, `scheduled` (not started), `expired` (ended), `paused` (switched off). A switched-off slide is always `paused`, whatever its dates.

### Fields by type

| Field | honor_roll | program | video |
|---|---|---|---|
| `title` | required | required | required |
| `body` | optional | optional (the text) | optional |
| `imageUrl` | optional; not shown on web (the students' photos are the picture) | optional (the picture) | optional (poster); not shown on web |
| `students` | **required**, 1–60, each with an optional `photoUrl` | — | — |
| `cta` (button) | — | optional | — |
| `video` | — | — | **required** (a link) |

**Fields that do not belong to the type are cleared on save.** You can send the whole form state without stripping fields. When a slide changes type, its old type's fields go: a program changed to a video loses its button.

### Dates

`startsAt` and `endsAt` accept either:

- **a date, `YYYY-MM-DD`:** a whole school day (Riyadh). The start is that day's first moment and the end is its last, so `endsAt: "2026-10-31"` **still shows on the 31st**.
- **a full ISO timestamp:** `2026-10-18T08:30` (read as Riyadh time) or `2026-10-18T05:30:00Z`.

Responses always return ISO instants (UTC). Show them in Riyadh time; `endsAt` comes back as 23:59:59.999 of the day that was picked. If you leave `startsAt` out, the slide starts now.

## API

All under `/announcements`. The standard envelope `{ status, message, data }` is used, and error messages are in Arabic.

| Method | Path | Who | Permission (manager) |
|---|---|---|---|
| GET | `/announcements/feed` | owner, supervisor, manager, teacher, student | none |
| GET | `/announcements` | owner, supervisor, manager | `announcements.read` |
| GET | `/announcements/:id` | owner, supervisor, manager | `announcements.read` |
| POST | `/announcements/uploads` | owner, supervisor, manager | `announcements.add` **or** `.edit` |
| POST | `/announcements` | owner, supervisor, manager | `announcements.add` |
| PATCH | `/announcements/:id` | owner, supervisor, manager | `announcements.edit` |
| PATCH | `/announcements/:id/status` | owner, supervisor, manager | `announcements.edit` |
| PUT | `/announcements/order` | owner, supervisor, manager | `announcements.edit` |
| DELETE | `/announcements/:id` | owner, supervisor, manager | `announcements.delete` |

### The carousel: `GET /announcements/feed`

Returns the slides showing **now** for the caller's role, already in order. It returns an array, which is empty when nothing is live.

```json
[
  {
    "id": "6acf…",
    "type": "honor_roll",
    "title": "الطلاب المتميزون لشهر أكتوبر",
    "body": "نبارك لأبنائنا تميزهم",
    "imageUrl": null,
    "students": [
      { "name": "أحمد محمد العتيبي", "className": "3/2", "note": "الأول على الصف", "photoUrl": "/uploads/announcements/6a1b…/a71d….jpg" },
      { "name": "نورة", "className": "1/1", "note": null, "photoUrl": null }
    ],
    "video": null,
    "cta": null,
    "durationSeconds": null
  },
  {
    "id": "6acf…",
    "type": "program",
    "title": "برنامج القراءة الصيفي",
    "body": "سجّل قبل نهاية الشهر",
    "imageUrl": "/uploads/announcements/6a1b…/9d1e….png",
    "students": [],
    "video": null,
    "cta": { "label": "سجّل الآن", "url": "/student/library" },
    "durationSeconds": 8
  },
  {
    "id": "6acf…",
    "type": "video",
    "title": "فيديو توعوي: السلامة المرورية",
    "body": null,
    "imageUrl": null,
    "students": [],
    "video": { "url": "https://youtu.be/dQw4w9WgXcQ", "youtubeId": "dQw4w9WgXcQ" },
    "cta": null,
    "durationSeconds": 45
  }
]
```

- **`imageUrl` and `students[].photoUrl` are relative paths** (`/uploads/…`). Prefix them with the API origin the same way library and preparation files are; see `announcementMediaUrl` in `src/APIs/school/announcements.js`.
- **Show `imageUrl` whole, not as a background.** It is often a designed poster with its own text.
  - Fit it inside its frame (`contain`) so nothing is cropped, and let a tap open it full size.
  - Do not fade it, and do not put text over it.
- **`students[].photoUrl`:** show it in a circle, cropped to fill. When it is `null`, or the image fails to load, show the first letter of `name` instead.
- **`video` is always an external link:**
  - `youtubeId` set: embed `https://www.youtube.com/embed/<youtubeId>` on web, or hand the id to the YouTube player on mobile.
  - `youtubeId: null`: another https host (Vimeo, a CDN…). Open it, or play it if it is a direct `.mp4` link.
- **`cta.url`** is either an in-app path starting with `/` (navigate inside the app) or an `https://` link (open externally). The server refuses anything else, including `javascript:`.
- **`durationSeconds`:** how long the slide stays before the next. `null` means use your default (suggested: 6 s). For a video, wait for it to end rather than cutting it off.

### Admin list: `GET /announcements?status=&type=`

Both filters are optional: `status` is `live | scheduled | expired | paused` and `type` is `honor_roll | program | video`. It returns every matching slide, in order, with the management fields added:

```json
{
  "id": "6acf…",
  "type": "honor_roll",
  "title": "…",
  "body": "…",
  "imageUrl": "…",
  "students": [{ "studentId": "6a2c…", "name": "أحمد محمد العتيبي", "className": "3/2", "note": "الأول على الصف", "photoUrl": "/uploads/announcements/6a1b…/a71d….jpg" }],
  "video": null,
  "cta": null,
  "durationSeconds": null,
  "audiences": ["STUDENT", "TEACHER", "ADMIN"],
  "startsAt": "2026-10-13T21:00:00.000Z",
  "endsAt": "2026-10-31T20:59:59.999Z",
  "isActive": true,
  "order": 0,
  "status": "live",
  "createdBy": { "id": "6a…", "name": "المالكة" },
  "createdAt": "…",
  "updatedAt": "…"
}
```

`GET /announcements/:id` returns the same object, for the edit screen. `POST`, `PATCH` and `PATCH …/status` return it too.

### Why videos are links, not uploads

A clip served from our server goes to every home screen that opens it: a 50 MB video opened by 500 students is 25 GB out of our server. YouTube streams it instead, at the quality each phone's connection can take. The school uploads the video to YouTube as **غير مدرج (Unlisted)**, so it can be embedded but does not appear in search. **Private (خاص) videos cannot be embedded** and will not play in the carousel.

### 1 · Upload an image first: `POST /announcements/uploads`

`multipart/form-data` with one field, `file`. **Images only:** JPG, PNG or WEBP, up to 5 MB. The same endpoint takes a slide's image and each student's photo. It returns the url to send as the slide's `imageUrl` or as a student's `photoUrl`:

```json
{ "url": "/uploads/announcements/6a1b…/3f2c….jpg", "originalName": "banner.jpg", "size": 734003 }
```

- **A video file is refused** with «لا يُرفع الفيديو على المنصة — ارفعه على يوتيوب وضع رابطه في الإعلان».
- **SVG is refused**, because it can carry script.
- **A file over 5 MB** is refused (413) while it uploads, so it never reaches the server's disk. Check the size on the client too, before sending.
- **Suggested sizes** (nothing enforces them):
  - Banner: 16:9, for example 1600×900. The web card frames it at 16:9.
  - Student photo: square, for example 400×400. It is shown in a circle, cropped to fill.

Upload as soon as the image is picked, then send the returned `url` with the slide.

### 2 · Create: `POST /announcements`

```json
{
  "type": "honor_roll",
  "title": "الطلاب المتميزون لشهر أكتوبر",
  "body": "نبارك لأبنائنا تميزهم",
  "students": [
    { "studentId": "6a2c…", "note": "الأول على الصف", "photoUrl": "/uploads/announcements/6a1b…/a71d….jpg" },
    { "name": "نورة", "className": "1/1" }
  ],
  "audiences": ["STUDENT", "TEACHER", "ADMIN"],
  "startsAt": "2026-10-14",
  "endsAt": "2026-10-31",
  "isActive": true,
  "durationSeconds": 8
}
```

**Honor-roll names, two ways (mix freely):**

- **Pick a student** (`studentId`): the server fills in their full name and the class they are in **this** year. Use the student search you already have.
- **Type a name** (`name`, plus an optional `className`): for anyone not in the system, or a shorter name.
- **What is typed wins over the record.** Sending `studentId` together with `name: "أحمد محمد"` shows «أحمد محمد».
- **The roll is a snapshot.** Promoting the student next year does not change what this slide says.
- `note` is the reason, for example «الأول على الصف» or «حافظ لجزء عمّ». It is optional, up to 100 characters.
- **`photoUrl`** is optional. Upload the photo first, like the slide's image, and send the returned url.
  - Student records have no photo, so picking a student brings none; it is always uploaded here.
  - Only this school's own uploads are accepted.

**Program:**

```json
{ "type": "program", "title": "برنامج القراءة", "body": "سجّل الآن", "imageUrl": "/uploads/…png",
  "cta": { "label": "سجّل الآن", "url": "/student/library" } }
```

**Video** (a link; `imageUrl` is an optional poster):

```json
{ "type": "video", "title": "فيديو توعوي", "video": { "url": "https://youtu.be/dQw4w9WgXcQ" } }
```

Any YouTube link form works: `youtu.be/…`, `youtube.com/watch?v=…`, `/shorts/…` and `/embed/…`.

### 3 · Edit: `PATCH /announcements/:id`

Send only what changes. A key left out is kept, and `null` clears it (`imageUrl`, `endsAt`, `cta`, `durationSeconds`).

- **`students`, when sent, replaces the whole list.** To keep a student's photo, send its `photoUrl` again. Leave it out to remove the photo.
- **Photos already on the slide are kept as they are** when the list is sent again; only new ones are checked.
- **Replaced or cleared files are deleted.** This covers the slide's image and any student photo no longer on the list. A file another slide still uses is kept.

### 4 · On/off: `PATCH /announcements/:id/status`

```json
{ "isActive": false }
```

This sets the value; it does not flip it, so a double tap cannot undo itself. A paused slide keeps its dates and order and comes back as it was.

### 5 · Order: `PUT /announcements/order`

```json
{ "ids": ["6acf…c", "6acf…a", "6acf…b"] }
```

The listed slides take positions 0, 1, 2…. **Any slide not listed keeps its relative order after them**, so a drag-and-drop list of the live slides does not need to send the expired ones. The response is the whole admin list in its new order. For a simple "priority" number field instead of dragging, `order` can also be sent on create/edit.

### 6 · Delete: `DELETE /announcements/:id`

This deletes the slide, its uploaded image and its students' photos. A file another slide still uses is kept. It returns `{ "id": "…" }`.

### Validation (400 unless noted, message in Arabic)

| Rule | Message |
|---|---|
| Blank title | اكتب عنوان الإعلان |
| Honor roll with no names | أضف اسم طالب واحد على الأقل إلى لوحة التميز |
| A row with neither `studentId` nor `name` | اكتب اسم الطالب أو اختره من القائمة |
| Same student twice | تكرر الطالب نفسه في لوحة التميز |
| Student not in this school (404) | طالب في لوحة التميز غير موجود في هذه المدرسة |
| Video slide with no link | ضع رابط الفيديو (يوتيوب مثلًا) |
| Video link not https | رابط الفيديو يجب أن يبدأ بـ https:// |
| Button link not https or `/…` | رابط الزر يجب أن يبدأ بـ https:// أو بـ / لصفحة داخل المنصة |
| `imageUrl` or a student's `photoUrl` not from this school's `/announcements/uploads` | الصورة يجب أن تُرفع أولًا عبر رفع صور الإعلانات |
| Uploaded image or photo no longer on the server | الصورة غير موجودة، ارفعها مرة أخرى |
| End before start | تاريخ النهاية يجب أن يكون بعد تاريخ البداية |
| End already past (only when setting it) | تاريخ النهاية قد مضى |
| Uploading a video file | لا يُرفع الفيديو على المنصة — ارفعه على يوتيوب وضع رابطه في الإعلان |
| Uploading any other non-image | يُقبل صورة JPG أو PNG أو WEBP فقط |
| Image over 5 MB (413) | حجم الصورة يجب ألا يتجاوز 5 ميجابايت |
| Unknown field in the body | class-validator message (the API is whitelist-strict) |

An expired slide can still be edited (its title, for example) without first being given a new end date.

## Permissions

- There is a new key, **`announcements`**. The default for the owner and for managers is all four boxes. Owners and supervisors pass by role, as everywhere else.
- **The feed needs no box.** A manager with every announcements box unticked still sees the carousel on their home screen; they just cannot open the management page.
- **Job titles** pick the key up automatically: it is a new row on every title, unticked until the owner ticks it.
- **Tokens carry permissions.** A manager signed in before this deploy has no `announcements` key in their token, so they get 403 on the management routes until they sign in again. The carousel works for them right away. Hide the management page using the permissions from login, as for other pages.

## Web (`nasaq-frontend`)

1. **API module:** add `src/APIs/school/announcements.js` with the nine calls above. The upload goes as `FormData` and the rest as JSON.
2. **The carousel component**, used at the top of all three home pages:
   - `src/pages/Student/StudentDashboardPage.jsx`
   - `src/pages/TeacherDashboard/TeacherDashboard.jsx`
   - `src/pages/SchoolDashboardPage/SchoolDashboardPage.jsx`
   
   What it does:
   - Fetches `GET /announcements/feed` once on load, and **renders nothing** when the array is empty, so there is no blank box.
   - Moves on every `durationSeconds ?? 6` seconds; a video waits for its end. Arrows and dots for manual paging, and swipe on touch.
   - Pauses on hover, while a video plays, and while the full-size image or the full honor list is open.
   - Renders one card per `type`. The text sits in its own column, never over a picture. On phones the picture goes above the text.
     - `honor_roll`: the title beside a row of student portraits.
       - Each portrait is a round photo in a gold ring, or the name's first letter when there is no photo, with the name, note and class under it.
       - Up to 4 portraits show (3 on phones). With more, a «+N · عرض الكل» tile opens the whole list in a dialog.
     - `program`: the text and button beside the image in a 16:9 frame.
       - The image shows whole, contained over a blurred copy of itself, and is never faded.
       - Clicking it opens the image full size with the title, the full text and the button.
     - `video`: the same 16:9 frame, holding a YouTube iframe from `youtubeId` (`?mute=1&playsinline=1` so autoplay is allowed), or a link card for other hosts.
   - RTL: arrows and swipe direction follow the page direction.
   - Responsive on phone, tablet and desktop. Keep a fixed aspect ratio so the page does not jump between slides.
   - `framer-motion` is already a dependency, for the transitions.
3. **Management page** «الإعلانات», in the school sidebar (`src/components/school/SchoolSidebar.jsx`), shown when the user may read `announcements`:
   - **List:**
     - tabs for status: الكل / ظاهر الآن / مجدول / منتهي / موقوف;
     - drag to reorder (`PUT /announcements/order`);
     - an on/off switch per row (`PATCH …/status`);
     - edit and delete per row.
   - **Form:**
     - type chosen first, with three tabs that show only that type's fields;
     - honor roll: student search plus "add a name by hand" rows. Each row has a round photo picker that uploads at once, shows the photo, and can remove it;
     - program: an image field with a thumbnail, replace and remove (the only type whose form offers an image);
     - video: a «رابط الفيديو» field with a hint to upload on YouTube as غير مدرج; preview the embed once the link is recognised;
     - start and end date pickers, with "no end" as an option;
     - audience checkboxes, all ticked by default;
     - an optional duration.
   - **Preview:** render the slide in the same carousel card component, with a switch between the teacher look (dark) and the student and admin look (light).
4. **Permissions labels:** add `announcements: "الإعلانات"` to `ENTITY_LABELS` in `src/pages/SchoolPermissions/permissionLabels.js`, and to the copy in `src/components/school/SchoolRolePermissionsDialog.jsx`.

## Mobile (`nasaq_mobile`)

1. **Model:** parse the feed item above. Treat `video`, `cta`, `imageUrl` and each student's `photoUrl` as nullable, and `students` as a possibly empty list.
2. **Carousel** at the top of the student, teacher and owner home screens. It follows the same rules as web: hidden when empty, auto-advance by `durationSeconds ?? 6`, page indicator dots, swipe, and a card per type.
   - **Honor roll:** a round photo per student from `photoUrl`, with the API origin prefixed. Show the name's first letter when it is `null` or fails to load.
   - **Program image:** show it whole (`BoxFit.contain`), not as a faded background under the text, and open it full screen on tap.
   - **Video:** with `youtubeId`, use the YouTube player package with the id, starting muted. Without it, open the link.
   - **Button:**
     - `cta.url` starting with `/`: map it to the matching in-app route where one exists.
     - `https://`: open in the browser.
3. **Owner management** (if the owner app manages content): the same list, switch, reorder and form as web. Images go up with `MultipartFile` to `/announcements/uploads`, then send the returned `url`. Honor-roll photos go up the same way, one per name. Videos are a link field only.

## UI copy (formal Arabic)

| Where | Text |
|---|---|
| Page title | الإعلانات |
| Type tabs | الطلاب المتميزون / إعلان برنامج / فيديو توعوي |
| Status tabs | ظاهر الآن / مجدول / منتهي / موقوف |
| Switch | إظهار الإعلان |
| Dates | يبدأ في / ينتهي في / بدون تاريخ نهاية |
| Audience | يظهر لـ: الطلاب / المعلمين / الإدارة |
| Names | إضافة طالب من القائمة / إضافة اسم يدويًا / سبب التميز |
| Student photo | صورة الطالب / إزالة الصورة |
| Program image | صورة الإعلان / استبدال الصورة / إزالة |
| Carousel | تكبير / عرض الكل / عدد الطلاب: N |
| Button fields | نص الزر / رابط الزر |
| Video | رابط الفيديو (يوتيوب) — تلميح: ارفع الفيديو على يوتيوب كـ «غير مدرج» ثم الصق الرابط |
| Duration | مدة العرض بالثواني (اختياري) |
| Empty list | لا توجد إعلانات بعد |

## Test checklist

Run these on a test school, not a live one.

1. Create one slide of each type. All three show on the owner's home screen in order.
2. Make the program students-only. A teacher does not see it; a student does.
3. Set a slide's start to tomorrow. It shows as «مجدول» in the list and is missing from the feed.
4. Set a slide's end to today. It shows through 23:59 today and is gone after midnight.
5. Switch a slide off. It disappears from the feed. Switch it on and it comes back in the same place.
6. Drag the last slide to the top. The feed order follows.
7. Pick a student who was promoted this year for the honor roll. Their **current** class shows.
8. Upload a 6 MB PNG and an `.mp4`. Both are refused with their Arabic messages.
9. Add a video slide with an Unlisted YouTube link. It plays in the carousel. A Private video does not, which is expected.
10. Delete a slide with an uploaded image. The image's URL now returns 404.
11. Sign in as a manager with the announcements boxes unticked. The carousel shows; the management page is hidden and its calls return 403.
12. Make an honor roll with a photo for one student and none for another. The first shows the photo in a gold ring; the second shows the first letter of their name.
13. Add six students. On a computer the card shows three portraits and «+3 · عرض الكل», and the button opens all six. A phone shows two portraits and «+4».
14. Remove one student's photo and save. That photo's URL now returns 404; the other photos still load.
15. Send a `photoUrl` from another school's folder, or one that was never uploaded. It is refused.
16. Add a program with a tall poster. The whole poster shows in the card, and a tap opens it full size.
