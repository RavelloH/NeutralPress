import "server-only";

import type { NextRequest, NextResponse } from "next/server";

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

/** Parse small JSON POSTs. Reject cross-site browser requests before touching cookies or services. */
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
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > maxBytes
    ) {
      return { ok: false, response: reject("请求内容过大", 413) };
    }
  }
  let content: string;
  try {
    content = await request.text();
  } catch {
    return { ok: false, response: reject("请求内容读取失败") };
  }
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    return { ok: false, response: reject("请求内容过大", 413) };
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
