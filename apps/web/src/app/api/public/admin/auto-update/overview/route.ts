import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import { getAutoUpdateOverview } from "@/lib/server/services/auto-update-domain";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

/** The overview may contain repo PAT and Watchtower config: never GET or cache. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await parseSameOriginJson(request, 1024);
  if (!body.ok) return body.response;
  if (!z.object({}).strict().safeParse(body.input).success) {
    return Response.json(
      {
        success: false,
        message: "不接受查询参数",
        error: { code: "BAD_REQUEST" },
      },
      { status: 400, headers: HEADERS },
    ) as NextResponse;
  }
  const response = await getAutoUpdateOverview(
    {},
    { environment: "serverless" },
  );
  for (const [key, value] of Object.entries(HEADERS))
    response.headers.set(key, value);
  return response;
}
