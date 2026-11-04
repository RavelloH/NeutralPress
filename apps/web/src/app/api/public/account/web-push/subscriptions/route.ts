import type { NextRequest, NextResponse } from "next/server";

import { getUserPushSubscriptions } from "@/lib/server/services/web-push-domain";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

/** Endpoints are private to the authenticated user's Cookie-bound identity. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length !== 0) {
    return Response.json(
      {
        success: false,
        message: "不接受查询参数",
        error: { code: "BAD_REQUEST" },
      },
      { status: 400, headers: HEADERS },
    ) as NextResponse;
  }
  const response = await getUserPushSubscriptions({
    environment: "serverless",
  });
  for (const [key, value] of Object.entries(HEADERS))
    response.headers.set(key, value);
  return response;
}
