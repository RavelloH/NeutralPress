import type { NextRequest, NextResponse } from "next/server";

import { listUserPasskeys } from "@/lib/server/services/passkey-read-domain";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

/** Only the caller's own passkey metadata; never return challenges or secrets. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length !== 0) {
    return Response.json(
      {
        success: false,
        message: "不接受查询参数",
        error: { code: "BAD_REQUEST" },
      },
      { status: 400, headers: PRIVATE_HEADERS },
    ) as NextResponse;
  }

  const result = await listUserPasskeys();
  const status = result.success
    ? 200
    : result.error?.code === "UNAUTHORIZED"
      ? 401
      : result.error?.code === "TOO_MANY_REQUESTS"
        ? 429
        : 500;
  return Response.json(result, {
    status,
    headers: PRIVATE_HEADERS,
  }) as NextResponse;
}
