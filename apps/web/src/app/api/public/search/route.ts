import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { searchSite } from "@/lib/server/services/search";

/**
 * Public-facing read API. "public" denotes the external API surface,
 * not a blanket authorization exemption for other API routes.
 *
 * GET avoids the client-side Server Function serialization queue.
 * Search is never shared-cached because the query and telemetry are private.
 */

const SEARCH_QUERY_MAX_LENGTH = 200;
const SEARCH_METADATA_MAX_LENGTH = 100;

function rejectBadRequest(message: string): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message,
    error: { code: "BAD_REQUEST", message },
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!query || query.length > SEARCH_QUERY_MAX_LENGTH) {
    return rejectBadRequest("搜索关键词长度必须在 1 到 200 个字符之间");
  }

  // Keep anonymous search correlation out of URLs, browser history and CDN logs.
  const sessionId = request.headers.get("x-search-session-id") ?? undefined;
  const visitorId = request.headers.get("x-search-visitor-id") ?? undefined;

  if (
    (sessionId && sessionId.length > SEARCH_METADATA_MAX_LENGTH) ||
    (visitorId && visitorId.length > SEARCH_METADATA_MAX_LENGTH)
  ) {
    return rejectBadRequest("搜索会话标识无效");
  }

  // Reuse the existing rate limit, validation, query and search telemetry.
  // No duplicate business rules or database implementations are introduced.
  const response = await searchSite(
    { query, sessionId, visitorId },
    { environment: "serverless" },
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
