import type { NextRequest, NextResponse } from "next/server";

import { getBackupScopes } from "@/lib/server/services/backup-scopes-domain";

export const runtime = "nodejs";

/** Admin-only catalog; backup exports, imports, and upload signing are never GET operations. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if ([...request.nextUrl.searchParams.keys()].length > 0) {
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
    ) as NextResponse;
  }

  const response = await getBackupScopes({}, { environment: "serverless" });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
