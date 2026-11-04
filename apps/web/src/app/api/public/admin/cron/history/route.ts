import { GetCronHistorySchema } from "@repo/shared-types/api/cron";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { getCronHistory } from "@/lib/server/services/cron-history";

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
  const allowed = new Set([
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "id",
    "status",
    "triggerType",
    "createdAtStart",
    "createdAtEnd",
  ]);
  for (const key of query.keys()) if (!allowed.has(key)) return reject();
  if (query.has("page")) {
    const value = query.get("page")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.page = Number(value);
  }
  if (query.has("pageSize")) {
    const value = query.get("pageSize")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.pageSize = Number(value);
  }
  if (query.has("sortBy")) input.sortBy = query.get("sortBy");
  if (query.has("sortOrder")) input.sortOrder = query.get("sortOrder");
  if (query.has("id")) {
    const value = query.get("id")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.id = Number(value);
  }
  if (query.has("status")) input.status = query.get("status");
  if (query.has("triggerType")) input.triggerType = query.get("triggerType");
  if (query.has("createdAtStart"))
    input.createdAtStart = query.get("createdAtStart");
  if (query.has("createdAtEnd")) input.createdAtEnd = query.get("createdAtEnd");
  const parsed = GetCronHistorySchema.omit({ access_token: true }).safeParse(
    input,
  );
  if (!parsed.success) return reject();
  const response = await getCronHistory(parsed.data, {
    environment: "serverless",
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
