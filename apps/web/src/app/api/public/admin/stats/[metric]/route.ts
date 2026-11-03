import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";

import ResponseBuilder from "@/lib/server/response";
import * as stats from "@/lib/server/services/stats";

export const runtime = "nodejs";

const handlers = {
  users: (force: boolean) =>
    stats.getUsersStats({ force }, { environment: "serverless" }),
  audit: (force: boolean) =>
    stats.getAuditStats({ force }, { environment: "serverless" }),
  posts: (force: boolean) =>
    stats.getPostsStats({ force }, { environment: "serverless" }),
  tags: (force: boolean) =>
    stats.getTagsStats({ force }, { environment: "serverless" }),
  categories: (force: boolean) =>
    stats.getCategoriesStats({ force }, { environment: "serverless" }),
  pages: (force: boolean) =>
    stats.getPagesStats({ force }, { environment: "serverless" }),
  storage: (force: boolean) =>
    stats.getStorageStats({ force }, { environment: "serverless" }),
  visit: (force: boolean) =>
    stats.getVisitStats({ force }, { environment: "serverless" }),
  projects: (force: boolean) =>
    stats.getProjectsStats({ force }, { environment: "serverless" }),
};
type Metric = keyof typeof handlers;

function reject(message: string): NextResponse {
  const response = new ResponseBuilder("serverless").badRequest({
    message,
  }) as NextResponse;
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * External admin statistics API. The service preserves role checks and rate limits.
 * "public" means externally callable, never anonymous.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ metric: string }> },
) {
  const { metric } = await context.params;
  if (!Object.hasOwn(handlers, metric)) return reject("未知统计类型");
  const forceValue = request.nextUrl.searchParams.get("force");
  if (forceValue !== null && !["true", "false"].includes(forceValue)) {
    return reject("无效的强制刷新参数");
  }
  const response = await handlers[metric as Metric](forceValue === "true");
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
