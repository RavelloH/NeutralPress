import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CronHistoryItem,
  CronTrendItem,
  GetCronHistory,
  GetCronTrends,
} from "@repo/shared-types/api/cron";

async function get<T extends ApiResponseData>(
  path: string,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(path, window.location.origin);
  url.search = query.toString();
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("读取计划任务记录失败");
  return (await response.json()) as ApiResponse<T>;
}

export function getCronHistory(
  params: GetCronHistory,
  signal?: AbortSignal,
): Promise<ApiResponse<CronHistoryItem[] | null>> {
  const query = new URLSearchParams();
  for (const key of [
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "id",
    "status",
    "triggerType",
    "createdAtStart",
    "createdAtEnd",
  ] as const) {
    const value = params[key];
    if (value !== undefined && value !== null) query.set(key, String(value));
  }
  return get("/api/public/admin/cron/history", query, signal);
}

export function getCronTrends(
  params: GetCronTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<CronTrendItem[] | null>> {
  const query = new URLSearchParams();
  if (params.days !== undefined) query.set("days", String(params.days));
  if (params.count !== undefined) query.set("count", String(params.count));
  return get("/api/public/admin/cron/trends", query, signal);
}
