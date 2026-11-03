import type {
  CommentHistoryPoint,
  CommentListResponse,
  CommentsAdminListResponse,
  CommentStats,
  DirectChildrenResponse,
  GetCommentHistory,
  GetCommentReplies,
  GetCommentsAdmin,
  GetCommentStats,
  GetDirectChildren,
  GetPostComments,
} from "@repo/shared-types/api/comment";
import type { ApiResponse } from "@repo/shared-types/api/common";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getPostComments(
  params: GetPostComments,
  signal?: AbortSignal,
): Promise<ApiResponse<CommentListResponse["data"] | null>> {
  return fetchPublicRead<CommentListResponse["data"] | null>(
    "/api/public/comments/post",
    params,
    signal,
  );
}

export function getCommentReplies(
  params: GetCommentReplies,
  signal?: AbortSignal,
): Promise<ApiResponse<CommentListResponse["data"] | null>> {
  return fetchPublicRead<CommentListResponse["data"] | null>(
    "/api/public/comments/replies",
    params,
    signal,
  );
}

export function getDirectChildren(
  params: GetDirectChildren,
  signal?: AbortSignal,
): Promise<ApiResponse<DirectChildrenResponse["data"] | null>> {
  return fetchPublicRead<DirectChildrenResponse["data"] | null>(
    "/api/public/comments/children",
    params,
    signal,
  );
}

export function getCommentsAdmin(
  params: GetCommentsAdmin,
  signal?: AbortSignal,
): Promise<ApiResponse<CommentsAdminListResponse["data"] | null>> {
  return fetchPublicRead<CommentsAdminListResponse["data"] | null>(
    "/api/public/admin/comments/list",
    params,
    signal,
  );
}

export function getCommentHistory(
  params: GetCommentHistory,
  signal?: AbortSignal,
): Promise<ApiResponse<CommentHistoryPoint[] | null>> {
  return fetchPublicRead<CommentHistoryPoint[] | null>(
    "/api/public/admin/comments/history",
    params,
    signal,
  );
}

export function getCommentStats(
  params: GetCommentStats,
  signal?: AbortSignal,
): Promise<ApiResponse<CommentStats | null>> {
  return fetchPublicRead<CommentStats | null>(
    "/api/public/admin/comments/stats",
    params,
    signal,
  );
}
