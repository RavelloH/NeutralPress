import type {
  CloudConfig,
  CloudHistoryItem,
  CloudRemoteStatus,
  CloudTrendItem,
  GetCloudHistory,
  GetCloudTrends,
} from "@repo/shared-types/api/cloud";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

import { fetchPublicRead } from "@/lib/client/api/read";

/** The delivery ID filter stays in JSON rather than in CDN/proxy URL logs. */
export async function getCloudHistory(
  params: GetCloudHistory,
  signal?: AbortSignal,
): Promise<ApiResponse<CloudHistoryItem[] | null>> {
  const body = { ...params };
  delete body.access_token;
  const response = await fetch("/api/public/admin/cloud/history", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status >= 500) throw new Error("获取云同步历史失败");
  return (await response.json()) as ApiResponse<CloudHistoryItem[] | null>;
}

export function getCloudTrends(
  params: GetCloudTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<CloudTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/cloud/trends", params, signal);
}

/** Settings and remote status contain private cloud endpoints: native same-origin JSON POST. */
async function cloudPrivatePost<T extends ApiResponseData>(
  operation: "config" | "remote-status",
  signal?: AbortSignal,
): Promise<ApiResponse<T | null>> {
  const response = await fetch("/api/public/admin/cloud/" + operation, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (response.status >= 500) throw new Error("获取云端配置或状态失败");
  return (await response.json()) as ApiResponse<T | null>;
}

export function getCloudConfig(
  signal?: AbortSignal,
): Promise<ApiResponse<CloudConfig | null>> {
  return cloudPrivatePost<CloudConfig>("config", signal);
}

export function getCloudRemoteStatus(
  signal?: AbortSignal,
): Promise<ApiResponse<CloudRemoteStatus | null>> {
  return cloudPrivatePost<CloudRemoteStatus>("remote-status", signal);
}
