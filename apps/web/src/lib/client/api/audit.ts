import type {
  AuditLogItem,
  AuditTrendItem,
  GetAuditLogs,
  GetAuditTrends,
} from "@repo/shared-types/api/audit";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

async function request<T extends ApiResponseData>(
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
  if (response.status >= 500) throw new Error("审计日志读取失败");
  return (await response.json()) as ApiResponse<T>;
}

export function getAuditLogs(
  params: GetAuditLogs,
  signal?: AbortSignal,
): Promise<ApiResponse<AuditLogItem[] | null>> {
  const query = new URLSearchParams();
  const allowed: (keyof GetAuditLogs)[] = [
    "page",
    "pageSize",
    "sortBy",
    "sortOrder",
    "id",
    "action",
    "resource",
    "userUid",
    "timestampStart",
    "timestampEnd",
    "startDate",
    "endDate",
    "search",
  ];
  for (const key of allowed) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  return request("/api/public/admin/audit/logs", query, signal);
}

export function getAuditTrends(
  params: GetAuditTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<AuditTrendItem[] | null>> {
  const query = new URLSearchParams();
  for (const key of ["days", "count", "groupBy"] as const) {
    const value = params[key];
    if (value !== undefined) query.set(key, String(value));
  }
  return request("/api/public/admin/audit/trends", query, signal);
}
