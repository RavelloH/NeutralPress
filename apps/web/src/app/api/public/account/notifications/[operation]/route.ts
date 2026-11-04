import type { NextRequest } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/notice-domain";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};
const MarkSchema = z
  .object({
    noticeIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  })
  .strict();
const EmptySchema = z.object({}).strict();

function invalid() {
  return Response.json(
    { success: false, error: { code: "BAD_REQUEST" }, message: "参数错误" },
    { status: 400, headers: HEADERS },
  );
}

/** Current-user mutations: use JSON POST, same-origin CSRF checks and original UID isolation. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== "mark" && operation !== "mark-all") return invalid();
  if ([...request.nextUrl.searchParams.keys()].length > 0) return invalid();

  const body = await parseSameOriginJson(request, 8192);
  if (!body.ok) return body.response;

  let response;
  if (operation === "mark") {
    const parsed = MarkSchema.safeParse(body.input);
    if (!parsed.success) return invalid();
    response = await service.markNoticesAsRead(parsed.data.noticeIds, {
      environment: "serverless",
    });
  } else {
    if (!EmptySchema.safeParse(body.input).success) return invalid();
    response = await service.markAllNoticesAsRead({
      environment: "serverless",
    });
  }
  for (const [key, value] of Object.entries(HEADERS))
    response.headers.set(key, value);
  return response;
}
