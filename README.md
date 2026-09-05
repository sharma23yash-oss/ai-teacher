# AI Teacher

**A human-like AI educator that plans a lesson, teaches it aloud through an animated presenter, questions the learner, notices when they have misunderstood, and adapts — in 19 languages, grounded in the learner's own material.**

Built for the AI Innovation Hackathon 2026 Round 2 Technical Assessment — *AI Teacher: Build a Human-Like AI Educator That Teaches Through Video*.

---

## 1. Problem statement

Digital learning platforms give students one of two things: a pre-recorded lecture that cannot tell whether anyone understood it, or a chat assistant that answers whatever is asked and never checks anything. Neither behaves like a teacher.

A real teacher does something structurally different. They work out what the learner already knows, decide what to cover and in what order, explain a concept, ask a question designed to expose a specific misunderstanding, read the answer, and then *change what they do next* based on it. The loop — and specifically the willingness to go backwards when the answer is wrong — is the thing that makes teaching work.

This project builds that loop.

## 2. Solution overview

AI Teacher takes a topic or an uploaded document and runs a strict pedagogical state machine over it:

```
Understand → Plan → Explain → Demonstrate → Question → Evaluate → Adapt → Continue
```

Every model turn returns a structured lesson state, not prose: the teaching phase, the concept plan with per-concept mastery status, the spoken script, and a direction for what should be on screen. The interface renders that state, and the next turn resumes from it.

Concretely, the difference from a chatbot shows up like this:

> **Teacher:** "If you increase the pressure, what happens to the force of the water coming out?"
> **Student:** "The force decreases."
> **Teacher:** *(phase → scaffolding, concept → misconception)* "Ah, let us pause for a second. Think of a garden hose. When you turn the tap up high, the pressure increases. Does the water come shooting out much faster, or does it slow down to a trickle?"

It did not supply the answer, and it did not repeat itself — it identified the gap and came at it from a different angle, exactly as section 5 of the brief requires.

## 3. Key features

| Area | What it does |
| --- | --- |
| **Socratic teaching loop** | Plans 3–10 micro-concepts (scaled to the time budget), teaches one at a time, ends each explanation with an application question, and only advances on demonstrated understanding. |
| **Misconception handling** | A wrong answer demotes the concept to `misconception`, flips the phase to `scaffolding`, and forces a re-explanation with a different analogy — never the answer. |
| **Retrieval-grounded learning** | Uploaded PDFs, Word, PowerPoint and text are chunked, embedded and retrieved per turn. Answers about the document come from the document, with the passages shown to the student. |
| **Teaching video generation** | Any turn renders as a narrated video: animated presenter lip-synced to neural TTS, on-screen code or diagram, timed captions, syllabus card — downloadable as a file. |
| **19 languages** | 11 Indian, 8 international, each with its own native-script neural voice. Switchable mid-lesson without losing the lesson. |
| **Live video call** | Webcam teaching with on-device gesture recognition — a thumbs-down re-explains, a head shake triggers a diagnostic question. |
| **Reverse Socratic (Feynman) mode** | The AI plays a student holding a plausible misconception and the human teaches *it*, which is a far harder test of understanding than answering a quiz. |
| **Assessment that changes the lesson** | Quiz results write back into lesson state: missed concepts are demoted and immediately re-taught. |
| **Persistent learner profile** | Topics, scores, strong and weak concepts and history persist across sessions and are fed back into the prompt. |
| **Multi-provider failover** | Nine models across three providers behind one interface; a failed turn silently resumes on another provider with the lesson intact. |

## 4. System architecture

```
┌──────────────────────────── BROWSER ────────────────────────────┐
│                                                                 │
│   THE STAGE                       THE SOCRATIC BRAIN            │
│   ├── Avatar (SVG + lip-sync)     ├── Concept skill tree        │
│   ├── Code / Diagram renderers    ├── Grounding trace           │
│   ├── Quiz + report card          ├── Chat + speech input       │
│   ├── Lesson video (canvas)       └── Progress panel            │
│   └── Live video call + gestures                                │
│                                                                 │
│   dashboard.tsx — one lesson state, one turn pipeline           │
└────────┬───────────────┬──────────────┬─────────────────────────┘
         │               │              │
    /api/teach      /api/upload     /api/tts
         │               │              │
         │               │              └── msedge-tts → neural voice (mp3)
         │               │
         │               └── extract (pdf/docx/pptx/text)
         │                      → chunk → embed → vector store
         │
         └── pedagogy-engine (system prompt + turn assembly)
                    │
                    ├── retrieval: top-k passages for this turn
                    ├── lesson state replay (failover-safe resume)
                    ├── learner profile briefing
                    │
                    └── provider failover
                          ├── Gemini  (schema-enforced, vision)
                          ├── Groq    (schema / loose JSON + repair)
                          └── Cohere  (schema-enforced)
```

The single most important design decision is that **every turn carries the whole lesson state**. The transcript alone does not say which concept is current or which were mastered, so a provider taking over mid-lesson would re-plan the topic and visibly reset the student's progress. Replaying the state (`lib/pedagogy-engine.ts` → `buildResumeBlock`) is what makes failover invisible.

## 5. AI/ML models used

| Provider | Models | Role |
| --- | --- | --- |
| **Google Gemini** | `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro-preview` | Primary teaching engine. Server-side JSON-schema enforcement; the only provider that reads webcam frames. |
| **Groq** | `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` | Low-latency failover. Schema-enforced on GPT-OSS/Qwen. |
| **Cohere** | `command-a-03-2025`, `command-r-plus-08-2024`, `command-r-08-2024` | Third-tier failover, schema-enforced. |
| **Google embeddings** | `gemini-embedding-001` (falls back to `text-embedding-004`) | Passage and query vectors for retrieval. |
| **Microsoft Edge Neural TTS** | 38 voices across 19 languages | Narration for the live tutor and the generated video. |
| **MediaPipe Tasks Vision** | Hand landmarker + face landmarker | On-device gesture recognition during video calls. |

Model identifiers are resolved at runtime where the API allows it — the embedding client probes a list of candidates and caches the first that answers, so a provider renaming an endpoint degrades retrieval to lexical rather than breaking it.

## 6. RAG implementation

`lib/rag/`

**Extraction** (`extract.ts`) — PDF via `pdf-parse`; `.docx` and `.pptx` via a purpose-built ZIP reader (`zip.ts`) that uses the platform's own `DecompressionStream`, so Office formats are supported with no additional dependency. Extraction preserves structure: Word heading styles and PowerPoint slide titles become the headings a citation can name.

**Chunking** (`store.ts` → `chunkBlocks`) — ~900-character passages packed on block boundaries, with a heading change treated as a hard seam so one passage never carries two different headings' worth of context. Oversized blocks split on sentence boundaries with 150-character overlap, so a fact straddling a seam still appears whole in one chunk.

**Indexing** — each chunk is embedded *with its heading prepended* (`"41 degrees"` means little; `"Key Numbers — 41 degrees"` means a lot). Vectors live in a process-global store keyed by `docId`.

**Retrieval** — hybrid, per turn:

```
score = 0.65 · cosine(query, chunk) + 0.35 · normalised BM25
```

Both halves earn their place. Dense vectors handle *"explain the bit about energy transfer"* where the student's words never appear in the document; BM25 handles *"what does it say about zorvane"*, where one rare exact term matters more than semantic neighbourhood. The query is the student's message **plus the concept currently being taught**, so a bare *"why does that happen?"* still retrieves the right passage.

**Grounding contract** — the system prompt states that retrieved passages are the only authority on the document, that figures must be quoted exactly and never "corrected" toward what the model believes is true of the real world, and that anything the passages do not cover must be declined out loud.

**Verified behaviour.** A document stating *3 luminal ATP, 41 °C, 12 minutes* was uploaded, and the figures asked for on a later turn:

| | Before this implementation | After |
| --- | --- | --- |
| ATP yield | "two" ❌ | **"exactly three"** ✅ |
| Optimal temperature | "thirty degrees" ❌ | **"forty one degrees Celsius"** ✅ |
| Cycle duration | "three minutes" ❌ | **"twelve minutes"** ✅ |
| Asked about content not in the document | Invented enzyme kinetics ❌ | **"Your notes do not cover that topic."** ✅ |

**Graceful degradation.** If embeddings are unavailable the index falls back to lexical-only. If the index itself is lost (a server restart), the client notices that the last turn was ungrounded and re-sends the extracted text, which re-establishes grounding rather than letting the tutor quietly start improvising.

## 7. Prompt / agent architecture

`lib/pedagogy-engine.ts`

The system instruction is composed per turn from layers that never interfere with each other:

1. **Base state machine** — the core loop, the intent classifier (greeting vs. topic), and the JSON output contract.
2. **Grounding rules** — the document contract above; overrides everything below it.
3. **Persona overlay** — voice and tone only; the teaching loop and schema are untouched.
4. **Language constraint** — names the exact script to write in, because a neural voice is trained on a script, not a language name.
5. **Learner level** — beginner / intermediate / advanced, written as instructions rather than a label.
6. **Time budget** — sets both depth and the required number of concepts.
7. **Vision instruction** — appended only on turns that actually carry a webcam frame.
8. **Schema block** — appended only for providers that do not enforce the schema server-side.

The user turn is assembled outermost-first: learner profile briefing → lesson state replay → retrieved passages → the student's message. Retrieval is a *prefix on every turn*, not a branch of the action switch — an earlier version attached uploaded material only to ordinary messages, which silently meant quiz generation and gesture turns lost the document.

**Response schema** (enforced server-side where possible, repaired against `lib/providers/lesson-schema.ts` where not):

```jsonc
{
  "teaching_phase": "introduction | explanation | assessment | scaffolding",
  "student_profile": { "understood_concepts": [], "identified_misconceptions": [] },
  "avatar_script": "…spoken verbatim by the TTS voice…",
  "visual_director": { "mode": "avatar|code|diagram|concept_flow|quiz", "…": "…" },
  "concept_plan": [{ "id": "c1", "label": "…", "status": "current" }]
}
```

`avatar_script` is written for the ear, not the page: 8–14 word sentences, commas placed where a teacher would breathe, no markdown or digits (the voice reads "asterisk" and mispronounces "32").

## 8. Personalization approach

| Dimension | Control | Effect |
| --- | --- | --- |
| Level | Beginner / Intermediate / Advanced | Vocabulary, whether prerequisites are assumed, whether mathematics appears, and whether questions test recall or analysis. |
| Time | 5-min / 20-min / 60-min / full mastery / 7-day plan | Sets depth *and* concept count — a 7-day plan produces exactly seven day-labelled concepts. |
| Language | 19 options | Teaching language and voice; switchable mid-lesson with context intact. |
| Teaching style | 4 personas | Tone and delivery, each paired with matching voice prosody. |
| History | Automatic | Prior weak concepts are flagged to the engine; mastered ones are not re-taught. |

The learner profile (`lib/learner-profile.ts`) persists to `localStorage` — there are no accounts, so there is no server-side identity to key a row on, and a study history is the kind of thing that should stay on the learner's own machine by default. On a return visit their settings are restored and a briefing is prepended to the prompt:

> RETURNING STUDENT — This student has studied "Ohm's Law" before (2 sessions). They have previously struggled with: The Formula V = I x R. Check these before assuming them.

## 9. Assessment methodology

Assessment runs at two scales.

**In-lesson**, every explanation ends in what the prompt calls a Misconception Trap — an application question, not a recall check, designed so that a specific wrong model of the concept produces a specific wrong answer. The reply drives the concept's status directly.

**End-of-lesson**, the quiz generates 4–6 MCQs tagged with the `concept_id` they test, which is what makes per-concept scoring possible. The report card gives score, mastered concepts, weak areas and a recommendation.

The part that matters most is what happens next. Results are written back into lesson state: missed concepts drop from `completed` to `misconception`, the engine is told about them in `student_profile`, and the first weak concept is re-taught immediately from a different angle. A score the student reads and dismisses would change nothing.

## 10. Multilingual implementation

Nineteen teaching languages, defined once in `LANGUAGE_META` (`lib/types.ts`) so the picker label, the script the model is told to write in, the two neural voices, and the speech-recognition locale can never drift apart.

**Indian** — English, Hinglish, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Urdu
**International** — Spanish, French, German, Portuguese, Arabic, Russian, Japanese, Mandarin

Two details do the real work:

**Script, not language name.** A voice is trained on a script. `hi-IN-MadhurNeural` reads Devanagari beautifully and mangles romanised Hindi; `en-IN-PrabhatNeural` does the exact opposite. So Hindi and Hinglish are separate entries pointing at different voices, and the prompt names the script explicitly.

**A deliberate TTS/ASR asymmetry.** Speaking Hinglish uses an `en-IN` voice reading phonetic Roman text. *Listening* to Hinglish uses `hi-IN` — an `en-IN` recogniser has an English lexicon and physically cannot emit a Hindi word, so it force-fits every one to the nearest English token. `hi-IN` is trained on the code-mixed speech Indians actually produce.

Language can be switched mid-lesson; the concept plan and progress carry over untouched.

## 11. Voice implementation

`app/api/tts/route.ts`, `lib/tts-voices.ts`, `lib/audio-engine.ts`

Microsoft Edge neural voices via `msedge-tts` — no API key, 38 voices, natural Indian-language prosody. Per-persona prosody profiles (rate held in a −5% to −10% clarity band, pitch carrying the character), SSML-safe sanitisation of the script, and a two-stage fallback: the language's own voice, then an `en-IN` voice, then the browser's built-in speech synthesis. A lesson that degrades is acceptable; a silent one is not.

Lip-sync is genuine, not a loop. An `AnalyserNode` taps the playing audio and drives mouth openness from live amplitude, with asymmetric timing — opens fast, closes slowly — because a jaw does, and because raw RMS makes the mouth flicker shut between syllables.

## 12. Avatar and video generation approach

`lib/video/lesson-video.ts`, `components/stage/video-stage.tsx`

The lesson video is composed from the turn itself — script, visual direction, and concept plan — and rendered to a canvas frame by frame:

- **Title card** with topic, language and level
- **Main scene** — animated presenter (lip-synced, blinking, breathing) beside the turn's actual code panel with the active line highlighted, or its diagram with node states and edge labels, or the lesson plan
- **Captions** cut to sentence boundaries and timed against the narration's real measured duration
- **Outro** with concepts mastered and what comes next

Canvas rather than DOM is the load-bearing choice: a canvas exposes `captureStream()`, so the frames the student watched are literally the frames written to the file. The narration is routed through a `MediaStreamAudioDestinationNode` and joins the same `MediaRecorder`, which is why the download has synchronised sound. Preview and export run the same painter, so there is no second render path that could drift.

Output: **WebM (VP9 + Opus), 1280×720, 30 fps**, downloadable. A verified export of a Python `for` loop lesson: 38 seconds, 8 captions, 8.6 MB.

## 13. APIs and third-party services

| Service / library | Use | Key required |
| --- | --- | --- |
| Google Gemini API (`@google/genai`) | Teaching engine, vision, embeddings | `GEMINI_API_KEY` |
| Groq API (`groq-sdk`) | Failover teaching engine | `GROQ_API_KEY` |
| Cohere API (`cohere-ai`) | Failover teaching engine | `COHERE_API_KEY` |
| Microsoft Edge TTS (`msedge-tts`) | Neural narration | No |
| MediaPipe Tasks Vision | Gesture recognition (on-device) | No |
| `pdf-parse` | PDF text extraction | No |
| Next.js 16, React 19, Tailwind 4, three.js, lucide-react | Application framework and UI | No |
| Web Speech API | Voice input | No |

DOCX and PPTX parsing, chunking, embedding storage, hybrid retrieval, and video rendering are implemented in this repository with no additional dependencies.

## 14. Setup instructions

**Requirements:** Node.js 20+, and at least one of the three API keys.

```bash
git clone https://github.com/sharma23yash-oss/ai-teacher.git
cd ai-teacher
npm install

cp .env.local.example .env.local
#   GEMINI_API_KEY=…   https://aistudio.google.com/apikey
#   GROQ_API_KEY=…     https://console.groq.com/keys
#   COHERE_API_KEY=…   https://dashboard.cohere.com/api-keys

npm run dev            # http://localhost:3000
```

Gemini is the one to set first: it is the only provider that reads webcam frames, and the only one that serves embeddings. With all three set, a lesson never stalls on a rate limit.

Optional: `NEXT_PUBLIC_SHOWCASE_MODE=1` enables the creator-story content and sponsor placement (off by default — see `lib/build-flags.ts`).

**Try it in this order:** ask for a topic → answer the first question *wrong* on purpose → watch the phase flip to scaffolding → open the **Video** tab and generate → **Take Quiz** → check the **Progress** tab.

## 15. Deployment

Deploys to Vercel as a standard Next.js app. Set `GEMINI_API_KEY`, `GROQ_API_KEY` and `COHERE_API_KEY` as environment variables; no other configuration is needed. `/api/upload`, `/api/teach` and `/api/tts` all run on the Node.js runtime (`pdf-parse` and `msedge-tts` need Node APIs, not Edge).

One caveat worth planning for: the retrieval index is process-local. On a single instance that is correct and free; on a horizontally scaled deployment an uploaded document would only be found by the instance that indexed it. Moving `lib/rag/store.ts` behind Redis or a hosted vector database is a contained change — the interface (`indexDocument`, `retrieve`, `leadingContext`) is already the seam.

## 16. Known limitations

- **Retrieval index is in-memory and process-local.** Documents are dropped on restart. The client re-sends extracted text when it detects an ungrounded turn, which recovers grounding, but a horizontally scaled deployment needs a shared store.
- **Scanned PDFs are not read.** Text extraction only; there is no OCR, so an image-only PDF is rejected with a message saying so.
- **Legacy `.doc` and `.ppt` are unsupported** — the pre-2007 binary formats are not ZIP archives. Save as `.docx` / `.pptx`.
- **Video export is real-time.** Recording a 38-second lesson takes 38 seconds, because `MediaRecorder` captures a live stream. Output is WebM; Safari support for the codec is limited, so export is best in Chrome or Edge.
- **Caption timing is proportional, not forced-aligned.** Captions are distributed across the narration by character count. The last caption always ends exactly with the audio, but a mid-clip caption can drift by a fraction of a second.
- **The presenter is a stylised drawn avatar**, not a photorealistic one.
- **Only Gemini reads webcam frames.** On a Groq or Cohere turn the frame is dropped and the gesture is passed as text instead.
- **The learner profile is per-browser.** No accounts, so it does not follow a student across devices.
- **Concept plans are capped at 10.** A genuinely large syllabus would need nested plans.
- **Quiz questions are multiple-choice only.** Free-text answers are evaluated conversationally in the lesson, but not in the formal quiz.

---

## Repository map

```
app/api/teach     Teaching turn: validation → retrieval → prompt → failover
app/api/upload    Extract → chunk → embed → index
app/api/tts       Neural narration with voice fallback
app/api/refine    Prompt refinement helper

lib/pedagogy-engine.ts   System prompts, grounding contract, turn assembly
lib/providers/           Gemini / Groq / Cohere adapters + failover
lib/rag/                 zip · extract · embeddings · store (chunk + hybrid retrieval)
lib/video/               Storyboard, canvas painter, recorder
lib/learner-profile.ts   Persistent profile + prompt briefing
lib/tts-voices.ts        Voice resolution per language and persona
lib/types.ts             Lesson schema, language table, level and budget definitions

components/stage/        Avatar, code, diagram, quiz, video, video call
components/brain/        Skill tree, chat, grounding trace, progress
```
