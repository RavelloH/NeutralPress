import type { NextRequest } from "next/server";
import { z } from "zod";

import { batchGetViewCounts } from "@/lib/server/services/analytics-domain";

export const runtime = "nodejs";
const QuerySchema = z
  .object({
    paths: z.array(z.string().min(1).max(300)).min(1).max(20),
  })
  .strict();

/** Anonymous Redis-only read: at most 20 paths, preserving original rate limiting. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length !== 1
  ) {
    return Response.json(
      { success: false, error: { code: "BAD_REQUEST" } },
      { status: 400, headers },
    );
  }
  const encoded = query.get("params") ?? "";
  if (encoded.length > 8192) {
    return Response.json(
      { success: false, error: { code: "BAD_REQUEST" } },
      { status: 400, headers },
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(encoded);
  } catch {
    return Response.json(
      { success: false, error: { code: "BAD_REQUEST" } },
      { status: 400, headers },
    );
  }
  const parsed = QuerySchema.safeParse(input);
  if (!parsed.success) {
    return Response.json(
      { success: false, error: { code: "BAD_REQUEST" } },
      { status: 400, headers },
    );
  }
  try {
    const result = await batchGetViewCounts(parsed.data.paths);
    return Response.json({ success: true, data: result }, { headers });
  } catch (error) {
    // The existing service throws for rate limits and Redis failure. Do not disclose internals.
    if (error instanceof Error && error.message.includes("请求过于频繁")) {
      return Response.json(
        { success: false, error: { code: "TOO_MANY_REQUESTS" } },
        { status: 429, headers },
      );
    }
    return Response.json(
      { success: false, error: { code: "INTERNAL_SERVER_ERROR" } },
      { status: 500, headers },
    );
  }
}
