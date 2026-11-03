import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetMenuDetail,
  GetMenusList,
  GetMenusStats,
  MenuDetail,
  MenuListItem,
  MenusStatsData,
} from "@repo/shared-types/api/menu";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getMenusStats(
  params: GetMenusStats,
  signal?: AbortSignal,
): Promise<ApiResponse<MenusStatsData | null>> {
  return fetchPublicRead("/api/public/admin/menus/stats", params, signal);
}
export function getMenusList(
  params: GetMenusList,
  signal?: AbortSignal,
): Promise<ApiResponse<MenuListItem[] | null>> {
  return fetchPublicRead("/api/public/admin/menus/list", params, signal);
}
export function getMenuDetail(
  params: GetMenuDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<MenuDetail | null>> {
  return fetchPublicRead("/api/public/admin/menus/detail", params, signal);
}
