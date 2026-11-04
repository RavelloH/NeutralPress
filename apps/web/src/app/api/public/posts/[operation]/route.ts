import {
  GetPostDetailSchema,
  GetPostHistorySchema,
  GetPostsListSchema,
  GetPostsTrendsSchema,
  GetPostVersionSchema,
  GetProtectedPostContentSchema,
} from "@repo/shared-types/api/post";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/post-domain";
function badRequest(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
/** The operation whitelist excludes all mutations; service checks authorization and rate limits. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const query = request.nextUrl.searchParams;
  if (query.size > (query.has("params") ? 1 : 0)) return badRequest();
  const serialized = query.get("params");
  if (serialized && serialized.length > 8192) return badRequest();
  let input: unknown = {};
  try {
    if (serialized) input = JSON.parse(serialized);
  } catch {
    return badRequest();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return badRequest();
  let response: NextResponse;
  switch (operation) {
    case "trends": {
      const parsed = GetPostsTrendsSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getPostsTrends(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "list": {
      const parsed = GetPostsListSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getPostsList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetPostDetailSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getPostDetail(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "history": {
      const parsed = GetPostHistorySchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getPostHistory(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "version": {
      const parsed = GetPostVersionSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getPostVersion(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "protected-content": {
      const parsed = GetProtectedPostContentSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getProtectedPostContent(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    default:
      return badRequest();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
