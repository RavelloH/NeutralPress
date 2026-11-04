import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authVerify } from "@/lib/server/auth-verify";
import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/user-domain";

function invalidQuery(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

/** Public-facing GET, not public authorization. No write operations are reachable. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const query = request.nextUrl.searchParams;
  if (
    [...query.keys()].some((key) => key !== "params") ||
    query.getAll("params").length > 1
  )
    return invalidQuery();
  const serialized = query.get("params") ?? "{}";
  if (serialized.length > 8192) return invalidQuery();
  let input: unknown;
  try {
    input = JSON.parse(serialized);
  } catch {
    return invalidQuery();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return invalidQuery();
  let response: NextResponse;
  switch (operation) {
    case "self": {
      const parsed = z.object({}).strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getUserProfile({ environment: "serverless" });
      break;
    }
    case "profile": {
      const parsed = z
        .object({ uid: z.number().int().positive() })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.getUserPublicProfile(parsed.data.uid, {
        environment: "serverless",
      });
      break;
    }
    case "activity": {
      const parsed = z
        .object({
          uid: z.number().int().positive(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return invalidQuery();
      const viewer = await authVerify({
        allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      });
      response = await service.getUserActivity(
        parsed.data.uid,
        parsed.data.offset,
        parsed.data.limit,
        !viewer,
        { environment: "serverless" },
      );
      break;
    }
    default:
      return invalidQuery();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
