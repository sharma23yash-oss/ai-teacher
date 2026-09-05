import type { LessonPayload } from "./types";

// The Stage/Skill-Tree state before any real /api/teach response has come
// back — topic-neutral on purpose. The pedagogy engine decides the actual
// subject and concept_plan from the student's own first message; nothing
// here should bias that choice or leak into it. An empty concept_plan is
// load-bearing: buildResumeBlock (lib/pedagogy-engine.ts) treats it as "no
// lesson in progress yet" and omits the resume block entirely, so the first
// real turn starts genuinely fresh instead of being told to continue
// whatever topic happened to be sitting in this placeholder.
export const initialLessonPayload: LessonPayload = {
  teaching_phase: "introduction",
  student_profile: {
    understood_concepts: [],
    identified_misconceptions: [],
  },
  avatar_script: "",
  visual_director: {
    mode: "avatar",
    caption: "Ask a question to start your first lesson.",
  },
  concept_plan: [],
};
