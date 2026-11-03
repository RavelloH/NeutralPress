"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CheckFriendLinks,
  CheckFriendLinksResult,
  CreateFriendLinkByAdmin,
  CreateFriendLinkByAdminResult,
  DeleteFriendLinkByAdmin,
  DeleteFriendLinkByAdminResult,
  DeleteOwnFriendLink,
  DeleteOwnFriendLinkResult,
  FriendLinkListItem,
  FriendLinksStats,
  FriendLinkTrendItem,
  GetFriendLinkDetail,
  GetFriendLinksList,
  GetFriendLinksStats,
  GetFriendLinksTrends,
  GetOwnFriendLink,
  ParseFriendLinkByAdmin,
  ParseFriendLinkByAdminResult,
  ReviewFriendLink,
  ReviewFriendLinkResult,
  SubmitFriendLinkApplication,
  SubmitFriendLinkApplicationResult,
  UpdateFriendLinkByAdmin,
  UpdateFriendLinkByAdminResult,
  UpdateOwnFriendLink,
  UpdateOwnFriendLinkResult,
} from "@repo/shared-types/api/friendlink";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/friendlink-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SubmitFriendLinkApplicationResult | null>>>;

export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SubmitFriendLinkApplicationResult | null>>;

export async function submitFriendLinkApplication(
  params: SubmitFriendLinkApplication,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SubmitFriendLinkApplicationResult | null>> {
  return service.submitFriendLinkApplication(params, serverConfig);
}

export async function getOwnFriendLink(
  params: GetOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem | null>>>;

export async function getOwnFriendLink(
  params?: GetOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem | null>>;

export async function getOwnFriendLink(
  params: GetOwnFriendLink = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem | null>> {
  return service.getOwnFriendLink(params, serverConfig);
}

export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateOwnFriendLinkResult | null>>>;

export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateOwnFriendLinkResult | null>>;

export async function updateOwnFriendLink(
  params: UpdateOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateOwnFriendLinkResult | null>> {
  return service.updateOwnFriendLink(params, serverConfig);
}

export async function deleteOwnFriendLink(
  params: DeleteOwnFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteOwnFriendLinkResult | null>>>;

export async function deleteOwnFriendLink(
  params?: DeleteOwnFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteOwnFriendLinkResult | null>>;

export async function deleteOwnFriendLink(
  params: DeleteOwnFriendLink = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteOwnFriendLinkResult | null>> {
  return service.deleteOwnFriendLink(params, serverConfig);
}

export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem | null>>>;

export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem | null>>;

export async function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem | null>> {
  return service.getFriendLinkDetail(params, serverConfig);
}

export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateFriendLinkByAdminResult | null>>>;

export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateFriendLinkByAdminResult | null>>;

export async function updateFriendLinkByAdmin(
  params: UpdateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateFriendLinkByAdminResult | null>> {
  return service.updateFriendLinkByAdmin(params, serverConfig);
}

export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteFriendLinkByAdminResult | null>>>;

export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteFriendLinkByAdminResult | null>>;

export async function deleteFriendLinkByAdmin(
  params: DeleteFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteFriendLinkByAdminResult | null>> {
  return service.deleteFriendLinkByAdmin(params, serverConfig);
}

export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ReviewFriendLinkResult | null>>>;

export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ReviewFriendLinkResult | null>>;

export async function reviewFriendLink(
  params: ReviewFriendLink,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ReviewFriendLinkResult | null>> {
  return service.reviewFriendLink(params, serverConfig);
}

export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<ParseFriendLinkByAdminResult | null>>>;

export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ParseFriendLinkByAdminResult | null>>;

export async function parseFriendLinkByAdmin(
  params: ParseFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ParseFriendLinkByAdminResult | null>> {
  return service.parseFriendLinkByAdmin(params, serverConfig);
}

export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateFriendLinkByAdminResult | null>>>;

export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateFriendLinkByAdminResult | null>>;

export async function createFriendLinkByAdmin(
  params: CreateFriendLinkByAdmin,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateFriendLinkByAdminResult | null>> {
  return service.createFriendLinkByAdmin(params, serverConfig);
}

export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinksStats | null>>>;

export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinksStats | null>>;

export async function getFriendLinksStats(
  params: GetFriendLinksStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinksStats | null>> {
  return service.getFriendLinksStats(params, serverConfig);
}

export async function getFriendLinksTrends(
  params: GetFriendLinksTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkTrendItem[] | null>>>;

export async function getFriendLinksTrends(
  params: GetFriendLinksTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkTrendItem[] | null>>;

export async function getFriendLinksTrends(
  arg0: GetFriendLinksTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkTrendItem[] | null>> {
  return service.getFriendLinksTrends(arg0, serverConfig);
}

export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FriendLinkListItem[] | null>>>;

export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FriendLinkListItem[] | null>>;

export async function getFriendLinksList(
  params: GetFriendLinksList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FriendLinkListItem[] | null>> {
  return service.getFriendLinksList(params, serverConfig);
}

export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CheckFriendLinksResult | null>>>;

export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CheckFriendLinksResult | null>>;

export async function checkFriendLinks(
  params: CheckFriendLinks,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CheckFriendLinksResult | null>> {
  return service.checkFriendLinks(params, serverConfig);
}
