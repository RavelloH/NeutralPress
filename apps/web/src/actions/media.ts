"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  BatchUpdateMedia,
  DeleteMedia,
  GetMediaDetail,
  GetMediaList,
  GetMediaStats,
  GetMediaTrends,
  MediaDetail,
  MediaListItem,
  MediaStats,
  MediaTrendItem,
  UpdateMedia,
} from "@repo/shared-types/api/media";
import type { NextResponse } from "next/server";

import type { GalleryPhoto } from "@/lib/gallery-layout";
import * as service from "@/lib/server/services/media-domain";
import type {
  BreadcrumbItem,
  CreateFolderParams,
  DeleteFoldersParams,
  DeleteFoldersResult,
  EnsureUserHomeFolderParams,
  FolderItem,
  GetAccessibleFoldersParams,
  GetFolderBreadcrumbParams,
  GetMediaExplorerPageParams,
  MediaExplorerPageData,
  MoveItemsParams,
  MoveItemsResult,
} from "@/lib/shared/media-types";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getGalleryPhotos(
  params: { cursorId?: number },
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{ photos: GalleryPhoto[]; nextCursor?: number } | null>
  >
>;

export async function getGalleryPhotos(
  params?: { cursorId?: number },
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ photos: GalleryPhoto[]; nextCursor?: number } | null>>;

export async function getGalleryPhotos(
  params: { cursorId?: number } = {},
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{ photos: GalleryPhoto[]; nextCursor?: number } | null>
> {
  return service.getGalleryPhotos(params, serverConfig);
}

export async function getMediaList(
  params: GetMediaList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaListItem[] | null>>>;

export async function getMediaList(
  params: GetMediaList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaListItem[] | null>>;

export async function getMediaList(
  params: GetMediaList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaListItem[] | null>> {
  return service.getMediaList(params, serverConfig);
}

export async function getMediaDetail(
  params: GetMediaDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaDetail | null>>>;

export async function getMediaDetail(
  params: GetMediaDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaDetail | null>>;

export async function getMediaDetail(
  params: GetMediaDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaDetail | null>> {
  return service.getMediaDetail(params, serverConfig);
}

export async function updateMedia(
  params: UpdateMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      originalName: string;
      altText: string | null;
      persistentPath: string | null;
      inGallery: boolean;
      updatedAt: string;
    } | null>
  >
>;

export async function updateMedia(
  params: UpdateMedia,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    originalName: string;
    altText: string | null;
    persistentPath: string | null;
    inGallery: boolean;
    updatedAt: string;
  } | null>
>;

export async function updateMedia(
  params: UpdateMedia,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    originalName: string;
    altText: string | null;
    persistentPath: string | null;
    inGallery: boolean;
    updatedAt: string;
  } | null>
> {
  return service.updateMedia(params, serverConfig);
}

export async function batchUpdateMedia(
  params: BatchUpdateMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ updated: number; ids: number[] } | null>>
>;

export async function batchUpdateMedia(
  params: BatchUpdateMedia,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number; ids: number[] } | null>>;

export async function batchUpdateMedia(
  params: BatchUpdateMedia,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number; ids: number[] } | null>> {
  return service.batchUpdateMedia(params, serverConfig);
}

export async function deleteMedia(
  params: DeleteMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ deleted: number; ids: number[] } | null>>
>;

export async function deleteMedia(
  params: DeleteMedia,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number; ids: number[] } | null>>;

export async function deleteMedia(
  params: DeleteMedia,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number; ids: number[] } | null>> {
  return service.deleteMedia(params, serverConfig);
}

export async function getMediaStats(
  params: GetMediaStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaStats | null>>>;

export async function getMediaStats(
  params: GetMediaStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaStats | null>>;

export async function getMediaStats(
  params: GetMediaStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaStats | null>> {
  return service.getMediaStats(params, serverConfig);
}

export async function getMediaTrends(
  params: GetMediaTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaTrendItem[] | null>>>;

export async function getMediaTrends(
  params: GetMediaTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaTrendItem[] | null>>;

export async function getMediaTrends(
  params: GetMediaTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaTrendItem[] | null>> {
  return service.getMediaTrends(params, serverConfig);
}

export async function getAccessibleFolders(
  params: GetAccessibleFoldersParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem[] | null>>>;

export async function getAccessibleFolders(
  params: GetAccessibleFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem[] | null>>;

export async function getAccessibleFolders(
  params: GetAccessibleFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem[] | null>> {
  return service.getAccessibleFolders(params, serverConfig);
}

export async function getFolderBreadcrumb(
  params: GetFolderBreadcrumbParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<BreadcrumbItem[] | null>>>;

export async function getFolderBreadcrumb(
  params: GetFolderBreadcrumbParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<BreadcrumbItem[] | null>>;

export async function getFolderBreadcrumb(
  params: GetFolderBreadcrumbParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<BreadcrumbItem[] | null>> {
  return service.getFolderBreadcrumb(params, serverConfig);
}

export async function getMediaExplorerPage(
  params: GetMediaExplorerPageParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaExplorerPageData | null>>>;

export async function getMediaExplorerPage(
  params: GetMediaExplorerPageParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaExplorerPageData | null>>;

export async function getMediaExplorerPage(
  params: GetMediaExplorerPageParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaExplorerPageData | null>> {
  return service.getMediaExplorerPage(params, serverConfig);
}

export async function createFolder(
  params: CreateFolderParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem | null>>>;

export async function createFolder(
  params: CreateFolderParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem | null>>;

export async function createFolder(
  params: CreateFolderParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem | null>> {
  return service.createFolder(params, serverConfig);
}

export async function ensureUserHomeFolder(
  params: EnsureUserHomeFolderParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem | null>>>;

export async function ensureUserHomeFolder(
  params: EnsureUserHomeFolderParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem | null>>;

export async function ensureUserHomeFolder(
  params: EnsureUserHomeFolderParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem | null>> {
  return service.ensureUserHomeFolder(params, serverConfig);
}

export async function moveItems(
  params: MoveItemsParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MoveItemsResult | null>>>;

export async function moveItems(
  params: MoveItemsParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MoveItemsResult | null>>;

export async function moveItems(
  params: MoveItemsParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MoveItemsResult | null>> {
  return service.moveItems(params, serverConfig);
}

export async function deleteFolders(
  params: DeleteFoldersParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteFoldersResult | null>>>;

export async function deleteFolders(
  params: DeleteFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteFoldersResult | null>>;

export async function deleteFolders(
  params: DeleteFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteFoldersResult | null>> {
  return service.deleteFolders(params, serverConfig);
}

export type {
  UploadMediaFile,
  UploadMediaParams,
  UploadMediaResult,
  FolderItem,
  BreadcrumbItem,
  GetAccessibleFoldersParams,
  GetFolderBreadcrumbParams,
  EnsureUserHomeFolderParams,
  GetMediaExplorerPageParams,
  MediaExplorerPageData,
  CreateFolderParams,
  MoveItemsParams,
  MoveItemsResult,
  DeleteFoldersParams,
  DeleteFoldersResult,
} from "@/lib/shared/media-types";
