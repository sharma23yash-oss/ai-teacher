import { NextResponse } from "next/server";
import { metricsEventSchema } from "@/lib/metrics/events";
import { recordEvent } from "@/lib/metrics/store";

export const runtime = "nodejs";

/**
 * Receives anonymous usage events from the app. proxy.ts already rejects
 * cross-origin callers and rate-limits this route. Nothing about the caller
 * (IP, headers, cookies) is read or stored here.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = metricsEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Unknown or malformed event." }, { status: 400 });
  }

  try {
    await recordEvent(parsed.data);
  } catch (error) {
    // Losing an analytics event is fine; failing the caller is not useful.
    console.warn("/api/metrics: couldn't record event:", error);
  }
  return new NextResponse(null, { status: 204 });
}
