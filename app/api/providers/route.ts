import { NextResponse } from "next/server";
import { getConfiguredProviders } from "@/lib/providers";
import type { ProvidersResponseBody } from "@/lib/types";

export const runtime = "nodejs";
// Key presence is read per request so adding a key only needs a dev-server
// restart, not a rebuild.
export const dynamic = "force-dynamic";

/**
 * Which providers have an API key on the server. The model picker greys out
 * the rest, so a student never selects a model that silently fails over to
 * someone else's.
 */
export async function GET() {
  return NextResponse.json<ProvidersResponseBody>({
    configured: getConfiguredProviders(),
  });
}
