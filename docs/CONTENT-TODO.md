# Exam content: what you need to fill in

The app ships with placeholder exam files. Nothing in them is used to teach yet (Phase 3 wires them in), so wrong values cannot reach students today. Before Phase 3, fill in the items below.

Each file has a `status` field:

- `placeholder`: structure only; values are `null` or obviously fake.
- `draft`: filled in from memory or secondary sources; must be checked.
- `verified`: checked against the official document named in `source`. The tests refuse `verified` without `source.document` and `source.verifiedOn`.

Run `npm test` after every edit. The tests check the shape, that chapter weightages add up to 100 once all are filled, that question answers point at a real option, and that every question's `chapterId` exists in its syllabus.

## 1. NISM-Series-XV (Research Analyst): `data/exams/nism-xv.json`, status `placeholder`

This is the priority, since NISM is the niche.

| Field | What to put | Where to find it |
| --- | --- | --- |
| `source.document`, `source.version`, `source.url` | Workbook title and edition, and the page you took the exam details from | NISM website, Series XV page and workbook |
| `format.questions` | Number of questions | NISM test details for Series XV |
| `format.durationMinutes` | Exam length in minutes | same |
| `format.totalMarks` | Maximum marks | same |
| `format.passPercent` | Pass percentage | same |
| `format.negativeMarking` | The rule in words, e.g. "25% of marks for a wrong answer" | same |
| `chapters[].title` | Fix the 13 chapter titles to match the workbook exactly. I drafted them from memory: add, merge or rename as needed and keep the `id`s short, lowercase and hyphenated. | Workbook contents page |
| `chapters[].weightagePercent` | **Topic weightage** for each chapter. All chapters must add up to 100. | NISM's published weightage for the current workbook |
| `chapters[].topics` | 4–8 section headings per chapter | Workbook |
| `status`, `source.verifiedOn` | Set to `verified` and today's date (`YYYY-MM-DD`) when done | |

Then delete each chapter's `todo` line once that chapter is checked.

## 2. NISM-XV question bank: `data/exams/question-banks/nism-xv.json`, status `placeholder`

There are three placeholder questions showing the format. Replace them with real ones. Aim for at least 10 per chapter (about 130), weighted towards the chapters with the most marks.

For every question:

| Field | Notes |
| --- | --- |
| `id` | Unique, e.g. `nism-xv-valuation-001` |
| `chapterId` | Must match a chapter `id` in `nism-xv.json` |
| `concept` | Short label, e.g. "Price-to-earnings ratio". Mastery is tracked by this name. |
| `difficulty` | `easy`, `medium` or `hard` |
| `stem`, `options`, `answerIndex` | `answerIndex` is 0-based: 0 is the first option |
| `explanation` | Why the answer is right **and** why each wrong option is wrong |
| `marks`, `negativeMarks` | Match the exam format |
| `source.document`, `source.page` | Where the fact comes from. This becomes the page citation in Phase 3. |
| `misconceptionId` (optional) | If a wrong option targets a known misconception, its `id` from `data/misconceptions/*.json` |
| `status` | `draft` while writing, `verified` once checked |

Use only questions you wrote yourself or have the rights to. Do not copy NISM's own practice tests or any paid question bank.

## 3. CFA Level I: `data/exams/cfa-l1.json`, status `draft`

I filled in the 10 topic areas, the weight ranges and the format (180 questions, 270 minutes, no negative marking) from memory of the current curriculum. Check each against CFA Institute's Level I exam page for your exam window, fill `source`, and set `verified`. CFA publishes ranges, not exact weights, so leave `weightagePercent` null unless you want a single planning figure.

## 4. GATE CS: `data/exams/gate-cs.json`, status `draft`

I filled in the format (65 questions, 100 marks, 180 minutes, negative marking on MCQs only), General Aptitude = 15 marks and the CS subject list. Check them on the official GATE site for your exam year. GATE does not publish per-subject weightage. If you want it, add averages from the last 3–5 papers, which must total 85 across the non-aptitude subjects. Copy the file for other papers if needed.

## 5. Board exam: `data/exams/board.json`, status `placeholder`

Decide which board, class and subject to support first (for example CBSE Class 12 Physics), and rename the file and `exam` id to match (for example `cbse-12-physics`). Then fill in the units and marks per unit from the board's syllabus.

## Also useful (not blocking)

- **Misconception library** (`data/misconceptions/*.json`): 31 entries in 5 subjects are live now. Adding NISM-specific ones (for example about research analyst disclosure rules) would make exam mode sharper. Each new subject file must also be imported in `lib/learning/misconception-library.ts`; a test fails if you forget.
