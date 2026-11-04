import type { NextRequest } from "next/server";

import { getCurrentUserForReauth } from "@/lib/server/services/reauth-profile-domain";

export const runtime = "nodejs";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

export async function GET(request: NextRequest) {
  if ([...request.nextUrl.searchParams.keys()].length) {
    return Response.json(
      {
        success: false,
        error: { code: "BAD_REQUEST" },
        message: "不接受查询参数",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const result = await getCurrentUserForReauth();
  const status = result.success
    ? 200
    : result.error?.code === "UNAUTHORIZED"
      ? 401
      : 500;
  return Response.json(result, { status, headers: PRIVATE_HEADERS });
}
