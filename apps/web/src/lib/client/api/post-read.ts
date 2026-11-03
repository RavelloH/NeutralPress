import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetPostDetail,
  GetPostHistory,
  GetPostsList,
  GetPostsTrends,
  GetPostVersion,
  GetProtectedPostContent,
  PostDetail,
  PostHistoryWithStats,
  PostListItem,
  PostTrendItem,
  PostVersionDetail,
  ProtectedPostContent,
} from "@repo/shared-types/api/post";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getPostsTrends(
  params: GetPostsTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<PostTrendItem[] | null>> {
  return fetchPublicRead<PostTrendItem[] | null>(
    "/api/public/posts/trends",
    params,
    signal,
  );
}

export function getPostsList(
  params: GetPostsList,
  signal?: AbortSignal,
): Promise<ApiResponse<PostListItem[] | null>> {
  return fetchPublicRead<PostListItem[] | null>(
    "/api/public/posts/list",
    params,
    signal,
  );
}

export function getPostDetail(
  params: GetPostDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<PostDetail | null>> {
  return fetchPublicRead<PostDetail | null>(
    "/api/public/posts/detail",
    params,
    signal,
  );
}

export function getPostHistory(
  params: GetPostHistory,
  signal?: AbortSignal,
): Promise<ApiResponse<PostHistoryWithStats | null>> {
  return fetchPublicRead<PostHistoryWithStats | null>(
    "/api/public/posts/history",
    params,
    signal,
  );
}

export function getPostVersion(
  params: GetPostVersion,
  signal?: AbortSignal,
): Promise<ApiResponse<PostVersionDetail | null>> {
  return fetchPublicRead<PostVersionDetail | null>(
    "/api/public/posts/version",
    params,
    signal,
  );
}

export function getProtectedPostContent(
  params: GetProtectedPostContent,
  signal?: AbortSignal,
): Promise<ApiResponse<ProtectedPostContent | null>> {
  return fetchPublicRead<ProtectedPostContent | null>(
    "/api/public/posts/protected-content",
    params,
    signal,
  );
}
