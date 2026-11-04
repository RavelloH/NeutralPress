import {
  GetUsersListSchema,
  GetUsersTrendsSchema,
} from "@repo/shared-types/api/user";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/user-domain";

function invalidQuery(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Public-facing GET, not public authorization. No write operations are reachable. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length > 1
  )
    return invalidQuery();
  const serialized = query.get("params") ?? "{}";
  if (serialized.length > 8192) return invalidQuery();
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    return invalidQuery();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return invalidQuery();
  let response: NextResponse;
  switch (operation) {
    case "trends": {
      const parsed = GetUsersTrendsSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (parsed.data.days > 365 || parsed.data.count > 100)
        return invalidQuery();
      response = await service.getUsersTrends(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "list": {
      const parsed = GetUsersListSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (parsed.data.pageSize > 500) return invalidQuery();
      response = await service.getUsersList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    default:
      return invalidQuery();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
