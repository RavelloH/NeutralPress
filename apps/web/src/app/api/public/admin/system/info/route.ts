import type { NextRequest, NextResponse } from "next/server";

import { getSystemInfo } from "@/lib/server/services/system-domain";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length) {
    return Response.json(
      {
        success: false,
        error: { code: "BAD_REQUEST" },
        message: "不接受查询参数",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    ) as NextResponse;
  }
  const response = await getSystemInfo({}, { environment: "serverless" });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Content-Security-Policy",
    PRIVATE_HEADERS["Content-Security-Policy"],
  );
  return response;
}
