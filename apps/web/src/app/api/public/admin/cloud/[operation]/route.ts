import {
  GetCloudHistorySchema,
  GetCloudTrendsSchema,
} from "@repo/shared-types/api/cloud";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/cloud-domain";

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

/** Cloud history, config and remote probes are private POSTs; mutations remain unavailable. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!["history", "config", "remote-status"].includes(operation))
    return invalid();
  const parsedBody = await parseSameOriginJson(request, 8192);
  if (!parsedBody.ok) return parsedBody.response;
  let result: NextResponse;
  if (operation === "history") {
    const parsed = GetCloudHistorySchema.omit({ access_token: true })
      .strict()
      .safeParse(parsedBody.input);
    if (!parsed.success) return invalid();
    result = await service.getCloudHistory(parsed.data, {
      environment: "serverless",
    });
  } else {
    if (!z.object({}).strict().safeParse(parsedBody.input).success)
      return invalid();
    result =
      operation === "config"
        ? await service.getCloudConfig({}, { environment: "serverless" })
        : await service.getCloudRemoteStatus({}, { environment: "serverless" });
  }
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
