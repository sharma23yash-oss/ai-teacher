/**
 * Build-time switches for things that belong in a personal build but not in
 * a graded or public one.
 *
 * `SHOWCASE_MODE` turns on the creator-story material: the "meet the maker"
 * conversation starters, the founder narrative the teaching prompt can tell,
 * and the sponsor card on the Stage. All of it is genuinely part of the
 * project's story, and none of it belongs in front of a jury evaluating a
 * teaching product — so it is off by default and opt-in per environment
 * rather than deleted.
 *
 * Turn it on with `NEXT_PUBLIC_SHOWCASE_MODE=1` in `.env.local`.
 */
export const SHOWCASE_MODE = process.env.NEXT_PUBLIC_SHOWCASE_MODE === "1";
