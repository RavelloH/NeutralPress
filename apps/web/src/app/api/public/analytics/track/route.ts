import { TrackPageViewSchema } from "@repo/shared-types/api/analytics";
import type { NextRequest } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import { trackPageView } from "@/lib/server/services/analytics-domain";

export const runtime = "nodejs";

/** Anonymous, rate-limited and Redis-deduplicated event ingestion. */
export async function POST(request: NextRequest) {
  const parsedBody = await parseSameOriginJson(request, 4096);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = TrackPageViewSchema.strict().safeParse(parsedBody.input);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: { code: "BAD_REQUEST" } },
      {
        status: 400,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  const response = await trackPageView(parsed.data, {
    environment: "serverless",
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
