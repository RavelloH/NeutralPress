import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetPagesStats,
  GetPagesStatsSuccessResponse,
} from "@repo/shared-types/api/page";
import type {
  GetUsersStats,
  GetUsersStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetAuditStats,
  GetAuditStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetPostsStats,
  GetPostsStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetTagsStats,
  GetTagsStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetCategoriesStats,
  GetCategoriesStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetVisitStats,
  GetVisitStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetProjectsStats,
  GetProjectsStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetStorageStats,
  GetStorageStatsSuccessResponse,
} from "@repo/shared-types/api/storage";

async function requestStats<T extends ApiResponseData>(
  metric: string,
  force = false,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(
    "/api/public/admin/stats/" + metric,
    window.location.origin,
  );
  if (force) url.searchParams.set("force", "true");
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok && response.status >= 500)
    throw new Error("读取后台统计失败");
  return (await response.json()) as ApiResponse<T>;
}

export function getUsersStats(
  params: GetUsersStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetUsersStatsSuccessResponse["data"]>> {
  return requestStats("users", params.force ?? false, signal);
}

export function getAuditStats(
  params: GetAuditStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetAuditStatsSuccessResponse["data"]>> {
  return requestStats("audit", params.force ?? false, signal);
}

export function getPostsStats(
  params: GetPostsStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetPostsStatsSuccessResponse["data"]>> {
  return requestStats("posts", params.force ?? false, signal);
}

export function getTagsStats(
  params: GetTagsStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetTagsStatsSuccessResponse["data"]>> {
  return requestStats("tags", params.force ?? false, signal);
}

export function getCategoriesStats(
  params: GetCategoriesStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetCategoriesStatsSuccessResponse["data"]>> {
  return requestStats("categories", params.force ?? false, signal);
}

export function getPagesStats(
  params: GetPagesStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetPagesStatsSuccessResponse["data"]>> {
  return requestStats("pages", params.force ?? false, signal);
}

export function getStorageStats(
  params: GetStorageStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetStorageStatsSuccessResponse["data"]>> {
  return requestStats("storage", params.force ?? false, signal);
}

export function getVisitStats(
  params: GetVisitStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetVisitStatsSuccessResponse["data"]>> {
  return requestStats("visit", params.force ?? false, signal);
}

export function getProjectsStats(
  params: GetProjectsStats,
  signal?: AbortSignal,
): Promise<ApiResponse<GetProjectsStatsSuccessResponse["data"]>> {
  return requestStats("projects", params.force ?? false, signal);
}
