import "server-only";

import type { NextRequest, NextResponse } from "next/server";

import {
  readRequestBodyWithLimit,
  RequestBodyTooLargeError,
} from "@/lib/server/request-body";

export type ParsedJsonRequest =
  | { ok: true; input: unknown }
  | { ok: false; response: NextResponse };

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

/** 解析有大小限制的 JSON，并在读取凭据或调用服务前拒绝跨站请求。 */
export async function parseSameOriginJson(
  request: NextRequest,
  maxBytes: number,
): Promise<ParsedJsonRequest> {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return { ok: false, response: reject("不允许跨站请求", 403) };
  }
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const expectedHost =
        request.headers.get("x-forwarded-host") ??
        request.headers.get("host") ??
        request.nextUrl.host;
      if (
        !["https:", "http:"].includes(originUrl.protocol) ||
        originUrl.host !== expectedHost
      ) {
        return { ok: false, response: reject("请求来源不匹配", 403) };
      }
    } catch {
      return { ok: false, response: reject("无效的请求来源", 403) };
    }
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return { ok: false, response: reject("需要 application/json") };
  }
  let content: string;
  try {
    content = new TextDecoder().decode(
      await readRequestBodyWithLimit(request, maxBytes),
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, response: reject("请求内容过大", 413) };
    }
    return { ok: false, response: reject("请求内容读取失败") };
  }
  let input: unknown;
  try {
    input = JSON.parse(content);
  } catch {
    return { ok: false, response: reject("JSON 解析失败") };
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  ) {
    return { ok: false, response: reject("无效的查询参数") };
  }
  return { ok: true, input };
}
