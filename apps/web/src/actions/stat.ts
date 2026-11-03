"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetPagesStats,
  GetPagesStatsSuccessResponse,
} from "@repo/shared-types/api/page";
import type {
  GetAuditStats,
  GetAuditStatsSuccessResponse,
  GetCategoriesStats,
  GetCategoriesStatsSuccessResponse,
  GetPostsStats,
  GetPostsStatsSuccessResponse,
  GetProjectsStats,
  GetProjectsStatsSuccessResponse,
  GetTagsStats,
  GetTagsStatsSuccessResponse,
  GetUsersStats,
  GetUsersStatsSuccessResponse,
  GetVisitStats,
  GetVisitStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import type {
  GetStorageStats,
  GetStorageStatsSuccessResponse,
} from "@repo/shared-types/api/storage";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/stats";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getUsersStats(
  params: GetUsersStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetUsersStatsSuccessResponse["data"]>>>;
export async function getUsersStats(
  params: GetUsersStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetUsersStatsSuccessResponse["data"]>>;
export async function getUsersStats(
  params: GetUsersStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetUsersStatsSuccessResponse["data"] | null>> {
  return service.getUsersStats(params, serverConfig);
}

export async function getAuditStats(
  params: GetAuditStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetAuditStatsSuccessResponse["data"]>>>;
export async function getAuditStats(
  params: GetAuditStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetAuditStatsSuccessResponse["data"]>>;
export async function getAuditStats(
  params: GetAuditStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetAuditStatsSuccessResponse["data"] | null>> {
  return service.getAuditStats(params, serverConfig);
}

export async function getPostsStats(
  params: GetPostsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetPostsStatsSuccessResponse["data"]>>>;
export async function getPostsStats(
  params: GetPostsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetPostsStatsSuccessResponse["data"]>>;
export async function getPostsStats(
  params: GetPostsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetPostsStatsSuccessResponse["data"] | null>> {
  return service.getPostsStats(params, serverConfig);
}

export async function getTagsStats(
  params: GetTagsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetTagsStatsSuccessResponse["data"]>>>;
export async function getTagsStats(
  params: GetTagsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetTagsStatsSuccessResponse["data"]>>;
export async function getTagsStats(
  params: GetTagsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetTagsStatsSuccessResponse["data"] | null>> {
  return service.getTagsStats(params, serverConfig);
}

export async function getCategoriesStats(
  params: GetCategoriesStats,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<GetCategoriesStatsSuccessResponse["data"]>>
>;
export async function getCategoriesStats(
  params: GetCategoriesStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetCategoriesStatsSuccessResponse["data"]>>;
export async function getCategoriesStats(
  params: GetCategoriesStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetCategoriesStatsSuccessResponse["data"] | null>> {
  return service.getCategoriesStats(params, serverConfig);
}

export async function getPagesStats(
  params: GetPagesStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetPagesStatsSuccessResponse["data"]>>>;
export async function getPagesStats(
  params: GetPagesStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetPagesStatsSuccessResponse["data"]>>;
export async function getPagesStats(
  params: GetPagesStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetPagesStatsSuccessResponse["data"] | null>> {
  return service.getPagesStats(params, serverConfig);
}

export async function getStorageStats(
  params: GetStorageStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageStatsSuccessResponse["data"]>>>;
export async function getStorageStats(
  params: GetStorageStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageStatsSuccessResponse["data"]>>;
export async function getStorageStats(
  params: GetStorageStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageStatsSuccessResponse["data"] | null>> {
  return service.getStorageStats(params, serverConfig);
}

export async function getVisitStats(
  params: GetVisitStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetVisitStatsSuccessResponse["data"]>>>;
export async function getVisitStats(
  params: GetVisitStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetVisitStatsSuccessResponse["data"]>>;
export async function getVisitStats(
  params: GetVisitStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetVisitStatsSuccessResponse["data"] | null>> {
  return service.getVisitStats(params, serverConfig);
}

export async function getProjectsStats(
  params: GetProjectsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetProjectsStatsSuccessResponse["data"]>>>;
export async function getProjectsStats(
  params: GetProjectsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetProjectsStatsSuccessResponse["data"]>>;
export async function getProjectsStats(
  params: GetProjectsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetProjectsStatsSuccessResponse["data"] | null>> {
  return service.getProjectsStats(params, serverConfig);
}
