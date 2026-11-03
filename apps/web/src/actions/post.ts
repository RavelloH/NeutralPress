"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreatePost,
  CreatePostResult,
  DeletePosts,
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
  ResetPostToVersion,
  ResetPostToVersionResult,
  SquashPostToVersion,
  SquashPostToVersionResult,
  UnlockProtectedPost,
  UpdatePost,
  UpdatePostResult,
  UpdatePosts,
} from "@repo/shared-types/api/post";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/post-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getPostsTrends(
  params: GetPostsTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostTrendItem[] | null>>>;

export async function getPostsTrends(
  params: GetPostsTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostTrendItem[] | null>>;

export async function getPostsTrends(
  params: GetPostsTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostTrendItem[] | null>> {
  return service.getPostsTrends(params, serverConfig);
}

export async function getPostsList(
  params: GetPostsList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostListItem[] | null>>>;

export async function getPostsList(
  params: GetPostsList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostListItem[] | null>>;

export async function getPostsList(
  params: GetPostsList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostListItem[] | null>> {
  return service.getPostsList(params, serverConfig);
}

export async function getPostDetail(
  params: GetPostDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostDetail | null>>>;

export async function getPostDetail(
  params: GetPostDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostDetail | null>>;

export async function getPostDetail(
  params: GetPostDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostDetail | null>> {
  return service.getPostDetail(params, serverConfig);
}

export async function unlockProtectedPost(
  params: UnlockProtectedPost,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<null>>>;

export async function unlockProtectedPost(
  params: UnlockProtectedPost,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<null>>;

export async function unlockProtectedPost(
  params: UnlockProtectedPost,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  return service.unlockProtectedPost(params, serverConfig);
}

export async function getProtectedPostContent(
  params: GetProtectedPostContent,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ProtectedPostContent | null>>>;

export async function getProtectedPostContent(
  params: GetProtectedPostContent,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ProtectedPostContent | null>>;

export async function getProtectedPostContent(
  params: GetProtectedPostContent,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ProtectedPostContent | null>> {
  return service.getProtectedPostContent(params, serverConfig);
}

export async function createPost(
  params: CreatePost,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreatePostResult | null>>>;

export async function createPost(
  params: CreatePost,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreatePostResult | null>>;

export async function createPost(
  params: CreatePost,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreatePostResult | null>> {
  return service.createPost(params, serverConfig);
}

export async function updatePost(
  params: UpdatePost,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdatePostResult | null>>>;

export async function updatePost(
  params: UpdatePost,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdatePostResult | null>>;

export async function updatePost(
  params: UpdatePost,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdatePostResult | null>> {
  return service.updatePost(params, serverConfig);
}

export async function updatePosts(
  params: UpdatePosts,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;

export async function updatePosts(
  params: UpdatePosts,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;

export async function updatePosts(
  params: UpdatePosts,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  return service.updatePosts(params, serverConfig);
}

export async function deletePosts(
  params: DeletePosts,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;

export async function deletePosts(
  params: DeletePosts,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;

export async function deletePosts(
  params: DeletePosts,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  return service.deletePosts(params, serverConfig);
}

export async function getPostHistory(
  params: GetPostHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostHistoryWithStats | null>>>;

export async function getPostHistory(
  params: GetPostHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostHistoryWithStats | null>>;

export async function getPostHistory(
  params: GetPostHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostHistoryWithStats | null>> {
  return service.getPostHistory(params, serverConfig);
}

export async function getPostVersion(
  params: GetPostVersion,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PostVersionDetail | null>>>;

export async function getPostVersion(
  params: GetPostVersion,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PostVersionDetail | null>>;

export async function getPostVersion(
  params: GetPostVersion,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PostVersionDetail | null>> {
  return service.getPostVersion(params, serverConfig);
}

export async function resetPostToVersion(
  params: ResetPostToVersion,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ResetPostToVersionResult | null>>>;

export async function resetPostToVersion(
  params: ResetPostToVersion,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ResetPostToVersionResult | null>>;

export async function resetPostToVersion(
  params: ResetPostToVersion,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ResetPostToVersionResult | null>> {
  return service.resetPostToVersion(params, serverConfig);
}

export async function squashPostToVersion(
  params: SquashPostToVersion,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SquashPostToVersionResult | null>>>;

export async function squashPostToVersion(
  params: SquashPostToVersion,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SquashPostToVersionResult | null>>;

export async function squashPostToVersion(
  params: SquashPostToVersion,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SquashPostToVersionResult | null>> {
  return service.squashPostToVersion(params, serverConfig);
}
