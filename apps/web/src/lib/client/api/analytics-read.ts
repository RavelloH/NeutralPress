import type {
  ApiResponse,
  GetAnalyticsStats,
  GetAnalyticsStatsResponse,
  GetPageViews,
  GetPageViewsResponse,
  GetRealTimeStats,
  GetRealTimeStatsResponse,
  TrackPageView,
  TrackPageViewResponse,
} from "@repo/shared-types";

import { fetchPublicRead } from "@/lib/client/api/read";

/** Native JSON transport, independent of serialized Server Action POST queues. */
async function analyticsPost<T>(
  pathname: string,
  params: object,
  signal?: AbortSignal,
): Promise<T> {
  const safeParams = { ...params } as Record<string, unknown>;
  delete safeParams.access_token;
  const response = await fetch(pathname, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(safeParams),
    signal,
  });
  if (response.status >= 500) throw new Error("Analytics request failed");
  return (await response.json()) as T;
}

export function trackPageView(
  params: TrackPageView,
  signal?: AbortSignal,
): Promise<TrackPageViewResponse> {
  return analyticsPost("/api/public/analytics/track", params, signal);
}

export function getAnalyticsStats(
  params: GetAnalyticsStats,
  signal?: AbortSignal,
): Promise<GetAnalyticsStatsResponse> {
  return analyticsPost("/api/public/admin/analytics/summary", params, signal);
}

export function getPageViews(
  params: GetPageViews,
  signal?: AbortSignal,
): Promise<GetPageViewsResponse> {
  return analyticsPost("/api/public/admin/analytics/pages", params, signal);
}

export function getRealTimeStats(
  params: GetRealTimeStats,
  signal?: AbortSignal,
): Promise<GetRealTimeStatsResponse> {
  return analyticsPost("/api/public/admin/analytics/realtime", params, signal);
}

export async function batchGetViewCounts(
  paths: string[],
  signal?: AbortSignal,
): Promise<Array<{ path: string; count: number }>> {
  const response: ApiResponse<Array<{ path: string; count: number }>> =
    await fetchPublicRead(
      "/api/public/analytics/view-counts",
      { paths },
      signal,
    );
  if (!response.success || !response.data) {
    throw new Error(response.message || "获取浏览量失败");
  }
  return response.data;
}
