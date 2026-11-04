import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetMediaDetail,
  GetMediaList,
  GetMediaStats,
  GetMediaTrends,
  MediaDetail,
  MediaListItem,
  MediaStats,
  MediaTrendItem,
} from "@repo/shared-types/api/media";

import { fetchPublicRead } from "@/lib/client/api/read";
import type { GalleryPhoto } from "@/lib/gallery-layout";
import type {
  BreadcrumbItem,
  FolderItem,
  GetMediaExplorerPageParams,
  MediaExplorerPageData,
} from "@/lib/shared/media-types";

export function getGalleryPhotos(
  params?: { cursorId?: number },
  signal?: AbortSignal,
): Promise<
  ApiResponse<{ photos: GalleryPhoto[]; nextCursor?: number } | null>
> {
  return fetchPublicRead<{
    photos: GalleryPhoto[];
    nextCursor?: number;
  } | null>("/api/public/media/gallery", params, signal);
}

export function getMediaList(
  params: GetMediaList,
  signal?: AbortSignal,
): Promise<ApiResponse<MediaListItem[] | null>> {
  return fetchPublicRead<MediaListItem[] | null>(
    "/api/public/admin/media/list",
    params,
    signal,
  );
}

export function getMediaDetail(
  params: GetMediaDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<MediaDetail | null>> {
  return fetchPublicRead<MediaDetail | null>(
    "/api/public/admin/media/detail",
    params,
    signal,
  );
}

export function getMediaStats(
  params: GetMediaStats,
  signal?: AbortSignal,
): Promise<ApiResponse<MediaStats | null>> {
  return fetchPublicRead<MediaStats | null>(
    "/api/public/admin/media/stats",
    params,
    signal,
  );
}

export function getMediaTrends(
  params: GetMediaTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<MediaTrendItem[] | null>> {
  return fetchPublicRead<MediaTrendItem[] | null>(
    "/api/public/admin/media/trends",
    params,
    signal,
  );
}

export function getAccessibleFolders(
  params: { parentId?: number | null } = {},
  signal?: AbortSignal,
): Promise<ApiResponse<FolderItem[] | null>> {
  return fetchPublicRead<FolderItem[] | null>(
    "/api/public/admin/media/folders",
    params,
    signal,
  );
}

export function getFolderBreadcrumb(
  params: { folderId: number | null },
  signal?: AbortSignal,
): Promise<ApiResponse<BreadcrumbItem[] | null>> {
  return fetchPublicRead<BreadcrumbItem[] | null>(
    "/api/public/admin/media/breadcrumb",
    params,
    signal,
  );
}

export function getMediaExplorerPage(
  params: Omit<GetMediaExplorerPageParams, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<MediaExplorerPageData | null>> {
  return fetchPublicRead<MediaExplorerPageData | null>(
    "/api/public/admin/media/explorer",
    params,
    signal,
  );
}
