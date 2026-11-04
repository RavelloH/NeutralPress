import type { NextRequest, NextResponse } from "next/server";

import { getCronConfig } from "@/lib/server/services/cron-domain";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Read-only ADMIN configuration; triggering Cron tasks remains a mutation Action. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length) {
    return Response.json(
      {
        success: false,
        message: "不接受查询参数",
        error: { code: "BAD_REQUEST" },
      },
      { status: 400, headers: PRIVATE_HEADERS },
    ) as NextResponse;
  }
  const result = await getCronConfig({}, { environment: "serverless" });
  for (const [key, value] of Object.entries(PRIVATE_HEADERS))
    result.headers.set(key, value);
  return result;
}
