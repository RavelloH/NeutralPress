import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetSearchIndexStats,
  GetSearchLogStats,
  SearchIndexStatsResult,
  SearchLogStatsResult,
} from "@repo/shared-types/api/search";

/** Private authenticated GET. Never shared-cache administrator statistics. */
async function requestStats<T extends ApiResponseData>(
  route: string,
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(route, window.location.origin);
  url.search = params.toString();
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok && response.status >= 500) {
    throw new Error("获取搜索统计失败");
  }
  return (await response.json()) as ApiResponse<T>;
}

export function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token"> = {},
  signal?: AbortSignal,
): Promise<ApiResponse<SearchIndexStatsResult | null>> {
  const query = new URLSearchParams();
  if (params.force) query.set("force", "true");
  return requestStats("/api/public/admin/search/index-stats", query, signal);
}

export function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchLogStatsResult | null>> {
  const query = new URLSearchParams();
  if (params.days !== undefined) query.set("days", String(params.days));
  if (params.force) query.set("force", "true");
  return requestStats("/api/public/admin/search/log-stats", query, signal);
}
