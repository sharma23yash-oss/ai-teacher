import type { MetricsEvent } from "./events";

/**
 * Fire-and-forget event reporting. `keepalive` lets the request finish while
 * the tab is closing, which is when session_end is sent. Failures are ignored:
 * analytics must never get in the way of a lesson.
 */
export function track(event: MetricsEvent): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore: some browsers throw synchronously on keepalive during unload.
  }
}
