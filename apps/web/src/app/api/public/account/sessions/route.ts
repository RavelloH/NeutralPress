import type { NextRequest } from "next/server";

import { getSessions } from "@/lib/server/services/session-domain";

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

/** Returns only sessions belonging to the ACCESS_TOKEN cookie's user. */
export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length > 0) return invalid();
  return getSessions({ environment: "serverless" });
}
