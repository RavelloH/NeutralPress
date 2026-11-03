import {
  GetMenuDetailSchema,
  GetMenusListSchema,
  GetMenusStatsSchema,
} from "@repo/shared-types/api/menu";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/menu-domain";

export const runtime = "nodejs";

function invalidQuery(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Administrative read whitelist. Authorization and original rate limits are enforced by services. */
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
    case "stats": {
      const parsed = GetMenusStatsSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getMenusStats(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "list": {
      const parsed = GetMenusListSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (parsed.data.pageSize > 500) return invalidQuery();
      response = await service.getMenusList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetMenuDetailSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getMenuDetail(parsed.data, {
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
