"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetNoticesSuccessResponse,
  GetUnreadNoticeCountSuccessResponse,
  MarkAllNoticesAsReadSuccessResponse,
  MarkNoticesAsReadSuccessResponse,
} from "@repo/shared-types/api/notice";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/notice-domain";

type NoticeActionEnvironment = "serverless" | "serveraction";

type NoticeActionConfig = { environment?: NoticeActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getNotices(
  readLimit: number,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetNoticesSuccessResponse["data"]>>>;
export async function getNotices(
  readLimit?: number,
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<GetNoticesSuccessResponse["data"]>>;
export async function getNotices(
  readLimit?: number | NoticeActionConfig,
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<GetNoticesSuccessResponse["data"] | null>> {
  if (typeof readLimit === "object") {
    return service.getNotices(undefined, readLimit);
  }
  return service.getNotices(readLimit, serverConfig);
}

export async function getReadNotices(
  skip: number,
  limit: number,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetNoticesSuccessResponse["data"]>>>;
export async function getReadNotices(
  skip: number,
  limit?: number,
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<GetNoticesSuccessResponse["data"]>>;
export async function getReadNotices(
  skip: number,
  limit?: number | NoticeActionConfig,
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<GetNoticesSuccessResponse["data"] | null>> {
  if (typeof limit === "object") {
    return service.getReadNotices(skip, undefined, limit);
  }
  return service.getReadNotices(skip, limit, serverConfig);
}

export async function markNoticesAsRead(
  noticeIds: string[],
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MarkNoticesAsReadSuccessResponse["data"]>>>;
export async function markNoticesAsRead(
  noticeIds: string[],
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<MarkNoticesAsReadSuccessResponse["data"]>>;
export async function markNoticesAsRead(
  noticeIds: string[],
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<MarkNoticesAsReadSuccessResponse["data"] | null>> {
  return service.markNoticesAsRead(noticeIds, serverConfig);
}

export async function markAllNoticesAsRead(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<ApiResponse<MarkAllNoticesAsReadSuccessResponse["data"]>>
>;
export async function markAllNoticesAsRead(
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<MarkAllNoticesAsReadSuccessResponse["data"]>>;
export async function markAllNoticesAsRead(
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<MarkAllNoticesAsReadSuccessResponse["data"] | null>> {
  return service.markAllNoticesAsRead(serverConfig);
}

export async function getUnreadNoticeCount(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<ApiResponse<GetUnreadNoticeCountSuccessResponse["data"]>>
>;
export async function getUnreadNoticeCount(
  serverConfig?: NoticeActionConfig,
): Promise<ApiResponse<GetUnreadNoticeCountSuccessResponse["data"]>>;
export async function getUnreadNoticeCount(
  serverConfig?: NoticeActionConfig,
): Promise<ActionResult<GetUnreadNoticeCountSuccessResponse["data"] | null>> {
  return service.getUnreadNoticeCount(serverConfig);
}
