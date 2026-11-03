import type { BackupScopeItem } from "@repo/shared-types/api/backup";
import type { ApiResponse } from "@repo/shared-types/api/common";

/** Read public-facing ADMIN API via native fetch; no access token in URLs or payloads. */
export async function getBackupScopes(
  signal?: AbortSignal,
): Promise<ApiResponse<BackupScopeItem[] | null>> {
  const response = await fetch("/api/public/admin/backups/scopes", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });

  if (response.status >= 500) throw new Error("获取备份分组失败");
  return (await response.json()) as ApiResponse<BackupScopeItem[] | null>;
}
