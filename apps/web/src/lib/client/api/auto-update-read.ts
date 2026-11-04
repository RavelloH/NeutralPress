import type {
  AutoUpdateOverview,
  RuntimeVersionInfo,
} from "@repo/shared-types/api/auto-update";
import type { ApiResponse } from "@repo/shared-types/api/common";

/**
 * Includes repository PAT in the existing ADMIN response.
 * POST + strict same-origin + no-store are required; never serialize the response to a URL.
 */
export async function getAutoUpdateOverview(
  signal?: AbortSignal,
): Promise<ApiResponse<AutoUpdateOverview | null>> {
  const response = await fetch("/api/public/admin/auto-update/overview", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (response.status >= 500) throw new Error("获取自动更新概览失败");
  return (await response.json()) as ApiResponse<AutoUpdateOverview | null>;
}

/** Runtime poll is readonly, but must preserve ADMIN authentication. */
export async function getRuntimeVersionInfo(
  signal?: AbortSignal,
): Promise<ApiResponse<RuntimeVersionInfo | null>> {
  const response = await fetch("/api/public/admin/auto-update/runtime", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("获取运行时版本信息失败");
  return (await response.json()) as ApiResponse<RuntimeVersionInfo | null>;
}
