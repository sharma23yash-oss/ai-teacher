# AI Teacher — repository audit

_Last updated: 2026-11-06, at the start of the "best-in-class" upgrade. Read this before adding a feature: most of the building blocks below already exist and should be extended, not rebuilt._

## 1. Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.3 (App Router, Turbopack), React 19.2, TypeScript 5 |
| Styling | Tailwind CSS 4, lucide-react icons |
| AI providers | Google Gemini (`@google/genai`), Groq (`groq-sdk`), Cohere (`cohere-ai`) — 9 models, automatic failover |
| Voice | Browser Web Speech API for input; Microsoft Edge neural TTS (`msedge-tts`) for output |
| Documents | `pdf-parse` plus in-repo DOCX/PPTX/ZIP readers; Gemini embeddings with lexical (BM25-style) fallback |
| Video / avatar | Remotion player, three.js / react-three-fiber avatar, MediaPipe gesture recognition |
| Validation | zod 4 on every API request body |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`) with an in-memory fallback, in `proxy.ts` |
| Hosting | Vercel (`https://ai-teacher-rho-nine.vercel.app`) |
| Runtime | Node 26 locally; API routes use the Node.js runtime |
| Tests | **None yet.** No test runner is installed. Node 26's built-in `node --test` runs TypeScript directly, so pure-logic tests need no new dependency. |

## 2. API routes

| Route | Purpose | Rate limit / min / IP |
| --- | --- | --- |
| `POST /api/teach` | One teaching turn: builds the prompt (persona, language, level, time budget, exam preset, retrieved passages, learner briefing), calls a model with failover, returns a structured `LessonPayload` | 20 |
| `POST /api/upload` | Extracts text from PDF / DOCX / PPTX / TXT / MD (4.5 MB max), chunks and indexes it, returns a `docId` | 10 |
| `POST /api/tts` | Neural text-to-speech for the teacher's voice | 30 |
| `POST /api/refine` | Rewrites a rough student prompt into a clearer one | 20 |
| `POST /api/course` | Course tools: `summary` (chapter summary with page citations), `questions` (generator with difficulty, type and explanations), `grade` (marking-scheme feedback on a descriptive answer) | 20 |
| `GET /api/providers` | Which providers have a key configured (no key values) | 60 |
| `POST /api/metrics` | Anonymous usage events (5 types), aggregated on write | 30 |

All `/api/*` calls pass through `proxy.ts`, which rejects requests whose Origin/Referer is not this site (403) and rate-limits per IP (429).

Pages: `/` (landing → lesson), `/metrics` (owner dashboard, `METRICS_TOKEN`), `/opengraph-image`, `/robots.txt`, `/sitemap.xml`.

## 3. Data storage

| Data | Where | Lifetime | Notes |
| --- | --- | --- | --- |
| Learner profile (topics, scores, strong/weak concepts, history, preferences) | Browser `localStorage` (`ai-teacher.learner-profile.v1`, `lib/learner-profile.ts`) | Until the student clears it | Per-browser. No accounts, so nothing follows a student between devices. |
| Lesson state (concept plan, phase, misconceptions) | React state, re-sent with every turn | One tab session | Lets any provider resume the lesson after a failover. |
| Uploaded documents and their index | Server memory (`lib/rag/store.ts`, a process-local `Map`) | Until the serverless instance is recycled | The client re-sends the raw text if retrieval stops working, so lessons stay grounded. Not shared between instances. |
| Usage metrics | Upstash Redis hashes (`metrics:*`), or server memory without Upstash | Redis: permanent (daily keys 400 days). Memory: resets on cold start. | Aggregate counters only, no per-person rows. |
| Rate-limit counters | Upstash Redis or memory | 60-second windows | |

**There is no database and no per-student server-side record.** That is fine for a single learner, but several roadmap items need one (see section 6).

## 4. What already exists (do not rebuild)

| Area | Existing implementation | Roadmap item it overlaps |
| --- | --- | --- |
| Landing / onboarding | One prompt box, English/Hinglish toggle, Advanced drawer, three sample lessons, How it works, footer (`components/onboarding/landing.tsx`) | Phase 1 — done |
| Model tiers | Fast / Balanced / Deep with provider and model tooltip (`components/stage/model-selector.tsx`) | Phase 1 — done |
| SEO | Metadata, OG and Twitter tags, generated preview image, robots, sitemap, JSON-LD (`app/layout.tsx`, `lib/site.ts`) | Phase 1 — done |
| Socratic loop | Concept plan (3–10 concepts), statuses `completed / current / misconception / locked`, phases `introduction / explanation / assessment / scaffolding` (`lib/pedagogy-engine.ts`) | Phase 2 mastery and hint ladder should extend this |
| Skill tree | `components/brain/skill-tree.tsx` shows concept status | Phase 2 #5 adds a mastery percentage to it |
| Quiz + report card | Multiple-choice quiz, report card, weak concepts demoted and re-taught at once (`quiz-stage.tsx`, `dashboard.tsx` `handleQuizCompleted`) | Phase 2 #5 mastery updates come from here |
| Feynman mode | AI plays a confused student and the human explains (`FEYNMAN_SYSTEM_PROMPT`) | Phase 2 #7 teach-back is a separate mode on purpose: in Feynman the AI is the student; in teach-back the AI stays the teacher and grades the student's explanation, so the normal concept-plan rules and mastery tracking still apply |
| Learner profile | Per-topic scores, weak/completed concepts, briefing sent to the model | Phase 2 #5 and #8 should extend `lib/learner-profile.ts` |
| RAG | Chunking by heading with page/slide ranges, embeddings + lexical hybrid retrieval, "grounded on" trace with page locators, chapter outline, chapter summaries and question generation with page citations (Phase 3) | Shared index storage |
| Exam prep | NISM / CFA / GATE presets with format and marking rules in the prompt (`EXAM_PRESET_META` in `lib/types.ts`) | Phase 3 #12 — needs NISM Series XV specifically, board exams, and syllabus maps with weightage |
| Metrics | Lessons started/completed, quiz scores, languages, session length, feedback, tiers, exam presets; `/metrics` with token | Phase 4 #14–15 — missing anonymous ID, returns, pre/post test, cost, charts, CSV |
| Feedback | "Did you understand this?" card with optional comment | Phase 4 #16 — done |
| Voice | Hands-free speech input in 19 languages (Hinglish via the Hindi recogniser), neural TTS per language | Phase 5 #19 — voice already exists; low-bandwidth mode does not |
| Multilingual | 19 languages incl. Hinglish, switchable mid-lesson | Phase 5 #19 |
| Safety | Prompt-injection canary (`lib/security/canary.ts`), output sanitiser (`lib/security/sanitize-output.ts`), zod bounds, origin check, rate limits | Phase 4 #18 — no content moderation or age-appropriateness checks yet |
| Video lessons, video call, gestures | Present and working | Not in the roadmap; leave as is |

## 5. Known problems

1. ~~**No automated tests.**~~ Fixed in Phase 2: Vitest, `npm test` (mastery, hint ladder, spaced repetition, misconception matching, summary, exam content files).
2. **No type-check script.** `npm run build` type-checks, but there is no fast standalone check. Added `npm run typecheck` in Phase 1.
3. **Env vars were undocumented in git.** `.gitignore` ignores `.env*`, so `.env.local.example` was never committed. Phase 1 adds a tracked `.env.example`.
4. **Metrics are not persistent in production yet.** Upstash variables are empty locally and may not be set on Vercel, so `/metrics` numbers reset on every cold start until they are.
5. **Retrieval index is process-local.** On Vercel, the upload and a later teach turn can hit different instances. Grounding survives because the client re-sends the text, but citations can drop to "general knowledge" for a turn.
6. ~~**No page numbers in chunks.**~~ Fixed in Phase 3: PDF chunks carry page ranges and PPTX chunks slide numbers.
7. **Scanned PDFs are rejected.** There is no OCR.
8. **Concept plans are capped at 10.** A full exam syllabus needs a syllabus map above the lesson plan (Phase 3 #12).
9. **Quiz is multiple-choice only.** Descriptive answers with marking-scheme feedback are Phase 3 #13.
10. **Unreachable starter content.** The quote and starter pills in `chat-interface.tsx` no longer show, because the landing page starts the lesson. They are harmless and can be removed in a cleanup.
11. **No cost tracking.** Token usage is not recorded per turn, so "cost per lesson" (Phase 4 #14) needs the providers to report usage.

## 6. Decisions needed before later phases

| Decision | Why it matters | Default if you don't choose |
| --- | --- | --- |
| **Server-side storage for students and classes** | Teacher dashboard (#20), 7/30-day returns (#14) and cross-device mastery all need per-student records on a server. | Use Upstash Redis (free tier, already a dependency) keyed by an anonymous session ID. Revisit for a real database only if the B2B pilot needs it. |
| **Moderation provider** | #18 needs input/output moderation. | Use Gemini's built-in safety settings plus a small keyword/regex layer. No new paid service. |
| **Exam content** | Syllabus maps and misconception libraries need accurate, licensed content. | Ship placeholder files with structure and mark every value that you must source. |
| **Test runner** | Tests are required for Phase 2. | Decided: Vitest (dev dependency only). |
