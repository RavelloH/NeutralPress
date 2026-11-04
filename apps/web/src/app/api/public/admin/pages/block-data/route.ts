import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import type { RuntimeBlockInput } from "@/blocks/core/definition";
import { fetchBlockData } from "@/lib/server/services/page-domain";

const MAX_BODY_SIZE = 128 * 1024;
const InputSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    block: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    content: z.unknown(),
    data: z.unknown().optional(),
  })
  .strict();

function reject(message: string, status = 400): NextResponse {
  return Response.json(
    {
      success: false,
      message,
      error: { code: status === 403 ? "FORBIDDEN" : "BAD_REQUEST", message },
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  ) as NextResponse;
}

/**
 * A computed read with potentially large, nested block input. Use normal JSON POST
 * instead of a serialized Server Action or a URL carrying arbitrary block content.
 * The service retains ADMIN authorization and rate limiting.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return reject("不允许跨站请求", 403);
  if (origin) {
    try {
      const source = new URL(origin);
      const expected =
        request.headers.get("x-forwarded-host") ||
        request.headers.get("host") ||
        request.nextUrl.host;
      if (source.host !== expected) return reject("请求来源不匹配", 403);
    } catch {
      return reject("无效的来源", 403);
    }
  }

  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return reject("需要 application/json 请求");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_BODY_SIZE)
    return reject("请求内容过大", 413);

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return reject("读取请求内容失败");
  }
  if (raw.length > MAX_BODY_SIZE) return reject("请求内容过大", 413);

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return reject("无效的 JSON");
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  ) {
    return reject("无效的请求参数");
  }
  const parsed = InputSchema.safeParse((input as { block?: unknown }).block);
  if (!parsed.success || !Object.hasOwn(parsed.data, "content"))
    return reject("无效的 Block 数据");

  const response = await fetchBlockData(
    { access_token: "", block: parsed.data as RuntimeBlockInput },
    { environment: "serverless" },
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
