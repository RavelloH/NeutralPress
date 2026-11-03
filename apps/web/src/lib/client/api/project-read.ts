import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetProjectDetail,
  GetProjectsList,
  GetProjectsTrends,
  ProjectDetail,
  ProjectListItem,
  ProjectTrendItem,
} from "@repo/shared-types/api/project";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getProjectsTrends(
  params: GetProjectsTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<ProjectTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/projects/trends", params, signal);
}
export function getProjectsList(
  params: GetProjectsList,
  signal?: AbortSignal,
): Promise<ApiResponse<ProjectListItem[] | null>> {
  return fetchPublicRead("/api/public/admin/projects/list", params, signal);
}
export function getProjectDetail(
  params: GetProjectDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<ProjectDetail | null>> {
  return fetchPublicRead("/api/public/admin/projects/detail", params, signal);
}
