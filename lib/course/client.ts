import type { CourseResponseBody } from "./schemas";

/** POST /api/course. Always resolves: network and server failures become { ok: false }. */
export async function postCourse(body: unknown): Promise<CourseResponseBody> {
  try {
    const response = await fetch("/api/course", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as CourseResponseBody | null;
    if (data) return data;
    return { ok: false, error: `The server answered ${response.status}. Please try again.` };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}
