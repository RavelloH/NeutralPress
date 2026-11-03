import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetRecycleBinList,
  GetRecycleBinStats,
  RecycleBinListItem,
  RecycleBinStatsData,
} from "@repo/shared-types/api/recycle-bin";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getRecycleBinList(
  params: GetRecycleBinList = {},
  signal?: AbortSignal,
): Promise<ApiResponse<RecycleBinListItem[] | null>> {
  return fetchPublicRead("/api/public/admin/recycle-bin/list", params, signal);
}
export function getRecycleBinStats(
  params: GetRecycleBinStats = {},
  signal?: AbortSignal,
): Promise<ApiResponse<RecycleBinStatsData | null>> {
  return fetchPublicRead("/api/public/admin/recycle-bin/stats", params, signal);
}
