import type { NextRequest } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import { getSettings } from "@/lib/server/services/settings-read-domain";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};

/** Complete site config can contain credentials. Never log filters or share response. */
export async function POST(request: NextRequest) {
  const body = await parseSameOriginJson(request, 1024);
  if (!body.ok) return body.response;
  if (!z.object({}).strict().safeParse(body.input).success) {
    return Response.json(
      {
        success: false,
        error: { code: "BAD_REQUEST" },
        message: "不接受查询参数",
      },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }
  const response = await getSettings({}, { environment: "serverless" });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set(
    "Content-Security-Policy",
    PRIVATE_HEADERS["Content-Security-Policy"],
  );
  return response;
}
