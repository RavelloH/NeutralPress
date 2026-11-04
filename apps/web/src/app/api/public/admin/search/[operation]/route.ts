import {
  GetCustomWordsSchema,
  GetIndexStatusSchema,
  GetPostTokenDetailsSchema,
  GetSearchLogsSchema,
  TestTokenizeSchema,
} from "@repo/shared-types/api/search";
import type { NextRequest, NextResponse } from "next/server";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/search-admin-domain";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};
const operations = new Set([
  "words",
  "index-status",
  "tokens",
  "logs",
  "test-tokenize",
]);
function invalid(): NextResponse {
  return Response.json(
    {
      success: false,
      message: "无效的搜索管理查询",
      error: { code: "BAD_REQUEST" },
    },
    { status: 400, headers: PRIVATE_HEADERS },
  ) as NextResponse;
}

/** Admin/editor search diagnostics are private, including filtered search terms and post slugs. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
): Promise<NextResponse> {
  const { operation } = await context.params;
  if (!operations.has(operation)) return invalid();
  if (request.nextUrl.search) return invalid();

  const parsedBody = await parseSameOriginJson(
    request,
    operation === "test-tokenize" ? 12_288 : 8192,
  );
  if (!parsedBody.ok) return parsedBody.response;
  const input = parsedBody.input;

  let result: NextResponse;
  if (operation === "words") {
    const parsed = GetCustomWordsSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success) return invalid();
    result = await service.getCustomWords(parsed.data, {
      environment: "serverless",
    });
  } else if (operation === "index-status") {
    const parsed = GetIndexStatusSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success || (parsed.data.page ?? 1) > 10000) return invalid();
    result = await service.getIndexStatus(parsed.data, {
      environment: "serverless",
    });
  } else if (operation === "tokens") {
    const parsed = GetPostTokenDetailsSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success || parsed.data.slug.length > 512) return invalid();
    result = await service.getPostTokenDetails(parsed.data, {
      environment: "serverless",
    });
  } else if (operation === "logs") {
    const parsed = GetSearchLogsSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (
      !parsed.success ||
      (parsed.data.page ?? 1) > 10000 ||
      (parsed.data.query?.length ?? 0) > 300
    )
      return invalid();
    result = await service.getSearchLogs(parsed.data, {
      environment: "serverless",
    });
  } else {
    const parsed = TestTokenizeSchema.omit({ access_token: true })
      .strict()
      .safeParse(input);
    if (!parsed.success) return invalid();
    result = await service.testTokenize(parsed.data, {
      environment: "serverless",
    });
  }
  for (const [key, value] of Object.entries(PRIVATE_HEADERS))
    result.headers.set(key, value);
  return result;
}
