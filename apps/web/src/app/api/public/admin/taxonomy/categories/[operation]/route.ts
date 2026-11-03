import {
  GetCategoriesDistributionSchema,
  GetCategoriesListSchema,
  GetCategoriesTreeSchema,
  GetCategoryDetailSchema,
  SearchCategoriesSchema,
} from "@repo/shared-types/api/category";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/category";

export const runtime = "nodejs";

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
      const parsed = GetCategoriesListSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.getCategoriesList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetCategoryDetailSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.getCategoryDetail(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "search": {
      const parsed = SearchCategoriesSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.searchCategories(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "distribution": {
      const parsed = GetCategoriesDistributionSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.getCategoriesDistribution(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "tree": {
      const parsed = GetCategoriesTreeSchema.omit({
        access_token: true,
      }).safeParse(input);
      if (!parsed.success) return invalid();
      response = await service.getCategoriesTree(parsed.data, {
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
