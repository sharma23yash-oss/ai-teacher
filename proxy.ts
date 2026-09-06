import { NextResponse, type NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Runs on every /api/* request, on Vercel's Edge runtime (same code path in
 * dev and in production — no hardcoded domain, so it works on localhost, on
 * every Vercel preview URL, and on the final production domain unchanged).
 *
 * Two independent guards live here: a hotlink/scraper check that costs
 * nothing on the happy path, and a per-IP rate limiter for the routes that
 * actually call out to paid APIs (Gemini/Groq/Cohere, Edge TTS). The origin
 * check is a lightweight header comparison, not a hard security boundary —
 * see hasAllowedOrigin() below. The rate limiter is backed by Upstash Redis
 * when configured (persists across cold starts and every Vercel region) and
 * degrades to a per-instance in-memory window otherwise, so the app still
 * has *some* abuse protection with zero external setup.
 */

export const config = {
  matcher: ["/api/:path*"],
};

// ---------------------------------------------------------------------------
// Origin / Referer verification
// ---------------------------------------------------------------------------

/**
 * A request is accepted only when its Origin (preferred) or, failing that,
 * its Referer names the exact host this request itself arrived on. That
 * self-referential comparison — never a hardcoded domain — is what makes this
 * work identically on localhost:3000 in dev and on whatever host Vercel
 * assigns in production or preview deployments.
 *
 * Same-origin browser fetches reliably send at least one of these headers:
 * modern browsers attach Origin to every non-GET request (same-origin or
 * not), and attach Referer to same-origin GET requests under the default
 * "strict-origin-when-cross-origin" policy. A request with neither header —
 * curl, a Python scraper, a server hitting this URL directly, an <img>/<audio>
 * hotlink from another site — is rejected. This deliberately will not stop a
 * determined attacker who fabricates a matching header, which no header check
 * alone can prevent; it stops the casual/automated cases these routes are
 * actually exposed to.
 */
/**
 * Strips a leading scheme and a trailing port so two host-ish strings can be
 * compared on hostname alone — e.g. "https://my-app.vercel.app:443" and
 * "my-app.vercel.app" are the same origin as far as this check is concerned.
 */
function normalizeHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/:\d+$/, "")
    .replace(/\/+$/, "");
}

/**
 * Vercel's edge network terminates the original request and forwards it
 * internally, so `x-forwarded-host` — not `host` — carries the hostname the
 * browser actually connected to (its own preview/production *.vercel.app
 * domain included). Falling back to `host` keeps this working anywhere that
 * header isn't set, e.g. plain `next dev` on localhost.
 */
function requestHost(request: NextRequest): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host");
  return host ? normalizeHost(host) : null;
}

function hasAllowedOrigin(request: NextRequest): boolean {
  const host = requestHost(request);
  if (!host) return false;

  const candidate = request.headers.get("origin") ?? request.headers.get("referer");
  if (!candidate) return false;

  try {
    return normalizeHost(new URL(candidate).host) === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
// One source of truth for the per-route budgets, shared by both the Redis
// path and the in-memory fallback below so the numbers never drift apart.

const WINDOW_SECONDS = 60;
const ROUTE_LIMITS: ReadonlyArray<readonly [prefix: string, limit: number]> = [
  ["/api/tts", 30],
  ["/api/teach", 20],
  ["/api/refine", 20],
  ["/api/upload", 10],
];
const DEFAULT_LIMIT = 60;
const DEFAULT_BUCKET = "default";

function bucketFor(pathname: string): string {
  return ROUTE_LIMITS.find(([prefix]) => pathname.startsWith(prefix))?.[0] ?? DEFAULT_BUCKET;
}

function limitFor(bucket: string): number {
  return ROUTE_LIMITS.find(([prefix]) => prefix === bucket)?.[1] ?? DEFAULT_LIMIT;
}

function clientIp(request: NextRequest): string {
  // Vercel (and most reverse proxies) set x-forwarded-for; the first entry is
  // the original client. x-real-ip is a fallback for other proxy setups.
  // Neither header is attacker-proof outside a trusted proxy, but this app
  // already trusts Vercel's edge network for this, same as it trusts
  // Host/Origin above.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

// --- Upstash Redis (persistent, cross-region) -------------------------------

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = UPSTASH_URL && UPSTASH_TOKEN ? new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN }) : null;

// One Ratelimit instance per route bucket, all sharing the same Redis
// connection — built once per Edge isolate, not per request.
const redisLimiters: Map<string, Ratelimit> | null = redis
  ? new Map(
      [...ROUTE_LIMITS.map(([prefix]) => prefix), DEFAULT_BUCKET].map((bucket) => [
        bucket,
        new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(limitFor(bucket), `${WINDOW_SECONDS} s`),
          prefix: `ratelimit:${bucket}`,
          analytics: false,
        }),
      ]),
    )
  : null;

// --- In-memory fallback (no Redis configured, or Redis unreachable) --------
// Module-level state on the Edge runtime's isolate: resets on a cold start
// and is not shared across regions/instances. This is only ever the active
// path when UPSTASH_REDIS_REST_URL/TOKEN are unset, or as a one-request
// degrade if Upstash itself is briefly unreachable — never the primary
// defense once Redis is configured.
const memoryHits = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 5000;

function isRateLimitedInMemory(ip: string, bucket: string): boolean {
  const limit = limitFor(bucket);
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  const recent = (memoryHits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (recent.length >= limit) {
    memoryHits.set(key, recent);
    return true;
  }

  recent.push(now);
  memoryHits.set(key, recent);

  if (memoryHits.size > MAX_TRACKED_KEYS) {
    for (const [trackedKey, timestamps] of memoryHits) {
      if (timestamps.every((timestamp) => timestamp <= windowStart)) {
        memoryHits.delete(trackedKey);
      }
    }
  }

  return false;
}

async function isRateLimited(request: NextRequest): Promise<boolean> {
  const pathname = request.nextUrl.pathname;
  const ip = clientIp(request);
  const bucket = bucketFor(pathname);

  if (redisLimiters) {
    const limiter = redisLimiters.get(bucket);
    if (limiter) {
      try {
        const { success } = await limiter.limit(ip);
        return !success;
      } catch (error) {
        // Upstash unreachable for this request — degrade to the in-memory
        // window rather than either blocking every request outright or
        // waving all of them through unlimited.
        console.warn("Upstash rate limit check failed, falling back to in-memory:", error);
      }
    }
  }

  return isRateLimitedInMemory(ip, bucket);
}

// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  if (!hasAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden — this endpoint only accepts requests from this application." },
      { status: 403 },
    );
  }

  if (await isRateLimited(request)) {
    return NextResponse.json(
      { error: "Too many requests — please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(WINDOW_SECONDS) } },
    );
  }

  return NextResponse.next();
}
