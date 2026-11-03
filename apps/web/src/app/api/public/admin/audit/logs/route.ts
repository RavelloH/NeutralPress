import { GetAuditLogsSchema } from "@repo/shared-types/api/audit";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import { getAuditLogs } from "@/lib/server/services/audit";

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
    if (
      ![
        "page",
        "pageSize",
        "sortBy",
        "sortOrder",
        "id",
        "action",
        "resource",
        "userUid",
        "timestampStart",
        "timestampEnd",
        "startDate",
        "endDate",
        "search",
      ].includes(key)
    )
      return reject();
  }
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
  if (query.has("action")) input.action = query.get("action");
  if (query.has("resource")) input.resource = query.get("resource");
  if (query.has("userUid")) {
    const value = query.get("userUid")!;
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return reject();
    input.userUid = Number(value);
  }
  if (query.has("timestampStart"))
    input.timestampStart = query.get("timestampStart");
  if (query.has("timestampEnd")) input.timestampEnd = query.get("timestampEnd");
  if (query.has("startDate")) input.startDate = query.get("startDate");
  if (query.has("endDate")) input.endDate = query.get("endDate");
  if (query.has("search")) input.search = query.get("search");
  const parsed = GetAuditLogsSchema.omit({ access_token: true }).safeParse(
    input,
  );
  if (!parsed.success) return reject();
  const result = await getAuditLogs(parsed.data, { environment: "serverless" });
  result.headers.set("Cache-Control", "private, no-store");
  result.headers.set("X-Content-Type-Options", "nosniff");
  return result;
}
