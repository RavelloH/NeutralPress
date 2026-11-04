import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseSameOriginJson } from "@/lib/server/api-json-post";
import * as service from "@/lib/server/services/mail-subscription-domain";

const ListSchema = z
  .object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().min(10).max(200).optional(),
    search: z.string().max(200).optional(),
    status: z
      .array(z.enum(["PENDING_VERIFY", "ACTIVE", "UNSUBSCRIBED"]))
      .max(3)
      .optional(),
    boundUser: z.array(z.boolean()).max(2).optional(),
    pendingOnly: z.boolean().optional(),
    sortBy: z.enum(["id", "createdAt", "updatedAt", "lastSentAt"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  })
  .strict();
const EmptySchema = z.object({}).strict();
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function fail(): NextResponse {
  return Response.json(
    { success: false, error: { code: "BAD_REQUEST" } },
    { status: 400, headers: RESPONSE_HEADERS },
  ) as NextResponse;
}
function resultStatus(result: {
  success: boolean;
  error?: { code?: string };
}): number {
  if (result.success) return 200;
  const code = result.error?.code;
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "TOO_MANY_REQUESTS") return 429;
  if (code === "BAD_REQUEST") return 400;
  return 500;
}

/** Admin/editor read whitelist; NEVER exposes subscription mutation or email dispatch. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (!["overview", "distribution"].includes(operation)) return fail();
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length > 1
  )
    return fail();
  const serialized = query.get("params") ?? "{}";
  if (serialized.length > 8192) return fail();
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    return fail();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return fail();

  if (!EmptySchema.safeParse(input).success) return fail();
  const result =
    operation === "overview"
      ? await service.getLatestMailDispatchOverview()
      : await service.getMailSubscriptionStatusDistribution();
  return Response.json(result, {
    status: resultStatus(result),
    headers: RESPONSE_HEADERS,
  });
}

/** Subscriber search can contain email addresses and must never appear in URL logs. */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== "list") return fail();
  const parsedBody = await parseSameOriginJson(request, 8192);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = ListSchema.safeParse(parsedBody.input);
  if (!parsed.success) return fail();
  const result = await service.getMailSubscriptionList(parsed.data);
  return Response.json(result, {
    status: resultStatus(result),
    headers: RESPONSE_HEADERS,
  });
}
