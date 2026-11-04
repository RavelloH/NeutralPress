import type { NextRequest } from "next/server";

import { drainCdnCacheQueue } from "@/lib/server/cdn-cache-pipeline";
import { validateInternalBearerToken } from "@/lib/server/internal-auth";
import limitControl from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(await limitControl(request.headers, "internal.cache.cdn.drain"))) {
    return Response.json(
      { success: false, error: "RATE_LIMITED" },
      { status: 429, headers },
    );
  }

  const auth = validateInternalBearerToken(
    request.headers.get("authorization"),
  );
  if (!auth.ok) {
    return Response.json(
      { success: false, error: "UNAUTHORIZED" },
      {
        status: auth.reason === "MASTER_SECRET_UNAVAILABLE" ? 503 : 401,
        headers,
      },
    );
  }

  try {
    const result = await drainCdnCacheQueue();
    return Response.json({ success: true, ...result }, { headers });
  } catch (error) {
    console.error("[CDN cache] Queue drain failed:", error);
    return Response.json(
      { success: false, error: "DRAIN_FAILED" },
      { status: 503, headers },
    );
  }
}
