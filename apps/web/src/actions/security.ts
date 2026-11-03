"use server";

import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  BanIP,
  ClearRateLimit,
  EndpointStat,
  GetEndpointStats,
  GetIPList,
  GetRequestTrends,
  GetSecurityOverview,
  IPInfo,
  RequestTrendItem,
  SecurityOverviewData,
  UnbanIP,
} from "@repo/shared-types/api/security";

import * as service from "@/lib/server/services/security-domain";

type IPListResponse = {
  items: IPInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type BanIPResponse = { ip: string; bannedUntil: number; reason?: string };

type UnbanIPResponse = { ip: string; unbanned: boolean };

type ClearRateLimitResponse = { ip: string; cleared: boolean };

type EndpointStatsResponse = {
  endpoints: EndpointStat[];
  totalRequests: number;
  timeRange: { start: number; end: number };
};

export async function getSecurityOverview(
  params: GetSecurityOverview = {},
): Promise<ApiResponse<SecurityOverviewData | null>> {
  return service.getSecurityOverview(params);
}

export async function getIPList(
  params: GetIPList,
): Promise<ApiResponse<IPListResponse | null>> {
  return service.getIPList(params);
}

export async function banIP(
  params: BanIP,
): Promise<ApiResponse<BanIPResponse | null>> {
  return service.banIP(params);
}

export async function unbanIP(
  params: UnbanIP,
): Promise<ApiResponse<UnbanIPResponse | null>> {
  return service.unbanIP(params);
}

export async function clearRateLimit(
  params: ClearRateLimit,
): Promise<ApiResponse<ClearRateLimitResponse | null>> {
  return service.clearRateLimit(params);
}

export async function getEndpointStats(
  params: GetEndpointStats,
): Promise<ApiResponse<EndpointStatsResponse | null>> {
  return service.getEndpointStats(params);
}

export async function getRequestTrends(
  params: GetRequestTrends,
): Promise<ApiResponse<RequestTrendItem[] | null>> {
  return service.getRequestTrends(params);
}
