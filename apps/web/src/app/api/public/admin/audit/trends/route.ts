import { GetAuditTrendsSchema } from "@repo/shared-types/api/audit";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { getAuditTrends } from "@/lib/server/services/audit";

export const runtime = "nodejs";

function reject(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的审计查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Admin-only; all authorization and rate limiting remain in the service. */
export async function GET(request: NextRequest) {
  const input: Record<string, unknown> = {};
  const query = request.nextUrl.searchParams;
  for (const key of query.keys()) {
    if (!["days", "count", "groupBy"].includes(key)) return reject();
  }
  if (query.has("days")) {
    const value = query.get("days")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.days = Number(value);
  }
  if (query.has("count")) {
    const value = query.get("count")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.count = Number(value);
  }
  if (query.has("groupBy")) input.groupBy = query.get("groupBy");
  const parsed = GetAuditTrendsSchema.omit({ access_token: true }).safeParse(
    input,
  );
  if (!parsed.success) return reject();
  const result = await getAuditTrends(parsed.data, {
    environment: "serverless",
  });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
