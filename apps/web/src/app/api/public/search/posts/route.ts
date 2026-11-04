import { SearchPostsSchema } from "@repo/shared-types/api/search";
import type { NextRequest, NextResponse } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import { searchPosts } from "@/lib/server/services/search";

/** Public published-post search via JSON POST; visitor IDs and keywords must not enter URL logs. */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function invalid(): NextResponse {
  return Response.json(
    { success: false, message: "搜索参数无效", error: { code: "BAD_REQUEST" } },
    { status: 400, headers: PRIVATE_HEADERS },
  ) as NextResponse;
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.nextUrl.search) return invalid();
  const parsedBody = await parseSameOriginJson(request, 8192);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = SearchPostsSchema.strict().safeParse(parsedBody.input);
  if (!parsed.success) return invalid();
  if (
    parsed.data.page > 100 ||
    (parsed.data.status && parsed.data.status !== "PUBLISHED") ||
    (parsed.data.sessionId?.length ?? 0) > 100 ||
    (parsed.data.visitorId?.length ?? 0) > 100
  )
    return invalid();

  const result = await searchPosts(
    { ...parsed.data, status: "PUBLISHED" },
    { environment: "serverless" },
  );
  for (const [key, value] of Object.entries(PRIVATE_HEADERS))
    result.headers.set(key, value);
  return result;
}
