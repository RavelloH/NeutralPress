import { GetCronTrendsSchema } from "@repo/shared-types/api/cron";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { getCronTrends } from "@/lib/server/services/cron-history";

function reject(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的计划任务查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Requires ADMIN role; the service enforces authentication and rate limits. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const input: Record<string, unknown> = {};
  const allowed = new Set(["days", "count"]);
  for (const key of query.keys()) if (!allowed.has(key)) return reject();
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
  const parsed = GetCronTrendsSchema.omit({ access_token: true }).safeParse(
    input,
  );
  if (!parsed.success) return reject();
  const response = await getCronTrends(parsed.data, {
    environment: "serverless",
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
