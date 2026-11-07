# AI Teacher — roadmap

Goal: prove that students actually learn, in their own language, for a specific exam niche.
Status key: ✅ done · 🟡 partly exists · ⬜ not started. See [AUDIT.md](AUDIT.md) for how each piece works today.

## Phase 1 — Onboarding and landing ✅

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | One prompt box with defaults; settings in an Advanced drawer | ✅ | `components/onboarding/landing.tsx`, `components/stage/advanced-settings.tsx` |
| 2 | Fast / Balanced / Deep with provider + model tooltip | ✅ | `components/stage/model-selector.tsx` |
| 3 | Hero, How it works, three sample lessons, footer (privacy, free tier, feedback) | ✅ | `landing.tsx`, `components/site-footer.tsx`, `/privacy` |
| 4 | Title, description, Open Graph, Twitter, preview image, sitemap, robots | ✅ | `app/layout.tsx`, `app/opengraph-image.tsx`, `app/sitemap.ts`, `app/robots.ts` |

## Phase 2 — Learning engine ✅

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 5 | Mastery score (0–100), confidence, last practised, decay; shown in skill tree | ✅ | `lib/learning/mastery.ts`, `components/brain/skill-tree.tsx` |
| 6 | Hint ladder (nudge → hint → worked step → solution), factored into mastery | ✅ | `lib/learning/hint-ladder.ts`, Hint button in chat |
| 7 | Teach-back with gap and misconception detection | ✅ | `teachback` mode (`TEACHBACK_INSTRUCTION`), "Explain it back" button |
| 8 | Spaced repetition (SM-2), daily 10-minute revision, streak | ✅ | `lib/learning/spaced-repetition.ts`, revision panel on the landing page |
| 9 | Misconception library (JSON per subject) → diagnostic questions | ✅ | `data/misconceptions/`, `lib/learning/misconceptions.ts` |
| 10 | End-of-lesson summary card with shareable image | ✅ | `components/summary/` |

Mastery stays in the browser (decision for Phase 2); it moves to Upstash with an anonymous ID in Phase 4. Tests run with Vitest (`npm test`). Placeholder exam content and the list of what to fill in: `docs/CONTENT-TODO.md`.

## Phase 3 — Grounded content and exam niche ✅

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 11 | Upload-to-course: chapter summaries, Q&A, **page** citations, "not in your source" answers | ✅ | `lib/rag/blocks.ts` (pages), `lib/rag/outline.ts` (chapters), `app/api/course` (summary), Practice tab. The model cites passage numbers; the server maps them to pages, so it cannot invent one |
| 12 | Presets: NISM Series XV, CFA Level I, GATE, board exams, with syllabus maps and weightage | ✅ (content to verify) | `data/exams/*.json`, `lib/exams/syllabi.ts`, syllabus map on the landing page, "Practise by weightage". Values still need checking: see `docs/CONTENT-TODO.md` |
| 13 | Question generator with difficulty, explanations, marking-scheme feedback | ✅ | `app/api/course` (questions, grade), `components/practice/*`. Server clamps marks and recomputes totals |

## Phase 4 — Evidence and quality ⬜

| # | Item | Status | Builds on |
| --- | --- | --- | --- |
| 14 | Pre/post-test improvement, 7/30-day returns, cost per lesson, anonymous ID | 🟡 | Aggregate metrics exist; no ID, returns, pre/post or cost |
| 15 | Password-protected /metrics with charts and CSV | 🟡 | `/metrics` with token exists; no charts or CSV |
| 16 | "Did you understand?" rating + comment | ✅ | `components/brain/feedback-card.tsx` |
| 17 | Evaluation harness across all models; routing from results | ⬜ | |
| 18 | Input/output moderation, refusals, age-appropriate language | 🟡 | Canary + output sanitiser; no moderation |

## Phase 5 — India-specific and B2B ⬜

| # | Item | Status | Builds on |
| --- | --- | --- | --- |
| 19 | Voice in/out, Hinglish code-switching, low-bandwidth mode | 🟡 | Voice and Hinglish exist; low-bandwidth mode does not |
| 20 | Teacher/institute dashboard: class code, progress, weak topics, assignments, export | ⬜ | Needs server-side storage (decision pending) |
| 21 | WhatsApp design doc (`docs/WHATSAPP.md`), no implementation until approved | ⬜ | |

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Metrics not persistent until Upstash is configured on Vercel | Numbers reset; can't report evidence | Set the Upstash variables before collecting data |
| Exam syllabus and misconception content must be accurate and licensed | Wrong content damages trust with judges and students | Placeholders clearly marked; you supply or verify the content |
| Free-tier provider limits | Slow or failed turns at busy times | Three-provider failover; low-bandwidth mode in Phase 5 |
| No server-side student records | Blocks teacher dashboard and return metrics | Decide storage before Phase 4/5 (default: Upstash + anonymous ID) |
| Process-local document index on Vercel | Citations can drop for a turn; a chapter summary can hit an instance that never saw the upload and asks the student to upload again | Move the index to shared storage (Upstash) alongside Phase 4 |
