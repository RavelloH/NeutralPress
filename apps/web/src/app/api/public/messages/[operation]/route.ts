import {
  CheckMessagePermissionRequestSchema,
  GetConversationMessagesRequestSchema,
  GetConversationsRequestSchema,
  SearchUsersRequestSchema,
} from "@repo/shared-types/api/message";
import type { NextRequest, NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/message-domain";

export const runtime = "nodejs";

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
    case "conversations": {
      const parsed = GetConversationsRequestSchema.strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (
        !Number.isSafeInteger(parsed.data.skip) ||
        !Number.isSafeInteger(parsed.data.take)
      )
        return invalidQuery();
      const lastPolledAt = parsed.data.lastPolledAt
        ? new Date(parsed.data.lastPolledAt)
        : undefined;
      if (lastPolledAt && Number.isNaN(lastPolledAt.getTime()))
        return invalidQuery();
      response = await service.getConversations(
        lastPolledAt,
        parsed.data.skip,
        parsed.data.take,
        { environment: "serverless" },
      );
      break;
    }
    case "thread": {
      const parsed =
        GetConversationMessagesRequestSchema.strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      if (
        !Number.isSafeInteger(parsed.data.skip) ||
        !Number.isSafeInteger(parsed.data.take)
      )
        return invalidQuery();
      response = await service.getConversationMessages(
        parsed.data.conversationId,
        parsed.data.skip,
        parsed.data.take,
        { environment: "serverless" },
      );
      break;
    }
    case "users": {
      const parsed = SearchUsersRequestSchema.strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.searchUsers(parsed.data.query, {
        environment: "serverless",
      });
      break;
    }
    case "permission": {
      const parsed =
        CheckMessagePermissionRequestSchema.strict().safeParse(input);
      if (!parsed.success) return invalidQuery();
      response = await service.checkMessagePermission(parsed.data.targetUid, {
        environment: "serverless",
      });
      break;
    }
    default:
      return invalidQuery();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
