import type { ApiResponse } from "@repo/shared-types/api/common";
import type { CronConfig } from "@repo/shared-types/api/cron";

/** Cron job configuration is only available to an authorized ADMIN. */
export async function getCronConfig(
  signal?: AbortSignal,
): Promise<ApiResponse<CronConfig | null>> {
  const response = await fetch("/api/public/admin/cron/config", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("获取 Cron 配置失败");
  return (await response.json()) as ApiResponse<CronConfig | null>;
}
