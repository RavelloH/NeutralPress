import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  EndpointStat,
  GetEndpointStats,
  GetIPList,
  GetRequestTrends,
  GetSecurityOverview,
  IPInfo,
  RequestTrendItem,
  SecurityOverviewData,
} from "@repo/shared-types/api/security";

import { fetchPublicRead } from "@/lib/client/api/read";

type IPListData = {
  items: IPInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type EndpointStatsData = {
  endpoints: EndpointStat[];
  totalRequests: number;
  timeRange: { start: number; end: number };
};

type WithoutToken<T> = Omit<T, "access_token">;

export function getSecurityOverview(
  params: WithoutToken<GetSecurityOverview> = {},
  signal?: AbortSignal,
): Promise<ApiResponse<SecurityOverviewData | null>> {
  return fetchPublicRead("/api/public/admin/security/overview", params, signal);
}

/** IP addresses and search filters never appear in the request URL. */
export async function getIPList(
  params: WithoutToken<GetIPList>,
  signal?: AbortSignal,
): Promise<ApiResponse<IPListData | null>> {
  const response = await fetch("/api/public/admin/security/ips", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (response.status >= 500) throw new Error("获取 IP 列表失败");
  return (await response.json()) as ApiResponse<IPListData | null>;
}

export function getEndpointStats(
  params: WithoutToken<GetEndpointStats>,
  signal?: AbortSignal,
): Promise<ApiResponse<EndpointStatsData | null>> {
  return fetchPublicRead(
    "/api/public/admin/security/endpoints",
    params,
    signal,
  );
}

export function getRequestTrends(
  params: WithoutToken<GetRequestTrends>,
  signal?: AbortSignal,
): Promise<ApiResponse<RequestTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/security/trends", params, signal);
}
