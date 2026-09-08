# Seeding the Curriculum Catalogue

The Saudi national curriculum, once, for every school on the platform.

**Backend:** shipped and tested (`519/519`).
**What is left:** run the seed against production, once.

---

## What this gets you

```
catalog_subjects   162 courses      ← the ministry's, shared, read-only
catalog_units    1,377
catalog_lessons  8,331
```

A school then presses **import**, and gets its **own copy** of a course under
its own subject and grade. Two schools importing the same course each end up
with their own 113 lessons; neither can see the other's, and either may add
lessons the ministry never published — مواهب teaches اللغة الصينية.

That is what "unified curriculum" means here: every school finds the same
curriculum ready, without anything being shared between them.

---

## Run it

Two commands, from `nasaq-backend`. Nothing else in the system is touched —
the `catalog_*` collections are empty and nothing reads them yet, so this is
safe to run before the screens exist.

### 1. Convert

```bash
npm run catalog:convert -- \
  --source /Users/abdelati88/development/moeen/Moeen-Extension/madrasati_courses_clean.json \
  --map    subjects-to-map.csv \
  --out    catalog-source.json
```

Prints what it found and writes `catalog-source.json`. Expect:

```
مقررات : 162 / 162
وحدات  : 1377
دروس   : 8331
```

Any number below 162 means a course was skipped; the script lists which and
why. Fix the mapping sheet rather than seeding a partial catalogue.

### 2. Seed

Dry run first — it prints the counts and writes nothing:

```bash
npm run seed:catalog -- --source catalog-source.json
```

Then, with a **SUPER_ADMIN** token:

```bash
CATALOG_API_URL=https://api.nasaq.185.170.196.120.sslip.io \
CATALOG_ADMIN_TOKEN=<super admin JWT> \
npm run seed:catalog -- --source catalog-source.json --apply
```

162 requests, roughly a minute. It prints each subject as it lands.

**Re-running is safe.** Every write is an upsert keyed by the ministry's own
id, so a second run creates nothing new — verified against a real database.
That is how a curriculum update is applied: re-convert, re-seed, and each
school presses import again.

### 3. Check

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "$API/catalog/subjects?q=رياضيات&limit=5"
```

```jsonc
{ "name": "الرياضيات",
  "variant": "الإحصاء والاحتمال",
  "unitCount": 12, "lessonCount": 113,
  "unitPreview": ["الإحصاء والاحتمال", "الكسور الاعتيادية", …] }
```

---

## Two things to know about the data

### The source has no subject names

A course carries none. What reads like one is the first segment of its first
lesson — the **unit**. So course 86 reads `القيم الإسلامية` and course 160
reads `وحدة تعزيز المهارات`, and 44 of the 75 distinct labels repeat.

`subjects-to-map.csv` supplies the real subject. The original label is kept as
`variant`, which is what a picker shows beside the subject — without it the
list offers `العلوم` thirty-five times with nothing to choose between them.

### 51 courses look identical in the picker

23 groups of them, and in three of the four sampled the lessons are the same
byte for byte: **the ministry publishes one course under two ids.**

A deputy head will see two rows she cannot tell apart. Both import to the same
result, so picking the wrong one is harmless — but it looks like a bug.

**The fix is the grade column.** `subjects-to-map.csv` has `الصف — املأه` and
it is empty on all 162 rows. Fill it, re-convert, re-seed, and `gradeName`
separates them in the list.

The grade is *only* a label. What an import actually lands on is the school's
own grade, chosen at import — and it must be, because schools name grades
differently: مواهب carries both `الصف السادس` and `الصف السادس إبتدائى`.

---

## Then

The catalogue is the prerequisite for two screens that do not exist yet:

- **المناهج والدروس** — where a deputy head imports a course
  (`docs/../SPEC-Frontend-CurriculumScreen.md`)
- **the lesson picker in preparation** — now backed by
  `POST /preparation/bulk` with `items: [{ lectureId, lessonId }]`
