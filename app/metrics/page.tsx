import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import {
  isPersistent,
  QUIZ_BUCKETS,
  readSnapshot,
  SESSION_BUCKETS,
  type MetricsSnapshot,
} from "@/lib/metrics/store";
import { EXAM_PRESET_META, LANGUAGE_META, MODEL_TIER_META } from "@/lib/types";

export const metadata: Metadata = {
  title: "Metrics",
  robots: { index: false, follow: false },
};

/**
 * Owner-only usage dashboard. Protected by METRICS_TOKEN: open it as
 * /metrics?key=<token>. With no token configured it is open on localhost and
 * closed in production, so it is never accidentally public.
 */
function isAuthorized(key: string | undefined): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await searchParams;
  if (!isAuthorized(typeof key === "string" ? key : undefined)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-6 text-slate-200">
        <h1 className="text-xl font-semibold">Metrics are private</h1>
        <p className="text-sm text-slate-300">
          Open this page as <code className="text-indigo-300">/metrics?key=YOUR_TOKEN</code>. Set{" "}
          <code className="text-indigo-300">METRICS_TOKEN</code> in your Vercel environment
          variables to choose the token.
        </p>
      </main>
    );
  }

  let snapshot: MetricsSnapshot | null = null;
  let loadError: string | null = null;
  try {
    snapshot = await readSnapshot(14);
  } catch (error) {
    console.error("/metrics: couldn't read snapshot:", error);
    loadError = "Couldn't reach the metrics store. Check the Upstash credentials and try again.";
  }

  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-10 text-slate-200 sm:px-6">
      <h1 className="text-2xl font-semibold text-white">AI Teacher — usage</h1>
      <p className="mt-1 text-sm text-slate-300">
        Anonymous, aggregate counts only. No user IDs, IP addresses or lesson content are stored.
      </p>

      {!isPersistent && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          Running without Upstash Redis, so these numbers live in memory and reset whenever the
          server restarts. Set <code>UPSTASH_REDIS_REST_URL</code> and{" "}
          <code>UPSTASH_REDIS_REST_TOKEN</code> to keep them.
        </p>
      )}

      {loadError && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {loadError}
        </p>
      )}

      {snapshot && <MetricsBody snapshot={snapshot} />}
    </main>
  );
}

function MetricsBody({ snapshot }: { snapshot: MetricsSnapshot }) {
  const c = snapshot.hashes.counters;
  const started = c.lessons_started ?? 0;
  const completed = c.lessons_completed ?? 0;
  const quizzes = c.quizzes ?? 0;
  const sessions = c.sessions ?? 0;
  const feedback = snapshot.hashes.feedback;
  const feedbackTotal = (feedback.yes ?? 0) + (feedback.partly ?? 0) + (feedback.no ?? 0);

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Lessons started", value: fmt(started) },
    {
      label: "Lessons completed",
      value: fmt(completed),
      note: started ? `${pct(completed, started)} completion rate` : undefined,
    },
    {
      label: "Average quiz score",
      value: quizzes ? `${Math.round((c.quiz_score_sum ?? 0) / quizzes)}%` : "—",
      note: `${fmt(quizzes)} quizzes taken`,
    },
    {
      label: "Average session",
      value: sessions ? minutes((c.session_seconds_sum ?? 0) / sessions) : "—",
      note: `${fmt(sessions)} sessions`,
    },
    {
      label: "Understood the lesson",
      value: feedbackTotal ? pct(feedback.yes ?? 0, feedbackTotal) : "—",
      note: `${fmt(feedbackTotal)} ratings`,
    },
    {
      label: "Lessons using a PDF",
      value: started ? pct(c.lessons_with_document ?? 0, started) : "—",
    },
  ];

  return (
    <>
      <section aria-label="Headline numbers" className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-300">{tile.label}</p>
            <p className="mt-1 text-3xl font-semibold text-white">{tile.value}</p>
            {tile.note && <p className="mt-1 text-xs text-slate-300">{tile.note}</p>}
          </div>
        ))}
      </section>

      <section aria-labelledby="daily-heading" className="mt-10">
        <h2 id="daily-heading" className="text-sm font-semibold text-white">
          Last 14 days
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-slate-300">
              <tr>
                <th scope="col" className="px-3 py-2">Date</th>
                <th scope="col" className="px-3 py-2 text-right">Started</th>
                <th scope="col" className="px-3 py-2 text-right">Completed</th>
                <th scope="col" className="px-3 py-2 text-right">Quizzes</th>
                <th scope="col" className="px-3 py-2 text-right">Sessions</th>
                <th scope="col" className="px-3 py-2 text-right">Ratings</th>
              </tr>
            </thead>
            <tbody>
              {[...snapshot.daily].reverse().map(({ date, values }) => (
                <tr key={date} className="border-t border-white/5">
                  <th scope="row" className="px-3 py-1.5 font-normal text-slate-300">{date}</th>
                  {["started", "completed", "quizzes", "sessions", "feedback"].map((field) => (
                    <td key={field} className="px-3 py-1.5 text-right tabular-nums">
                      {values[field] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <Breakdown
          title="Languages"
          data={snapshot.hashes.languages}
          labelFor={(k) => LANGUAGE_META[k as keyof typeof LANGUAGE_META]?.label ?? k}
        />
        <Breakdown title="Quiz scores" data={snapshot.hashes.quiz_buckets} order={QUIZ_BUCKETS} />
        <Breakdown
          title="Session length"
          data={snapshot.hashes.session_buckets}
          order={SESSION_BUCKETS}
        />
        <Breakdown
          title="Exam prep"
          data={snapshot.hashes.exams}
          labelFor={(k) =>
            k === "none" ? "Normal lesson" : (EXAM_PRESET_META[k as keyof typeof EXAM_PRESET_META]?.label ?? k)
          }
        />
        <Breakdown
          title="Model speed"
          data={snapshot.hashes.tiers}
          labelFor={(k) => MODEL_TIER_META[k as keyof typeof MODEL_TIER_META]?.label ?? k}
        />
        <Breakdown
          title="Did you understand this?"
          data={snapshot.hashes.feedback}
          order={["yes", "partly", "no"]}
          labelFor={(k) => ({ yes: "Yes", partly: "Partly", no: "Not really" })[k] ?? k}
        />
      </div>

      <section aria-labelledby="comments-heading" className="mt-10">
        <h2 id="comments-heading" className="text-sm font-semibold text-white">
          Recent feedback comments
        </h2>
        {snapshot.comments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-300">No comments yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {snapshot.comments.map((entry, i) => (
              <li key={i} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm">
                <span className="text-xs text-slate-300">
                  {entry.date} · {entry.rating}
                </span>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-100">{entry.comment}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Breakdown({
  title,
  data,
  order,
  labelFor = (k) => k,
}: {
  title: string;
  data: Record<string, number>;
  order?: readonly string[];
  labelFor?: (key: string) => string;
}) {
  const keys = order ?? Object.keys(data).sort((a, b) => (data[b] ?? 0) - (data[a] ?? 0));
  const total = keys.reduce((sum, k) => sum + (data[k] ?? 0), 0);
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {total === 0 ? (
        <p className="mt-2 text-sm text-slate-300">No data yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {keys.map((k) => {
            const value = data[k] ?? 0;
            const share = total ? (value / total) * 100 : 0;
            return (
              <li key={k} className="text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-200">{labelFor(k)}</span>
                  <span className="tabular-nums text-slate-300">
                    {value} · {Math.round(share)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-white/10" aria-hidden="true">
                  <div className="h-full rounded-full bg-indigo-400" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

function pct(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

function minutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.round(seconds / 60)} min`;
}
