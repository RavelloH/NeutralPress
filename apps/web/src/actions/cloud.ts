"use server";

import type {
  CloudConfig,
  CloudHistoryItem,
  CloudManualSyncResult,
  CloudRemoteStatus,
  CloudTrendItem,
  GetCloudConfig,
  GetCloudHistory,
  GetCloudRemoteStatus,
  GetCloudTrends,
  SyncCloudNow,
  UpdateCloudConfig,
} from "@repo/shared-types/api/cloud";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/cloud-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getCloudConfig(
  params: GetCloudConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudConfig | null>>>;

export async function getCloudConfig(
  params: GetCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudConfig | null>>;

export async function getCloudConfig(
  arg0: GetCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudConfig | null>> {
  return service.getCloudConfig(arg0, serverConfig);
}

export async function updateCloudConfig(
  params: UpdateCloudConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudConfig | null>>>;

export async function updateCloudConfig(
  params: UpdateCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudConfig | null>>;

export async function updateCloudConfig(
  arg0: UpdateCloudConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudConfig | null>> {
  return service.updateCloudConfig(arg0, serverConfig);
}

export async function syncCloudNow(
  params: SyncCloudNow,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudManualSyncResult | null>>>;

export async function syncCloudNow(
  params: SyncCloudNow,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudManualSyncResult | null>>;

export async function syncCloudNow(
  arg0: SyncCloudNow,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudManualSyncResult | null>> {
  return service.syncCloudNow(arg0, serverConfig);
}

export async function getCloudRemoteStatus(
  params: GetCloudRemoteStatus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudRemoteStatus | null>>>;

export async function getCloudRemoteStatus(
  params: GetCloudRemoteStatus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudRemoteStatus | null>>;

export async function getCloudRemoteStatus(
  arg0: GetCloudRemoteStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudRemoteStatus | null>> {
  return service.getCloudRemoteStatus(arg0, serverConfig);
}

export async function getCloudHistory(
  params: GetCloudHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudHistoryItem[] | null>>>;

export async function getCloudHistory(
  params: GetCloudHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudHistoryItem[] | null>>;

export async function getCloudHistory(
  arg0: GetCloudHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudHistoryItem[] | null>> {
  return service.getCloudHistory(arg0, serverConfig);
}

export async function getCloudTrends(
  params: GetCloudTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CloudTrendItem[] | null>>>;

export async function getCloudTrends(
  params: GetCloudTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CloudTrendItem[] | null>>;

export async function getCloudTrends(
  arg0: GetCloudTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CloudTrendItem[] | null>> {
  return service.getCloudTrends(arg0, serverConfig);
}
