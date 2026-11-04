import type { NextRequest, NextResponse } from "next/server";

import { getRuntimeVersionInfo } from "@/lib/server/services/auto-update-domain";

export const runtime = "nodejs";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Always requires existing ADMIN authorization, even during version polling. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length) {
    return Response.json(
      {
        success: false,
        message: "不接受查询参数",
        error: { code: "BAD_REQUEST" },
      },
      { status: 400, headers: HEADERS },
    ) as NextResponse;
  }
  const response = await getRuntimeVersionInfo(
    {},
    { environment: "serverless" },
  );
  for (const [key, value] of Object.entries(HEADERS))
    response.headers.set(key, value);
  return response;
}
