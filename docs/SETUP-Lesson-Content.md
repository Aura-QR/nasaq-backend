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
   n8n webhook  ──▶  Claude  ──▶  content and selected additions
        │
        ├─ fills ONLY the fields that are still empty
        ├─ attaches a library item, if one fits this subject and grade
        └─ adds selected homework, activity, enrichment or a linked real exam
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
endpoint safe to press twice. Existing additions of the requested type are
preserved; a linked exam is reused when a previous creation succeeded but
linking was interrupted. Old text-only quiz resources do not count as an exam.

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
N8N_BLOCK_ENV_ACCESS_IN_NODE=false   # otherwise $env throws inside a Code node
```

Without the third line the **Verify signature** node cannot read the secret
and says so by name. Setting it is the tidy fix; pasting the secret straight
into the node works too, at the cost of keeping it in the workflow JSON.

Nothing else needs configuring on the n8n side. The node computes its own
HMAC in plain JavaScript because this sandbox exposes neither `TextEncoder`
nor `crypto`, so `NODE_FUNCTION_ALLOW_BUILTIN` is not required either.

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

The extension 1.2.0 sends explicit choices per lesson:

```json
{
  "resourceTypes": ["enrichment", "homework", "quiz", "activity"],
  "includeContent": true,
  "exam": {
    "examType": "quiz",
    "startDate": "2026-10-01",
    "endDate": "2026-10-02",
    "duration": 30,
    "questionCount": 5
  }
}
```

`resourceTypes: []` generates no additions. Omission retains legacy homework
behavior (only if no resource exists). `includeContent: false` generates only
selected additions without changing preparation fields or attaching library
content. Unchecking a type never deletes an existing resource.

Selecting `quiz` requires the `exam` settings, a teacher who owns the preparation,
and `school.exams.create` / `school.exams.manage` (or `*`). The same ExamsService
used by the dashboard checks class assignment, grade criteria, exam-type weight
and existing finals. Types: `quiz`, `final`, `assignment`, `activity`. Duration:
1–240 minutes. Questions: 1–20 multiple-choice questions. Dates use YYYY-MM-DD
and the dashboard's full-day start/end convention; the same day is allowed.

The saved exam belongs to the teacher and appears in their exam list. Its
availability to students follows its dates, independently of preparation review.
Use a future start date to allow teacher review before students can take it.
Correct answers stay in the Exam questions, not in the resource description.

The response adds `data.resourceResults`: one `{type,status,message?,examId?}`
entry per selection, with `status` equal to `created`, `existing`, or `failed`.
Partial generation failures preserve successful content/resources; clients must
show each failure and skip submission of that preparation. Stale writes return
409. Ambiguous network/save errors require refreshing before retrying.

`GET /preparation/generation-options` reports version 1, supported resourceTypes,
includeContent and linkedExams. It confirms backend support, not n8n deployment.
Import the updated workflow as well: old workflows cannot supply all types or
real exam questions, so missing outputs will be reported as failures.

Deploy the backend and updated workflow before extension 1.2.0. Ensure the new
unique partial indexes declared in the schemas exist (through Mongoose index
creation, or the deployment's index migration if automatic indexes are disabled):

- `preparation_resources`: `{schoolId:1, preparationId:1, generationKey:1}`, partial
  filter `{generationKey: {$type: 'string'}}`.
- `exams`: `{schoolId:1, generatedFromPreparation:1}`, partial filter
  `{generatedFromPreparation: {$type: 'objectId'}}`.

These keys are internal; manual resources and ordinary dashboard exams do not
receive them. Retrying does not update an already generated exam's settings;
edit it in the dashboard. No existing indexes need removal.

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

Cost depends on the configured model, selected additions and number of exam
questions. The workflow permits up to 10,000 output tokens for larger requests;
measure actual token usage before estimating a week's cost.

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
