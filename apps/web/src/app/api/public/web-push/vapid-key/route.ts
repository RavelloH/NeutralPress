import type { NextRequest, NextResponse } from "next/server";

import { getVapidPublicKey } from "@/lib/server/services/web-push-domain";

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** Public cryptographic key only. VAPID private keys never leave the server. */
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
  const response = await getVapidPublicKey({ environment: "serverless" });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
