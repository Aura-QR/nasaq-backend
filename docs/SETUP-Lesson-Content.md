# Lesson Content Generation

Filling a preparation's warm-up, closure, vocabulary, thinking skills and
teacher note from the school's own workflow.

**Backend:** shipped and tested.
**n8n:** workflow ready to import — `n8n/nasaq-lesson-content.json`.
**What is left:** an Anthropic API key on the n8n side, and the two variables
below.

---

## What it does

```
POST /preparation/:id/generate
        │
        ├─ the lesson, its unit, the subject, the grade,
        │  and the objectives the school wrote on that lesson
        ▼
   n8n webhook  ──▶  Claude  ──▶  the content, and a homework
        │
        ├─ fills ONLY the fields that are still empty
        ├─ attaches a library item, if one fits this subject and grade
        └─ files the homework, if the teacher has added no assignment
```

Those last two are not decoration. Nasaq refuses to submit a preparation
without a lesson, a digital content item, an assignment and an objective —
the *لا يمكن الإرسال* wall with three bullets. Writing the prose and leaving
those empty produces a draft that still cannot be sent, which is the wall this
exists to remove.

The library item is chosen from what actually fits: an item on this subject
and grade, or a school-wide one. When the library holds neither, nothing is
attached — a wrong video attached silently is worse than a bullet asking the
teacher to choose one.

A teacher who picks a lesson already gets its name and the school's objectives.
Everything else is a blank page — and a blank page is why teachers upload a PDF
instead.

### The rule

**It never overwrites what the teacher wrote.** A field already holding text is
left exactly as it is; only blanks are filled. That is enforced in
`LessonContentService`, not asked for in the prompt, and it is what makes the
endpoint safe to press twice — a second run reports `filled: []` and changes
nothing.

It refuses when no lesson has been chosen. A warm-up written from a subject
name alone is filler.

---

## 1. Environment — Nasaq backend

```bash
AI_WEBHOOK_URL=https://saree3-n8n.tfgpna.easypanel.host/webhook/nasaq-prep
AI_WEBHOOK_SECRET=<the same secret the WhatsApp workflow uses>
AI_ENABLED=true
```

The secret can be the same one; both workflows verify it identically.

Unset `AI_WEBHOOK_URL` and the endpoint answers *توليد محتوى التحضير غير مفعّل*
rather than failing obscurely.

## 2. Environment — n8n

```bash
NASAQ_WEBHOOK_SECRET=<same as AI_WEBHOOK_SECRET>
ANTHROPIC_API_KEY=sk-ant-…
```

Optional, to tune output against cost:

```bash
NASAQ_AI_MODEL=claude-opus-5     # the default
NASAQ_AI_EFFORT=low              # the default; raise if the writing is thin
```

On Easypanel: the n8n service → **Environment** → add → **Deploy**. n8n only
reads new variables on boot.

## 3. Import and activate

**Workflows → Import from File** → `n8n/nasaq-lesson-content.json` → **Activate**,
then copy the **Production URL** into `AI_WEBHOOK_URL`.

### The nodes

| Node | Job |
|---|---|
| **Webhook** | Raw Body on — the signature covers the exact bytes |
| **Verify signature** | Same HMAC scheme as the WhatsApp workflow |
| **Build prompt** | **This is the node you edit to change what gets written.** |
| **Claude — messages** | `POST /v1/messages`, output constrained by a JSON schema |
| **Shape for Nasaq** | Parses the JSON and hands back exactly Nasaq's field names |
| **200 OK / 401** | |

The response is constrained with `output_config.format` rather than asked for
politely, which removes the whole class of *the model wrote a sentence before
the JSON* failures. A refusal (HTTP 200, `stop_reason: "refusal"`) is checked
before the content is read.

**Do not switch on "Continue on Fail"** for the Claude node — a failure must
reach Nasaq as a failure, or a preparation is reported as generated when
nothing was written.

---

## 4. Try it

```http
POST /preparation/<id>/generate
Authorization: Bearer <teacher or owner token>
```

```jsonc
{ "message": "تم توليد 8 حقلًا",
  "data": { "id": "…", "filled": ["warmUp", "closure", …] } }
```

`filled: []` means every field was already written — not a failure.

---

## Cost

One lesson is a small request. At `claude-opus-5` rates ($5 / $25 per MTok)
expect on the order of **$0.01–0.03 per lesson** — a teacher's 22-period week
is a few tens of cents, and a 26-teacher school preparing every week is a few
dollars a week.

`NASAQ_AI_EFFORT` is the first lever if that matters; `NASAQ_AI_MODEL` is the
second. Measure before dropping either — thin content that a teacher rewrites
by hand costs more than it saves.

---

## What is not verified

The workflow's three Code nodes are tested against real signed payloads and
against the documented response shapes, including a refusal and a
non-JSON reply. **The live call to Claude is not** — there was no API key
available when this was built.

So the first thing to do after importing is one real generation, and to read
what comes back. The prompt is the part most likely to need a pass with a
teacher looking over your shoulder.
