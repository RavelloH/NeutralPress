import {
  GetEndpointStatsSchema,
  GetIPListSchema,
  GetRequestTrendsSchema,
  GetSecurityOverviewSchema,
} from "@repo/shared-types/api/security";
import type { NextRequest, NextResponse } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/security-domain";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
  "X-Content-Type-Options": "nosniff",
};

type ActionResult = {
  success: boolean;
  error?: { code?: string };
};

function responseStatus(result: ActionResult): number {
  if (result.success) return 200;
  switch (result.error?.code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "TOO_MANY_REQUESTS":
      return 429;
    case "BAD_REQUEST":
    case "VALIDATION_ERROR":
      return 400;
    default:
      return 500;
  }
}

function respond(result: ActionResult) {
  return Response.json(result, {
    status: responseStatus(result),
    headers: RESPONSE_HEADERS,
  });
}

function invalid(): NextResponse {
  return Response.json(
    { success: false, message: "请求参数错误", error: { code: "BAD_REQUEST" } },
    { status: 400, headers: RESPONSE_HEADERS },
  ) as NextResponse;
}

function parseQuery(request: NextRequest): unknown | null {
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length > 1
  ) {
    return null;
  }
  const serialized = query.get("params") ?? "{}";
  if (serialized.length > 8192) return null;
  try {
    const input: unknown = JSON.parse(serialized);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.hasOwn(input, "access_token")
    ) {
      return null;
    }
    return input;
  } catch {
    return null;
  }
}

/** Only pure, ADMIN-authorized aggregates are exposed through GET. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const input = parseQuery(request);
  if (input === null) return invalid();

  if (operation === "overview") {
    const parsed = GetSecurityOverviewSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success) return invalid();
    return respond(await service.getSecurityOverview(parsed.data));
  }
  if (operation === "endpoints") {
    const parsed = GetEndpointStatsSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success) return invalid();
    return respond(await service.getEndpointStats(parsed.data));
  }
  if (operation === "trends") {
    const parsed = GetRequestTrendsSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success) return invalid();
    return respond(await service.getRequestTrends(parsed.data));
  }
  return invalid();
}

/** IP records and IP search terms are private; keep them in a same-origin JSON body. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== "ips") return invalid();

  const parsedBody = await parseSameOriginJson(request, 8192);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = GetIPListSchema.omit({ access_token: true })
    .strict()
    .safeParse(parsedBody.input);
  if (!parsed.success) return invalid();

  return respond(await service.getIPList(parsed.data));
}
