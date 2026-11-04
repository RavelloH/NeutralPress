import {
  GetMediaDetailSchema,
  GetMediaListSchema,
  GetMediaStatsSchema,
  GetMediaTrendsSchema,
} from "@repo/shared-types/api/media";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authVerify } from "@/lib/server/auth-verify";
import ResponseBuilder from "@/lib/server/response";
import * as service from "@/lib/server/services/media-domain";
function badRequest(): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message: "无效的查询参数",
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
/** The operation whitelist excludes all mutations; service checks authorization and rate limits. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  const query = request.nextUrl.searchParams;
  if (query.size > (query.has("params") ? 1 : 0)) return badRequest();
  const serialized = query.get("params");
  if (serialized && serialized.length > 8192) return badRequest();
  let input: unknown = {};
  try {
    if (serialized) input = JSON.parse(serialized);
  } catch {
    return badRequest();
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.hasOwn(input, "access_token")
  )
    return badRequest();
  let response: NextResponse;
  switch (operation) {
    case "list": {
      const parsed = GetMediaListSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getMediaList(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "detail": {
      const parsed = GetMediaDetailSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getMediaDetail(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "stats": {
      const parsed = GetMediaStatsSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getMediaStats(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "trends": {
      const parsed = GetMediaTrendsSchema.safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getMediaTrends(parsed.data, {
        environment: "serverless",
      });
      break;
    }
    case "folders": {
      const parsed = z
        .object({
          parentId: z.number().int().positive().nullable().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return badRequest();
      const user = await authVerify({
        allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
      });
      if (!user) {
        const unauthorized = new ResponseBuilder(
          "serverless",
        ).unauthorized() as NextResponse;
        unauthorized.headers.set("Cache-Control", "private, no-store");
        return unauthorized;
      }
      response = await service.getAccessibleFolders(
        {
          access_token: "",
          userRole: user.role,
          userUid: user.uid,
          parentId: parsed.data.parentId,
        },
        { environment: "serverless" },
      );
      break;
    }
    case "breadcrumb": {
      const parsed = z
        .object({
          folderId: z.number().int().positive().nullable(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getFolderBreadcrumb(
        { access_token: "", folderId: parsed.data.folderId },
        { environment: "serverless" },
      );
      break;
    }
    case "explorer": {
      const parsed = GetMediaListSchema.omit({
        access_token: true,
        folderId: true,
      })
        .extend({
          currentFolderId: z.number().int().positive().nullable().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return badRequest();
      response = await service.getMediaExplorerPage(
        { ...parsed.data, access_token: "" },
        { environment: "serverless" },
      );
      break;
    }
    default:
      return badRequest();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
