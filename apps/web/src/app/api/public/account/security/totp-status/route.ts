import type { NextRequest } from "next/server";

import { getTotpStatus } from "@/lib/server/services/totp-status-domain";

function invalid() {
  return Response.json(
    {
      success: false,
      message: "不接受查询参数",
      error: { code: "BAD_REQUEST" },
    },
    {
      status: 400,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/** Returns the current cookie user's TOTP status; secrets and backup codes are never returned. */
export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) return invalid();
  return getTotpStatus({ environment: "serverless" });
}
