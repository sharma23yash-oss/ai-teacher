import { emptyLearningState, isLearningState, type LearningState } from "./state";

/**
 * Browser persistence for the learning state. Phase 2 keeps it on the device
 * only (no server copy). Every access is wrapped: private windows and blocked
 * storage must never break a lesson.
 */
const STORAGE_KEY = "ai-teacher.learning.v1";

export function loadLearningState(): LearningState {
  if (typeof window === "undefined") return emptyLearningState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyLearningState();
    const parsed: unknown = JSON.parse(raw);
    return isLearningState(parsed) ? parsed : emptyLearningState();
  } catch {
    return emptyLearningState();
  }
}

export function saveLearningState(state: LearningState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: keep going with the in-memory copy.
  }
}

export function clearLearningState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
