import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetStorageDetail,
  GetStorageDetailResponse,
  GetStorageList,
  GetStorageListResponse,
} from "@repo/shared-types/api/storage";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getStorageList(
  params: GetStorageList,
  signal?: AbortSignal,
): Promise<ApiResponse<GetStorageListResponse["data"] | null>> {
  return fetchPublicRead("/api/public/admin/storages/list", params, signal);
}
export function getStorageDetail(
  params: GetStorageDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<GetStorageDetailResponse["data"] | null>> {
  return fetchPublicRead("/api/public/admin/storages/detail", params, signal);
}
