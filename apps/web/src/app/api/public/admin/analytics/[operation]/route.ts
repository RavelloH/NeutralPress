import { GetPageViewsSchema } from "@repo/shared-types/api/analytics";
import {
  GetAnalyticsStatsSchema,
  GetRealTimeStatsSchema,
} from "@repo/shared-types/api/analytics-stats";
import type { NextRequest, NextResponse } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/analytics-domain";

export const runtime = "nodejs";

function jsonResult(result: {
  success: boolean;
  error?: { code?: string };
}): NextResponse {
  const code = result.error?.code;
  const status = result.success
    ? 200
    : code === "UNAUTHORIZED"
      ? 401
      : code === "FORBIDDEN"
        ? 403
        : code === "BAD_REQUEST"
          ? 400
          : code === "TOO_MANY_REQUESTS"
            ? 429
            : 500;
  return Response.json(result, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  }) as NextResponse;
}

function invalid(): NextResponse {
  return jsonResult({ success: false, error: { code: "BAD_REQUEST" } });
}

/**
 * Admin analytics queries currently flush pending Redis events to DB.
 * They use ordinary JSON POST, not cacheable GET or serialized Server Actions.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!["summary", "pages", "realtime"].includes(operation)) return invalid();
  const parsedBody = await parseSameOriginJson(request, 16384);
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.input;
  let result;
  switch (operation) {
    case "summary": {
      const keys = Object.keys(GetAnalyticsStatsSchema.shape);
      if (Object.keys(input as object).some((key) => !keys.includes(key)))
        return invalid();
      const parsed = GetAnalyticsStatsSchema.safeParse(input);
      if (!parsed.success) return invalid();
      result = await service.getAnalyticsStats(parsed.data);
      break;
    }
    case "pages": {
      const parsed = GetPageViewsSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalid();
      result = await service.getPageViews(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "realtime": {
      const parsed = GetRealTimeStatsSchema.omit({ access_token: true })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalid();
      result = await service.getRealTimeStats(parsed.data);
      break;
    }
    default:
      return invalid();
  }
  if (result instanceof Response) {
    result.headers.set("Cache-Control", "private, no-store");
    result.headers.set("X-Content-Type-Options", "nosniff");
    return result;
  }
  return jsonResult(result);
}
