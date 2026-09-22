# Learning Guide

This guide explains every concept this project uses, in the order it's easiest to learn them. Each section says **what the idea is**, **where it lives in the code**, **why it was done this way**, and gives a **small exercise** and the **questions an interviewer is likely to ask**.

Work through it with the code open. You don't need to memorise it; you need to be able to explain each decision in your own words. That is what the walkthrough video and any follow-up interview will test.

---

## Before you start: run it and watch it work

```bash
npm install
npm test                       # 75 tests, all offline
npm run fixtures &             # three fake company sites on http://localhost:8099
npm run evaluate -- --input server/fixtures/cases.sample.json --output kits.json --mock
```

Open `kits.json` and find, for `case-01`:

- `role.requirements`: each has an `id`, `priority` and `evidence`
- `research.pages`: which pages were crawled, and which one `is_hiring`
- `coverage.log`: pass 1 found gaps, pass 2 closed them
- `schedule.days`: exactly 5 days, with the final one a review

Then try the UI with no database or API key:

```bash
npm run demo:api               # terminal 1: API with in-memory DB + mock model
cd web && npm install && npm run dev   # terminal 2: open http://localhost:3000
```

Use company URL `http://localhost:8099/acme/` and paste the `case-01` job description from `server/fixtures/cases.sample.json`.

---

## Study order (≈ 2 days)

| Day | Topic | Why this order |
|---|---|---|
| 1 AM | Part 1: The big picture, Part 2: Node/Express basics | You need the map before the streets |
| 1 PM | Part 3: Retrieval & web scraping, Part 4: Security (SSRF, prompt injection) | Retrieval is where untrusted data enters |
| 2 AM | Part 5: Working with LLMs, Part 6: The pipeline | The heart of the assessment (most points) |
| 2 PM | Part 7: Deterministic logic, Part 8: State & concurrency, Part 9: Frontend, Part 10: Testing & deployment | What the human reviewers will look at |

---

## Part 1: The big picture

**One sentence:** a job description goes in, a *pipeline* of small steps produces a kit, the kit is saved, and the user edits and practises it.

```
Browser ──> Next.js (UI + /api proxy) ──> Express API ──> MongoDB
                                             │
                                             └─> job queue ──> runPipeline()  <── npm run evaluate
                                                                  │
                                    retrieval ◄──────┼──────► LLM client
                                                                  │
                                                        deterministic code (coverage, schedule, validation)
```

**Key idea: separation of concerns.** Each folder has one job:

- `retrieval/` fetches and cleans web pages.
- `llm/` talks to models.
- `pipeline/` decides the order of steps.
- `kit/` holds the rules about a kit's structure and how it can be edited.
- `db/` is persistence.
- `routes/` is HTTP.

**Why it matters here:** the brief requires the batch command to use *the same code* as the app. Because `runPipeline()` receives its dependencies as arguments (`{ llm, fetcher, config }`) and never touches the database, the app and the CLI can both call it. This pattern is called **dependency injection**. It is also why the tests can swap in a fake model.

**Exercise:** open `server/src/pipeline/runPipeline.js` and find the numbered steps (1–10). Then open `server/scripts/evaluate.js` and `server/src/jobs/kitJobs.js`, and find where each calls `runPipeline`.

**Likely questions:**
- *"How does the batch command reuse the app's code?"* Both call `runPipeline()`. Only the persistence around it differs.
- *"What is dependency injection and why use it?"* Passing collaborators in instead of creating them inside. It makes code testable (fake model, fake fetcher) and reusable (CLI vs server).

---

## Part 2: Node.js and Express fundamentals

### Async/await and Promises
Almost everything here is I/O: HTTP, database, model calls. `async` functions return Promises, and `await` pauses until one settles.

- `Promise.all([a, b])` runs two things **concurrently**. Step 1 (read the JD) and step 2 (crawl the site) run together this way in `runPipeline.js`.
- `Promise.race` is used for the per-case timeout in `evaluate.js`.

### ES modules
`"type": "module"` in `package.json` means `import`/`export` syntax. `await` at the top level of a module is allowed, and `evaluate.js` uses it.

### Express 5
- A **router** groups routes (`routes/kits.js`).
- **Middleware** is a function `(req, res, next)` that runs before routes, e.g. `requireAuth` checks the session and `checkOrigin` checks CSRF.
- The **error handler** is middleware with four arguments `(err, req, res, next)`, at the bottom of `app.js`. Every error leaves the API in one shape: `{ error: { code, message, details } }`.
- Express **5** automatically forwards errors thrown in `async` handlers to that handler. In Express 4 you needed a wrapper, which is why the upgrade was made.

### Request validation with zod
`parseBody(schema, req.body)` in `routes/validate.js` either returns clean, typed data or throws a 400 with details. **Never trust input**, and the same applies to model output (Part 5).

**Exercise:** start `npm run demo:api`, register, then send a bad request and read the structured error:
```bash
curl -s -c /tmp/c -H 'content-type: application/json' -d '{"email":"me@x.io","password":"password1"}' localhost:4000/api/auth/register
curl -s -b /tmp/c -H 'content-type: application/json' -d '{"jd":"hi","company_url":"","days":0}' localhost:4000/api/kits
```
Find where each message in the response comes from in `NewKit` (`routes/kits.js`).

**Likely questions:**
- *"What's middleware?"* A function in the request pipeline that can inspect or modify the request, end the response, or call `next()`.
- *"How do you return consistent errors?"* An `AppError` class carrying `code` and `status`, plus one central error handler.

---

## Part 3: Retrieval and web scraping

### Fetching safely: `retrieval/httpFetch.js`
A "fetch a URL" that is safe for untrusted input needs:

- **Timeouts** via `AbortController`: a hanging site must not hang the pipeline.
- **Size limits**: `readLimited` stops reading after 2 MB, so a huge file can't exhaust memory.
- **Content-type allow-list**: only HTML, text, XML and JSON; images and zips are skipped.
- **Manual redirects** (`redirect: 'manual'`), so *every hop* can be re-checked against the SSRF guard (Part 4).
- **Retries with exponential backoff and jitter**: retry after about 0.5 s, 1 s, 2 s, plus a little randomness. Randomness stops many clients retrying at the same instant. Only *retryable* errors (timeouts, 5xx, 429) are retried; a 404 won't fix itself.
- **Politeness**: a delay between requests to the same host.

### robots.txt: `retrieval/robots.js`
A site's rules for bots. We obey `Disallow` and `Crawl-delay`. A missing robots.txt means "allowed"; a 401/403 on robots.txt means "stay out". The `initech` fixture disallows `/initech/private/`, and the test checks we skip it.

### Cleaning HTML: `retrieval/cleanPage.js`
`cheerio` gives jQuery-style access to HTML on the server. The steps:

1. Remove scripts, styles and **hidden elements**.
2. Collect links, including those in navigation.
3. Remove navigation, header and footer chrome.
4. Turn block elements into newlines to get readable text.

### Finding the hiring page without hard-coded paths: `retrieval/linkRanker.js` + `crawler.js`
This is the "interesting half" the brief mentions.

1. **Score links**, not paths. Each link gets two scores (hiring intent, about intent) from words in its URL and its anchor text, weighted: `interview` > `hiring` > `careers` > `handbook`.
2. **Best-first crawl** with a budget: always fetch the highest-scoring unvisited link next (a priority queue).
3. **Follow links from careers pages** with a bonus, because interview-process pages hang *off* the careers page. That's how the fixture's `/acme/company/people/how-we-hire.html` is found.
4. **Classify by content** after fetching. A page counts as "hiring" only if it actually discusses interviews.
5. **Scope**: stay under the path given (`/acme/`), so one company's crawl can't wander into another's pages on the same host.
6. **Sitemap**: `sitemap.xml` lists pages that aren't linked anywhere visible.

**Exercise:** add a fixture page `server/fixtures/sites/globex/jobs/interviews.html` that describes an interview process, link to it from `globex/index.html`, and rerun the tests. The test "a site with no hiring page is reported honestly" should now fail. That's the crawler finding it. Then undo the change.

**Likely questions:**
- *"Why not just try /careers and /jobs?"* The brief says companies bury it in unpredictable places; GitLab keeps it in a handbook. Ranking links generalises; a path list doesn't.
- *"Why not a headless browser (Puppeteer)?"* It is heavy on free hosting, slow, and most about/careers pages are server-rendered. The trade-off: JavaScript-only sites give a thin brief, and the kit says so.
- *"How do you stop the crawler running forever?"* A page budget (8), a time deadline, a visited set, and scope limits.

---

## Part 4: Security

### SSRF (Server-Side Request Forgery): `retrieval/urlGuard.js`
The app fetches URLs that users give it. A malicious user could give `http://169.254.169.254/` (the cloud metadata service, where server credentials live) or `http://localhost:27017`. The server would then fetch *inside* your network on their behalf.

The defence:

1. Parse the URL; allow only http(s) and no embedded `user:pass@`.
2. **Resolve the hostname via DNS** and reject it if *any* resulting IP is private, loopback, link-local or CGNAT (`isPrivateIp`).
3. Repeat the check on **every redirect**. Otherwise `https://evil.com` could redirect to `http://127.0.0.1`.
4. It is on in production. The batch command turns it off because the evaluators host test sites on localhost.

*Known gap:* DNS rebinding. The name can resolve to a public IP when checked and a private one when fetched. The fix is to connect to the exact IP you checked. This is documented as a limitation. Knowing your own gaps impresses interviewers.

### Prompt injection: `llm/prompts.js`, `cleanPage.js`, grounding checks
Web pages and the pasted JD are text *you didn't write*, and they go into a model. A page can say "ignore previous instructions". There are four layers of defence:

1. **Strip hidden text**, a favourite hiding place for injections (see the Acme fixture's `display:none` div).
2. **Fence untrusted text** in `<untrusted>` tags, with a system prompt saying it is data, not instructions.
3. **No capabilities**: the model has no tools and can't trigger fetches. Link choice is deterministic code, so the worst an injection can do is distort text.
4. **Verify output with code**: requirements must quote the JD; ids must exist; cited URLs must be ones we fetched; interview-format signals come from regex, not the model.

**Key insight:** you can't make a model immune to injection, so you **limit what the model is trusted to decide** and verify the rest.

### Auth and sessions: `auth/`
- **bcrypt** hashes passwords (slow on purpose, salted). The database never holds a password.
- **JWT** (JSON Web Token): a signed token `{ sub: userId, email, exp }`. The server verifies the signature with `JWT_SECRET`, with no database lookup.
- It is stored in an **httpOnly cookie**, so JavaScript can't read it and an XSS bug can't steal it.
  - `SameSite=Lax`: the browser won't send it on cross-site POSTs (CSRF defence).
  - `Secure` in production: HTTPS only.
- **Ownership**: every query includes `userId`, and another user's kit returns **404, not 403**, so we don't reveal that it exists.
- **CSRF, belt and braces**: `checkOrigin` rejects write requests from foreign origins.
- **Rate-limited login**, plus the same error for "no user" and "wrong password", so attackers can't discover which emails have accounts.

**Likely questions:**
- *"What's SSRF and how did you prevent it?"* See above. Mention DNS resolution and redirect re-checks.
- *"How do you defend against prompt injection?"* Four layers; the key is limiting what the model decides and verifying the rest.
- *"Why cookies instead of localStorage for the token?"* httpOnly cookies can't be read by injected scripts.
- *"JWT downside?"* You can't revoke one before it expires without a denylist. Short expiry mitigates this.

---

## Part 5: Working with LLMs reliably: `llm/`

This is where most candidates lose points ("A pipeline that falls over the first time a provider says 'slow down'…").

### Rate limits: `llm/rateLimiter.js`
Free tiers cap **requests per minute (RPM)** and **tokens per minute (TPM)**. Our limiter keeps a **sliding 60-second window** of `{time, tokens}` events. Before each call it waits until both limits have room.

- Tokens are *estimated* before the call (characters ÷ 3.5 + max output tokens).
- `penalise(ms)`: after a 429, *all* callers wait, not just the one that was refused.

### Retries and backoff: `llm/client.js` → `viaSlot`
| Error | Action |
|---|---|
| 429 rate limited | Wait for `Retry-After` / Gemini's `retryDelay`, else exponential backoff, then retry |
| 5xx / timeout | Exponential backoff, then retry (max 6, and a total wait cap) |
| Daily quota exhausted | Stop using this provider for 15 minutes; switch to the next one |
| Bad auth | Disable the provider for an hour; switch |

### Structured output and repair
1. Ask for JSON; both providers have a JSON mode.
2. `parseJsonLoose` tolerates code fences, surrounding prose and trailing commas.
3. **Validate with zod.** On failure, send the *validation error back to the model* as a follow-up message and ask for a corrected answer, up to 2 repairs. If the output was truncated, ask for fewer items.
4. If it still fails, try the next provider; if everything fails, raise `LLM_UNAVAILABLE`. The pipeline then uses rule-based fallbacks, so a kit is still produced and marked degraded.

### Providers: `llm/providers/`
Gemini uses Google's REST format. Groq and OpenRouter share the OpenAI chat-completions format, so one file (`openaiCompatible.js`) handles both. Adding a provider means writing one small adapter that returns `{ text }` or throws a `ProviderError` with a code. This is the **adapter pattern**.

### The mock provider: `llm/providers/mock.js`
It is deterministic and needs no network, answering from the structured `data` each step passes. It is deliberately *imperfect*: it skips one requirement per category, so the coverage loop has something to fix. That's how the tests prove the second pass works.

**Exercise:** in `server/test/llmClient.test.js`, read the test "rate limit (429) is waited out". Change the script so the provider returns 429 seven times, and predict what happens before you run it. (Answer: `LLM_UNAVAILABLE`, because the retry cap is 6.)

**Likely questions:**
- *"What happens when the provider says slow down?"* Explain the limiter, `Retry-After`, the shared penalty and provider fallback.
- *"How do you guarantee valid JSON?"* You can't guarantee what the model produces. So validate, send back a repair message, fall back, and validate the final kit again before saving.
- *"Why two providers?"* Free daily quotas run out; the fallback keeps the batch run alive.

---

## Part 6: The pipeline: `pipeline/`

The brief cares most that generation is **"a sequence of deliberate steps that respond to what has actually been found"**, not one giant prompt. Know these steps well enough to draw them.

1. **Extract requirements** (`extractRequirements.js` + `grounding.js`)
   - The model returns requirements, each with an `evidence` quote.
   - `locateEvidence` finds the JD line containing that quote (exact match, or at least 60% of its words). If it isn't there, the requirement is **dropped as invented**.
   - `priorityFromPosting` reads must/nice from the posting itself: first the line's own wording ("…is a plus"), then the nearest section heading above it ("Nice to have:"). The model's guess is used only when the posting is silent.
   - Near-duplicates are merged; ids r1…rn are assigned in posting order, so they are **stable**.
2. **Crawl** (Part 3), in parallel with step 1.
3. **Discussion search** (`retrieval/discussion.js`): Hacker News/Reddit hits must mention the company *and* an interview word. They are labelled unverified and never used as fact.
4. **Hiring process** (`hiringProcess.js`)
   - Signals (take-home, system design…) come from **regex with negation handling**: "we don't do whiteboard" doesn't count as a whiteboard signal.
   - The model only summarises the stages, and may only cite pages we fetched.
   - With no hiring page, there is no model call and the process is honestly marked unknown.
5. **Company brief** (`companyBrief.js`): built only from retrieved pages. Sources are set by code. With no pages, the brief starts with "We could not read…".
6. **Plan categories** (`categoryPlanner.js`): **code** decides which categories exist and which requirements each covers.
   - React goes to technical; mentoring goes to behavioural.
   - System design is added for senior roles with architecture-type requirements, or when the company publishes a design round.
7. **Questions, one call per category** (`generateQuestions.js`): each category has its own instructions, and hiring signals change them. That's how "a company that publishes a take-home followed by system design produces a different kit".
8. **Coverage loop** (Part 7).
9. **Flashcards**, with a fallback derived from the questions.
10. **Schedule and validate** (Part 7).

**Likely questions:**
- *"Why not one prompt?"* A single prompt can't react to what was found. It mixes different instructions, and it's all-or-nothing on failure. Separate steps can each be validated, retried and replaced by a fallback.
- *"How do you stop the model inventing requirements?"* Evidence quotes checked by code.
- *"How does a hiring page change the kit?"* Signals change the category plan (system design gets added) and the per-category instructions (take-home defence questions).
- *"What happens with a two-line JD?"* Only literally present requirements survive, `thin_jd` is set, a note explains why, and the question count scales down.

---

## Part 7: The deterministic parts (the brief insists these are code, not the model)

### Coverage check and second pass: `pipeline/coverage.js`
`findGaps()` is a set difference: requirements whose id appears in no question's `requirement_ids`. The loop:

```
pass 1: check draft → gaps?
  yes → ask model for questions targeted at exactly those ids (grouped by owning category)
pass 2: check again → usually closed
pass 3: one more try if needed
still gaps → add a labelled template question (never ship an uncovered must-have)
```

**Why stop at 3?** Say this in your video: pass 2 closes almost everything because the prompt names the missing ids; pass 3 catches stragglers; more passes cost rate-limited calls for almost no gain. The template guarantees the loop *terminates* and the kit is still honest about what happened.

### Schedule: `pipeline/scheduler.js`
This is pure arithmetic, so it is testable and exact:

1. Minutes per question come from difficulty and category. All integers.
2. Priority: must-have coverage first, then difficulty. Sort.
3. Split the days into a learning phase and a review phase: about 25% review with 4+ days; the final day is always a light must-have review.
4. **Front-loaded partition:** day *i*'s target is proportional to `2L − i`, so day 1 carries about twice the last learning day. Fill in priority order; each day gets at least one item; nothing is dropped.
5. `checkSchedule()` enforces the brief's rules: exact day count, integer minutes, existing question ids, every must-have present.

### Structure validation: `kit/schema.js`
Appendix A is written as a zod schema. `.passthrough()` allows our extra fields; the required ones must be exact. It adds **referential integrity**: every id a question, flashcard or schedule day references must exist, and there are no duplicate ids. It runs before every save and on every batch output.

**Exercise:** in `scheduler.js`, change the weights from `2 * L - i` to `L + i` (back-loaded). Run `npm test` and read which test fails ("harder and must-have material lands earlier…"). That test is protecting a requirement from the brief. Undo the change.

**Likely questions:**
- *"Why not let the model make the schedule?"* It is arithmetic with hard constraints (exact days, integer minutes, every must-have). Models are unreliable at counting, and code is exact and testable.
- *"How does a 1-day vs 60-day schedule differ?"* 1 day contains everything, must-haves first. 60 days is a short learning phase (capped so each day has real content), then rotating review.

---

## Part 8: State, editing and concurrency (the "hardest state problem")

### The state model: `kit/mutations.js`
Each item has `meta: { origin, edited, pinned }`.

- **Protected** means `origin === 'user' || edited || pinned`.
- Regenerating a category replaces only *unprotected* items in *that* category.
- A pinned brief or schedule refuses to regenerate.
- **Pure functions**: every mutation takes a kit and returns a *new* kit (`structuredClone`). There is no database inside, so the rules are unit-tested directly (`builder.test.js`).
- **Stable ids**: `builder_state` counters mean a deleted `q7` is never reused, so practice history and schedule references don't point at the wrong thing.

### Optimistic concurrency: `db/kitStore.js` → `mutate()`
The problem: two writes at once (an edit and a regeneration finishing) could overwrite each other ("lost update"). The solution:

1. Every document has a `rev` number.
2. Read the doc, compute the change, then update **only if `rev` is still the same**, and increment it.
3. If someone else wrote first, the update matches nothing. Re-read and re-apply the change to the newer document.

This is called **optimistic** because it assumes conflicts are rare and handles them when they happen, rather than locking.

### Two-phase regeneration: `kit/regenerate.js`
1. `compute…(snapshot)` makes the slow model call on a copy.
2. `apply…(latestKit, result)` is fast and pure, and **re-reads protection flags from the latest kit**.

So if you edit a question *while* its category is regenerating, your edit is already in the latest kit when the merge runs. It's protected and survives. The test "an edit made WHILE a category regenerates survives the merge" proves it.

### Duplicate submissions
`dedupeKey` is a SHA-256 of the normalised JD, URL and days. While a kit is generating, `activeKey` is set, and a **unique partial index** (`{userId, activeKey}`, only where `activeKey` is a string) makes a second identical job impossible, even from a double-click race. MongoDB error `11000` means "duplicate key", and the code returns the winner.

### Background jobs: `jobs/`
Generation takes 1–3 minutes, too long for an HTTP request. The API creates the kit with `status: queued` and returns **202 Accepted**; a queue runs the pipeline and writes progress to the database. On restart, jobs that were running are marked `INTERRUPTED` and can be retried.

**Likely questions:**
- *"How do you make sure regeneration doesn't clobber edits?"* The protection rule, plus two-phase regeneration, plus optimistic concurrency. Explain all three; this is the question the brief says they'll "look closely" at.
- *"What's optimistic vs pessimistic locking?"* Optimistic: check a version on write and retry on conflict. Pessimistic: lock before reading. Optimistic suits rare conflicts and needs no lock cleanup.
- *"What if the server restarts mid-generation?"* State lives in MongoDB; the kit is marked interrupted; the user clicks Retry. A durable queue (Redis/BullMQ) would resume automatically. It wasn't used because of the free tier and to keep the app simple.

---

## Part 9: Frontend: `web/`

### Next.js App Router
- Folders in `app/` are routes; `app/kits/[id]/page.js` is a dynamic route.
- `'use client'` marks components that use state or effects.
- `middleware.js` redirects signed-out visitors before the page renders. The API still checks the session on every request; the middleware only improves the experience.
- `next.config.mjs` **rewrites** `/api/*` to the backend, so the browser sees one origin. The cookie is first-party and needs no CORS configuration.

### Data flow: `lib/useKit.js`
- **Polling:** while generating, call `/status` every 1.5 s, and fetch the full kit when it finishes. It's simpler and more robust than WebSockets on free hosting.
- **`rev` check:** ignore server responses older than what we already have, so out-of-order responses can't roll the UI back.
- **Optimistic UI:** reorders and deletes apply locally first, then call the API. On failure, revert and show a toast.

### "Immediate" editing: `components/EditableText.js`
- Typing changes only local state.
- A **debounced** save fires 700 ms after the last keystroke, or on blur.
- While focused or unsaved, the field **ignores incoming server data**, so a background refresh can't overwrite what you're typing.
- Escape reverts; a small "Saving… / Saved / Not saved" indicator reports status.

### Drag and drop: `@dnd-kit`
Chosen because of its **keyboard sensor**: focus the handle, press Space, use the arrows, press Space again. The brief requires keyboard navigation. A category dropdown offers a second way to move questions between categories.

### Accessibility and responsive design
- A skip link and `aria-live` regions (progress, toasts, practice).
- Real `<label>`s, visible focus rings and `aria-pressed` on pin toggles.
- `prefers-reduced-motion` respected; dark mode via `prefers-color-scheme`.
- Tailwind breakpoints (`sm:`, `md:`, `lg:`): the section nav becomes horizontal tabs and question controls stack on phones.

### Design choices
- A "study desk" theme: cool paper, navy ink, one teal for actions.
- A **highlighter yellow used only for must-have requirements**, like marking up a printed job ad, so priority is visible everywhere.
- The flashcard is a ruled **index card**, the one decorative element.

**Likely questions:**
- *"How do you handle a long-running generation in the UI?"* Background job, per-step progress with real details, a "you can leave this page" message, failure shown inline with Retry.
- *"What's debouncing?"* Waiting until activity stops before acting: one save instead of one per keystroke.
- *"What's an optimistic update?"* Show the result before the server confirms, and roll back on error.

---

## Part 10: Testing and deployment

### Tests: `server/test/`, run with `npm test`
Node's built-in test runner. The ones the brief asks for:

- `scheduler.test.js`: exact days for 1…365, integers, must-haves, front-loading
- `coverage.test.js`: gap detection, the second pass closing gaps, the template fallback
- `schema.test.js`: each way a kit can be malformed is rejected

Plus:

- `builder.test.js`: edits survive regeneration, including edits made during it
- `retrieval.test.js`: uses the real fixture server
- `llmClient.test.js`: 429 handling, repair, fallback
- `api.test.js`: the full HTTP flow with an in-memory DB stand-in (`test/support/fakeModels.js`)
- `evaluate.test.js`: runs the actual CLI and checks the Appendix B output

### Deployment
Three free services:

| Service | Hosts | Setup |
|---|---|---|
| MongoDB Atlas | Database | An M0 cluster |
| Render | Express API | `render.yaml` "blueprint" |
| Vercel | Next.js app | Root directory `web` |

Environment variables carry secrets; `.env` is git-ignored, and `.env.example` documents every variable.

---

## Your 3–4 minute walkthrough video: a script

Record at 1280×800 or larger, and zoom the browser to 110%. Prepare a kit *before* recording and generate a fresh one live, so waiting doesn't eat your time.

| Time | Show | Say (roughly) |
|---|---|---|
| 0:00–0:20 | Kits page | "This turns a job description and a company URL into a researched prep kit. I'll build one, then show the pipeline, editing, practice and one design decision." |
| 0:20–0:50 | Paste a JD + real company URL (e.g. posthog.com), 5 days, Build | "Generation runs as a background job; each step shows what it actually found." Point at the crawl step finding the hiring page. |
| 0:50–1:40 | README pipeline table or `runPipeline.js`, then the kit's Questions tab | "Ten steps. Requirements must quote the posting, and code drops anything invented. Categories are generated separately. Then code checks coverage: here pass 1 left gaps, pass 2 closed them. I cap it at three passes, then a labelled template, so a must-have never ships uncovered." |
| 1:40–2:30 | Questions tab | Edit a question inline, drag to reorder, move one to another category, click Regenerate technical. "The edited question is protected. It's kept, and only unedited generated ones are replaced. I can even edit during regeneration: the merge re-reads the latest version with optimistic concurrency." Show the toast "…1 of yours kept". |
| 2:30–3:05 | Schedule, then Practice | "Exactly five days, allocated by code, not the model: must-haves and harder material first, last day a light review." Reveal a card, press 1/2/3. "Least confident comes first. I chose that over spaced repetition because you have days, not months." |
| 3:05–3:30 | Story bank | "My creative feature: the same coverage check, pointed at you. Which behavioural requirements have no story of yours yet." |
| 3:30–3:50 | Overview with the "What this kit is based on" notice (use a site with no hiring page) | "The decision I'd defend: the model never decides what's true. It proposes; code verifies against the posting and the pages. A thin posting gives a thin kit that says so." |

---

## Pre-submission checklist

- [ ] `git config user.name "Your Name"` and `git config user.email "you@..."`, then rewrite the author on the existing commits if you want your name on them: `git rebase -r --root --exec "git commit --amend --no-edit --reset-author"`
- [ ] Get a free Gemini key, put it in `.env`, and run `npm run evaluate -- --input server/fixtures/cases.sample.json --output kits.json` **with the fixtures server running**. Read the kits and check the requirements look right.
- [ ] Run it once with 5 cases against real company URLs and time it; it should be well under 15 minutes.
- [ ] From a **fresh clone**: `npm install && npm test`, and the evaluate command works.
- [ ] Deploy (Atlas → Render → Vercel), set `APP_ORIGIN` on Render to the Vercel URL, and register on the live site.
- [ ] Put the live URLs at the top of the README.
- [ ] Record the video and watch it once at 1× speed.
- [ ] Submit with a day of margin; the link can't be reopened.

---

## If an interviewer asks something you don't know

Say what you'd do and how you'd find out. For example: "I'd pin the resolved IP to close the DNS-rebinding gap; I documented it as a limitation because I ran out of time." Knowing your system's limits is part of the judgment they're assessing.
