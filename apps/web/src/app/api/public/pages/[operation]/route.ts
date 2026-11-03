import {
  GetPageDetailSchema,
  GetPagesListSchema,
} from "@repo/shared-types/api/page";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/page-domain";

export const runtime = "nodejs";

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
    case "list": {
      const parsed = GetPagesListSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (parsed.data.pageSize > 500) return invalidQuery();
      response = await service.getPagesList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetPageDetailSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getPageDetail(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "placeholders": {
      const parsed = z.object({}).strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getAllPlaceholders({
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
