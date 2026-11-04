import type { NextRequest } from "next/server";
import { z } from "zod";

import { getReadNotices } from "@/lib/server/services/notice-domain";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none';",
};
const ParamsSchema = z
  .object({
    skip: z.number().int().min(0).max(100000),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

function badRequest() {
  return Response.json(
    { success: false, error: { code: "BAD_REQUEST" }, message: "参数错误" },
    { status: 400, headers: HEADERS },
  );
}

/** Current user's read-only notices; UID is inferred from Cookie, never URL. */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  if (
    query.getAll("params").length !== 1 ||
    [...query.keys()].some((key) => key !== "params")
  ) {
    return badRequest();
  }
  const raw = query.get("params") ?? "";
  if (raw.length > 2048) return badRequest();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badRequest();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.hasOwn(parsed, "access_token")
  ) {
    return badRequest();
  }
  const input = ParamsSchema.safeParse(parsed);
  if (!input.success) return badRequest();

  const response = await getReadNotices(input.data.skip, input.data.limit, {
    environment: "serverless",
  });
  for (const [key, value] of Object.entries(HEADERS))
    response.headers.set(key, value);
  return response;
}
