"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CronConfig,
  CronHistoryItem,
  CronTrendItem,
  GetCronConfig,
  GetCronHistory,
  GetCronTrends,
  TriggerCron,
  UpdateCronConfig,
} from "@repo/shared-types/api/cron";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/cron-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function triggerCron(
  params: TriggerCron,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronHistoryItem | null>>>;
export async function triggerCron(
  params: TriggerCron,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronHistoryItem | null>>;
export async function triggerCron(
  params0: TriggerCron,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronHistoryItem | null>> {
  return service.triggerCron(params0, serverConfig);
}

export async function getCronHistory(
  params: GetCronHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronHistoryItem[] | null>>>;
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronHistoryItem[] | null>>;
export async function getCronHistory(
  params: GetCronHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronHistoryItem[] | null>> {
  return service.getCronHistory(params, serverConfig);
}

export async function getCronTrends(
  params: GetCronTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronTrendItem[] | null>>>;
export async function getCronTrends(
  params: GetCronTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronTrendItem[] | null>>;
export async function getCronTrends(
  params: GetCronTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronTrendItem[] | null>> {
  return service.getCronTrends(params, serverConfig);
}

export async function getCronConfig(
  params: GetCronConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronConfig | null>>>;
export async function getCronConfig(
  params: GetCronConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronConfig | null>>;
export async function getCronConfig(
  params0: GetCronConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronConfig | null>> {
  return service.getCronConfig(params0, serverConfig);
}

export async function updateCronConfig(
  params: UpdateCronConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CronConfig | null>>>;
export async function updateCronConfig(
  params: UpdateCronConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CronConfig | null>>;
export async function updateCronConfig(
  params0: UpdateCronConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CronConfig | null>> {
  return service.updateCronConfig(params0, serverConfig);
}
