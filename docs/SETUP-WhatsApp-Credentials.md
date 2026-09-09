# WhatsApp Credential Delivery — Setup

When a student or teacher account gets a password, their login details go to
the phone number on their record, over WhatsApp.

**Backend:** shipped, tested (`475/475`).
**n8n:** workflow ready to import — `n8n/nasaq-whatsapp-credentials.json`.
**What is left:** the environment variables below, on both servers.

---

## How it fits together

```
   PATCH /students/:id/password
              │
              ▼
   ┌──────────────────────┐   row written FIRST
   │ outboundmessages     │   ── this is what makes it reliable
   └──────────┬───────────┘
              │  POST, HMAC-signed
              ▼
   ┌──────────────────────┐
   │ n8n webhook          │   verify signature → build Arabic text
   └──────────┬───────────┘
              ▼
   ┌──────────────────────┐
   │ Evolution API        │   POST /message/sendText/{instance}
   └──────────┬───────────┘
              ▼
        the parent's phone
```

### Why Nasaq does not call Evolution directly

It is fewer moving parts and it is the wrong shape.

The message is Arabic prose the school will want to reword, and every reword
would be a backend deploy. Delivery also fails in ways only the WhatsApp side
understands — instance disconnected, number not on WhatsApp, rate limit — and
handling those in NestJS means reimplementing what n8n already does.

So the backend emits a *fact* ("these credentials were issued to this person")
and n8n owns the wording and the sending.

### What the backend keeps, because n8n cannot

**Never losing the event.** The outbox row is written before the HTTP call, so
an n8n outage delays a message instead of dropping it. A cron retries every
minute on a backoff of 1 / 5 / 15 / 60 / 240 / 720 minutes — six attempts over
about seventeen hours — and then marks the row `failed`.

**Never failing an enrolment over a message.** `enqueue` does not throw and is
not awaited for its result. WhatsApp being down cannot stop a student being
created.

**Never sending twice.** A dispatch claims its row atomically before sending.
Without that, a cron tick landing during an in-flight request matched the same
row and the parent got the same password twice; there is a regression test for
exactly this (`does not send a message twice when a tick lands while the first
request is still in the air`).

---

## 1. Environment — Nasaq backend

```bash
WHATSAPP_WEBHOOK_URL=https://n8n.yourdomain.com/webhook/nasaq-credentials
WHATSAPP_WEBHOOK_SECRET=<openssl rand -hex 32>
WHATSAPP_DEFAULT_COUNTRY=966
WHATSAPP_ENABLED=true
```

`WHATSAPP_WEBHOOK_URL` unset ⇒ nothing is sent, and every event is recorded as
`skipped` with the reason. The feature is never silently doing nothing.

`WHATSAPP_DEFAULT_COUNTRY` is what turns `0501234567` into `966501234567`. A
number already carrying its own country code (`+201001234567`) is left alone,
so a teacher hired from Egypt still gets their message.

---

## 2. Environment — n8n

Two variables. Both are secrets, which is the only reason they are variables
at all — the Evolution URL and instance are baked into the workflow.

```bash
NASAQ_WEBHOOK_SECRET=<the same value as WHATSAPP_WEBHOOK_SECRET>
EVOLUTION_APIKEY=<the Evolution instance API key>
```

Optional, and only if the frontend moves:

```bash
NASAQ_PORTAL_URL=https://nasaq.185.170.196.120.sslip.io
```

**On Easypanel:** the n8n service → **Environment** → add them → **Deploy**.
n8n reads `$env` at run time but only loads new variables on boot, so the
redeploy is required; setting them without one looks like it worked and the
Verify node still throws.

If `$env` comes back empty, the instance has `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`.
Set it to `false`.

---

## 3. Import the workflow

n8n → **Workflows** → **Import from File** → `n8n/nasaq-whatsapp-credentials.json`,
then **Activate**.

Copy the **Production URL** from the Webhook node — that exact string is
`WHATSAPP_WEBHOOK_URL`. Note the difference:

```
/webhook-test/nasaq-credentials   ← Test URL: one execution, only while the
                                     editor is open. Not this one.
/webhook/nasaq-credentials        ← Production URL: this one.
```

Pointing the backend at the test URL is the most common way this ends up
"working once and then never again".

### What the seven nodes do

| Node | Job |
|---|---|
| **Webhook** | Receives the event. **Raw Body is ON** — the signature covers the exact bytes, so re-serialising the parsed JSON would break it. |
| **Verify signature** | Recomputes the HMAC and compares it in constant time. It borrows nothing from the host: the Code node sandbox has no `TextEncoder` and no `crypto` of either kind, so SHA-256 and HMAC are computed in plain JavaScript inside the node. `src/messaging/n8n-verify-node.spec.ts` runs this node's real source in an equally bare sandbox. |
| **Signature valid?** | Splits valid from forged. |
| **Build message** | **This is the node you edit to change the wording.** Three texts: welcome, password reset, connection test. |
| **Evolution — sendText** | `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}`, `apikey` header. |
| **200 OK** | Tells Nasaq it is done, which marks the row `sent`. |
| **401 Bad signature** | Wrong secret. Nasaq retries, which is right — that is a configuration error somebody must fix, not a message to drop. |

**Do not switch "Continue on Fail" on for the Evolution node.** It would answer
200 on a failed send, and Nasaq would record a message as delivered that never
arrived.

### The Evolution node

It sends the shape already proven working on this server — flat `number` and
`text` body parameters, `apikey` header, Evolution API v2:

```
POST https://saree3-evolution-api.tfgpna.easypanel.host/message/sendText/aura
```

To point at a different instance, edit the URL on that one node. If a future
server runs Evolution **v1**, the body becomes
`{ "number": ..., "textMessage": { "text": ... } }` instead.

---

## 4. Prove it works

```http
POST /messaging/test
Authorization: Bearer <owner token>

{ "phone": "0501234567" }
```

Sends a real WhatsApp message carrying **no password**. The response says what
happened:

```json
{ "message": "تم إرسال رسالة الاختبار",
  "data": { "phone": "+966501234567", "status": "sent", "lastError": null } }
```

`status: "skipped"` with a `lastError` means it never left Nasaq — read the
error. `status: "pending"` means n8n did not answer 200; check the execution
in n8n.

Then create a real teacher and watch the message arrive.

---

## 5. When a school says "the message never came"

```http
GET /messaging/deliveries?limit=50
GET /messaging/deliveries?status=skipped
```

Owner and manager only. **Never returns the password.**

| status | meaning | what to do |
|---|---|---|
| `sent` | n8n accepted it | If the phone still got nothing, the problem is in n8n or Evolution — check the execution log there. |
| `pending` | not yet delivered, retrying | `attempts` and `nextAttemptAt` say where it is; `lastError` says why. |
| `skipped` | never left Nasaq | `lastError` says which: bad phone number, or no webhook configured. |
| `failed` | six attempts, gave up | Fix the cause, then set the password again. |

```http
POST /messaging/deliveries/:id/retry
```

Re-queues one row. It refuses a row whose password has already been wiped —
which is deliberate, not a bug: see below.

### The password's life in this collection

It is stored only while it is needed to send, and dropped the moment the row
reaches a terminal state — delivered, or out of retries. Rows are deleted
entirely after 30 days by a TTL index.

So a message that has already been delivered cannot be resent: the password is
gone. To get someone their details again, set the password again from their
profile — which issues a new message.

---

## What triggers a message

Every one of these. There is no path that creates an account and sends nothing.

| Action | Sends |
|---|---|
| `POST /students` | Welcome, with the school email and the password |
| `POST /teachers` | Welcome, with their email and the password |
| `PATCH /students/:id/password` | Reset notice — typed or generated |
| `PATCH /teachers/:id/password` | Reset notice — typed or generated |

`password` is optional on both create endpoints, and the web form leaves it
empty. When it is absent one is generated — eight characters from an alphabet
with no `0/O` or `1/l` in it, because these get read aloud and retyped.

The generated password is **not** in the API response. WhatsApp is how it
reaches the person. If it did not arrive, set the password again from the
profile; that returns it to the admin and sends a fresh message.

### Two things this changed

**Students used to be created unable to log in.** With `password` empty the row
was saved with `hasPassword: false`, and every login attempt answered
`لم يتم تعيين كلمة مرور لهذا الحساب بعد` until somebody opened the profile and
set one. In practice nobody did. Every student now gets a working account at
creation.

**Teachers used to share one password.** `POST /teachers` without a password set
the literal `Teacher@123` — the same string for every teacher in every school
on the platform, so anyone who ever saw one teacher's credentials could sign in
as any other teacher who had not changed theirs, across tenants.

> **Teachers created before this change still have `Teacher@123`.** Reset them:
> `PATCH /teachers/:id/password` with no body generates a new one and sends it.

---

## Security notes

- **The password travels in plaintext** to n8n and then over WhatsApp. That is
  inherent to sending someone their password. What is controlled: HTTPS,
  an HMAC on every body, and the shortest possible life in the database.
- **Use HTTPS for the webhook.** Over plain HTTP the password is readable by
  anything on the path, and the signature does not help.
- **The secret is what protects the school's WhatsApp.** Without it, anyone who
  learns the URL can post a fake credentials event and n8n will dutifully send
  it to any number they choose. Set it.
- The message tells the recipient to change their password after first login.
  Nothing enforces that yet.
