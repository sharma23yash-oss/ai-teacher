/**
 * Canonical site facts used by metadata, the social image, robots.txt and the
 * sitemap. The URL prefers an explicit NEXT_PUBLIC_SITE_URL, then Vercel's
 * production domain, then the current deployment URL.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;
  const deployment = process.env.VERCEL_URL;
  if (deployment) return `https://${deployment}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();
export const SITE_NAME = "AI Teacher";
export const SITE_TAGLINE = "Learn any topic in your language, through questions, not lectures";
export const SITE_DESCRIPTION =
  "A free Socratic AI tutor. Tell it what you want to learn and it asks you questions, draws diagrams, quizzes you and re-teaches what you missed, in English, Hinglish, Hindi and 16 more languages. Includes NISM, CFA and GATE exam prep from your own PDFs.";
