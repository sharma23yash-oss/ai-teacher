// Kept free of zod so the browser bundle can import these without it.
export const FEEDBACK_RATINGS = ["yes", "partly", "no"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];
export const FEEDBACK_COMMENT_MAX_CHARS = 500;
