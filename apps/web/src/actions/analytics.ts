"use server";

import type {
  ApiResponse,
  ApiResponseData,
  GetAnalyticsStats,
  GetAnalyticsStatsResponse,
  GetPageViews,
  GetRealTimeStats,
  GetRealTimeStatsResponse,
  PageViewItem,
  TrackPageView,
  TrackPageViewResponse,
} from "@repo/shared-types";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/analytics-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function trackPageView(
  params: TrackPageView,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<TrackPageViewResponse>>;

export async function trackPageView(
  params: TrackPageView,
  serverConfig?: ActionConfig,
): Promise<TrackPageViewResponse>;

export async function trackPageView(
  params: TrackPageView,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  return service.trackPageView(params, serverConfig);
}

export async function getAnalyticsStats(
  params: GetAnalyticsStats,
): Promise<GetAnalyticsStatsResponse> {
  return service.getAnalyticsStats(params);
}

export async function getPageViews(
  params: GetPageViews,
  config?: ActionConfig,
): Promise<ActionResult<PageViewItem[]>> {
  return service.getPageViews(params, config);
}

export async function getRealTimeStats(
  params: GetRealTimeStats,
): Promise<GetRealTimeStatsResponse> {
  return service.getRealTimeStats(params);
}

export async function batchGetViewCounts(
  paths: string[],
): Promise<Array<{ path: string; count: number }>> {
  return service.batchGetViewCounts(paths);
}
