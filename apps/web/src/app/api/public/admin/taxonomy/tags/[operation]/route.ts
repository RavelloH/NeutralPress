import {
  GetTagDetailSchema,
  GetTagsDistributionSchema,
  GetTagsListSchema,
  SearchTagsSchema,
} from "@repo/shared-types/api/tag";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/tag";

function invalid(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const serialized = request.nextUrl.searchParams.get("params");
  if (request.nextUrl.searchParams.size > (serialized === null ? 0 : 1))
    return invalid();
  if (serialized && serialized.length > 4000) return invalid();
  let input: unknown = {};
  try {
    if (serialized) input = JSON.parse(serialized);
  } catch {
    return invalid();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return invalid();
  let response: NextResponse;
  switch (operation) {
    case "list": {
      const parsed = GetTagsListSchema.omit({ access_token: true }).safeParse(
        input,
      );
      if (!parsed.success) return invalid();
      response = await service.getTagsList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetTagDetailSchema.omit({ access_token: true }).safeParse(
        input,
      );
      if (!parsed.success) return invalid();
      response = await service.getTagDetail(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "search": {
      const parsed = SearchTagsSchema.omit({ access_token: true }).safeParse(
        input,
      );
      if (!parsed.success) return invalid();
      response = await service.searchTags(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "distribution": {
      const parsed = GetTagsDistributionSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.getTagsDistribution(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    default:
      return invalid();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
