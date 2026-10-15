# Web fix: video announcements cannot be saved

**For:** Arwaa (`nasaq-frontend`).
**Backend:** no change; the API works as documented in `announcements-api.md`.
**Size:** a few lines in `src/pages/Announcements/AnnouncementsManagement.jsx` and one in `AnnouncementCarousel.jsx`.

## The bug

Creating or editing a slide of type «فيديو توعوي» from `/school/announcements` always fails with 400. The error shows in the form:

| Action | What the page sends | Server reply |
|---|---|---|
| Create | `video: { source: "link", url: "https://youtu.be/…" }` | `video.property source should not exist` |
| Edit an existing video slide | `video: { url: "…", youtubeId: "…" }` (the object from the list, sent back as is) | `video.property youtubeId should not exist` |

**Why:** the API rejects any field it does not know (`whitelist` + `forbidNonWhitelisted` in `main.ts`). The only field inside `video` is `url`. `youtubeId` is computed by the server and only comes back in responses; it is never sent.

I verified this against the backend's real DTO with the same validation settings. `{ url }` alone is accepted; both shapes above are refused.

**Other slide types are not affected.** Programs and honor rolls save fine.

## The fix

### 1. Send only the url (`AnnouncementsManagement.jsx`, `toPayload`, line 19)

```js
// before
if (form.type === "video") payload.video = form.video;

// after
if (form.type === "video") payload.video = form.video?.url ? { url: form.video.url.trim() } : null;
```

This fixes both create and edit. On edit, `openEdit` puts the server's `{ url, youtubeId }` in the form; `toPayload` now sends only its `url`.

### 2. Remove the «رفع فيديو» option

The server never accepts a video file. `POST /announcements/uploads` refuses it with «لا يُرفع الفيديو على المنصة — ارفعه على يوتيوب وضع رابطه في الإعلان». Videos are links only, so that bandwidth stays on YouTube, not on our server.

In `AnnouncementsManagement.jsx`:

- **Line 61:** remove the `<Select>` with «رابط يوتيوب أو فيديو / رفع فيديو» and the upload button. Keep only the link field:
  ```jsx
  {form.type === "video" && (
    <TextField
      label="رابط الفيديو (يوتيوب)"
      helperText="ارفع الفيديو على يوتيوب كـ «غير مدرج» ثم الصق الرابط هنا"
      value={form.video?.url || ""}
      onChange={e => update("video", { url: e.target.value })}
    />
  )}
  ```
- **Line 12, `blank()`:** `video: { url: "" }` instead of `{ source: "link", url: "" }`.
- **Line 38, `openEdit`:** `video: item.video ? { url: item.video.url } : { url: "" }`.
- **Line 40, `upload()`:** the `isVideo` branch (MP4/WEBM, 50 MB) can go. Only images are uploaded.
- **Line 37, the `submit` message:** «أرفق الفيديو أو ضع رابطه» → «ضع رابط الفيديو».

### 3. The carousel (`AnnouncementCarousel.jsx`, line 75)

`video.source === "upload"` never comes from the server. The check can stay on the extension only:

```jsx
/\.(mp4|webm)(\?|$)/i.test(video.url || "") ? <Box component="video" … /> : <Button …>مشاهدة الفيديو</Button>
```

The YouTube branch (`video.youtubeId`) is correct as it is.

## How to test

On the yamamah test school, not مواهب:

1. New announcement → «فيديو توعوي» → paste `https://youtu.be/dQw4w9WgXcQ` → save. It saves, and the preview plays.
2. Edit that slide, change only the title, and save. It saves.
3. Edit it and change the link to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. It saves, and the carousel still plays it.
4. Paste `http://…` (not https). The server's Arabic message shows: «رابط الفيديو يجب أن يبدأ بـ https://».
5. The form has no video upload option any more.
