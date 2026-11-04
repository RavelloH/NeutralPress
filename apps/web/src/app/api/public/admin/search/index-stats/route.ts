import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { getSearchIndexStats } from "@/lib/server/services/search-stats";

function invalidParams(): NextResponse {
  const result = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  result.headers.set("Cache-Control", "private, no-store");
  return result;
}

/** Authenticated, admin/editor only; authorization is checked in the service. */
export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("force");
  if (force !== null && force !== "true" && force !== "false") {
    return invalidParams();
  }
  const response = await getSearchIndexStats(
    { force: force === "true" },
    { environment: "serverless" },
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
