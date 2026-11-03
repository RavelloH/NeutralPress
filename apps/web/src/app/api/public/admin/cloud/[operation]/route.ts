import {
  GetCloudHistorySchema,
  GetCloudTrendsSchema,
} from "@repo/shared-types/api/cloud";
import type { NextRequest, NextResponse } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/cloud-domain";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function invalid(): NextResponse {
  return Response.json(
    { success: false, error: { code: "BAD_REQUEST" } },
    {
      status: 400,
      headers: RESPONSE_HEADERS,
    },
  ) as NextResponse;
}

/** Cloud history may contain sensitive delivery identifiers. Do not put them in URLs. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== "history") return invalid();
  const parsedBody = await parseSameOriginJson(request, 8192);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = GetCloudHistorySchema.omit({ access_token: true })
    .strict()
    .safeParse(parsedBody.input);
  if (!parsed.success) return invalid();
  const result = await service.getCloudHistory(parsed.data, {
    environment: "serverless",
  });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}

/** Pure, admin-authorized aggregation. Remote status probes and sync writes are excluded. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== "trends") return invalid();
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length > 1
  )
    return invalid();
  const encoded = query.get("params") ?? "{}";
  if (encoded.length > 8192) return invalid();
  let input: unknown;
  try {
    input = JSON.parse(encoded);
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
  const parsed = GetCloudTrendsSchema.omit({ access_token: true })
    .strict()
    .safeParse(input);
  if (!parsed.success || parsed.data.count > 100) return invalid();
  const result = await service.getCloudTrends(parsed.data, {
    environment: "serverless",
  });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
