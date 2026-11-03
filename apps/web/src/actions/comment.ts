"use server";

import type {
  CommentHistoryPoint,
  CommentItem,
  CommentListResponse,
  CommentsAdminListResponse,
  CommentStats,
  CreateComment,
  DeleteComments,
  DeleteOwnComment,
  DeleteOwnCommentResponse,
  DirectChildrenResponse,
  GetCommentHistory,
  GetCommentReplies,
  GetCommentsAdmin,
  GetCommentStats,
  GetDirectChildren,
  GetPostComments,
  LikeComment,
  LikeCommentResponse,
  UnlikeComment,
  UnlikeCommentResponse,
  UpdateCommentStatus,
} from "@repo/shared-types/api/comment";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/comment-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getPostComments(
  params: GetPostComments,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentListResponse["data"] | null>>>;

export async function getPostComments(
  params: GetPostComments,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentListResponse["data"] | null>>;

export async function getPostComments(
  params: GetPostComments,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentListResponse["data"] | null>> {
  return service.getPostComments(params, serverConfig);
}

export async function getCommentReplies(
  params: GetCommentReplies,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentListResponse["data"] | null>> {
  return service.getCommentReplies(params, serverConfig);
}

export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DirectChildrenResponse["data"] | null>>>;

export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DirectChildrenResponse["data"] | null>>;

export async function getDirectChildren(
  params: GetDirectChildren,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DirectChildrenResponse["data"] | null>> {
  return service.getDirectChildren(params, serverConfig);
}

export async function createComment(
  params: CreateComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentItem | null>> {
  return service.createComment(params, serverConfig);
}

export async function updateCommentStatus(
  params: UpdateCommentStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  return service.updateCommentStatus(params, serverConfig);
}

export async function deleteComments(
  params: DeleteComments,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  return service.deleteComments(params, serverConfig);
}

export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentsAdminListResponse["data"] | null>>>;

export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentsAdminListResponse["data"] | null>>;

export async function getCommentsAdmin(
  params: GetCommentsAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentsAdminListResponse["data"] | null>> {
  return service.getCommentsAdmin(params, serverConfig);
}

export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentHistoryPoint[] | null>>>;

export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentHistoryPoint[] | null>>;

export async function getCommentHistory(
  params: GetCommentHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentHistoryPoint[] | null>> {
  return service.getCommentHistory(params, serverConfig);
}

export async function getCommentStats(
  params: GetCommentStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CommentStats | null>>>;

export async function getCommentStats(
  params: GetCommentStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CommentStats | null>>;

export async function getCommentStats(
  params: GetCommentStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CommentStats | null>> {
  return service.getCommentStats(params, serverConfig);
}

export async function likeComment(
  params: LikeComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<LikeCommentResponse["data"] | null>>>;

export async function likeComment(
  params: LikeComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<LikeCommentResponse["data"] | null>>;

export async function likeComment(
  params: LikeComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<LikeCommentResponse["data"] | null>> {
  return service.likeComment(params, serverConfig);
}

export async function unlikeComment(
  params: UnlikeComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UnlikeCommentResponse["data"] | null>>>;

export async function unlikeComment(
  params: UnlikeComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UnlikeCommentResponse["data"] | null>>;

export async function unlikeComment(
  params: UnlikeComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UnlikeCommentResponse["data"] | null>> {
  return service.unlikeComment(params, serverConfig);
}

export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteOwnCommentResponse["data"] | null>>>;

export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteOwnCommentResponse["data"] | null>>;

export async function deleteOwnComment(
  params: DeleteOwnComment,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteOwnCommentResponse["data"] | null>> {
  return service.deleteOwnComment(params, serverConfig);
}
