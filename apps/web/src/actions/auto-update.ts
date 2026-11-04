"use server";

import type {
  AutoUpdateConfig,
  AutoUpdateOverview,
  GetAutoUpdateOverview,
  GetRuntimeVersionInfo,
  RuntimeVersionInfo,
  TriggerAutoUpdate,
  TriggerAutoUpdateResult,
  UpdateAutoUpdateConfig,
} from "@repo/shared-types/api/auto-update";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/auto-update-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getAutoUpdateOverview(
  params: GetAutoUpdateOverview,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AutoUpdateOverview | null>>>;
export async function getAutoUpdateOverview(
  params: GetAutoUpdateOverview,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AutoUpdateOverview | null>>;
export async function getAutoUpdateOverview(
  params0: GetAutoUpdateOverview,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AutoUpdateOverview | null>> {
  return service.getAutoUpdateOverview(params0, serverConfig);
}

export async function updateAutoUpdateConfig(
  params: UpdateAutoUpdateConfig,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AutoUpdateConfig | null>>>;
export async function updateAutoUpdateConfig(
  params: UpdateAutoUpdateConfig,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AutoUpdateConfig | null>>;
export async function updateAutoUpdateConfig(
  params0: UpdateAutoUpdateConfig,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AutoUpdateConfig | null>> {
  return service.updateAutoUpdateConfig(params0, serverConfig);
}

export async function triggerAutoUpdate(
  params: TriggerAutoUpdate,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TriggerAutoUpdateResult | null>>>;
export async function triggerAutoUpdate(
  params: TriggerAutoUpdate,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TriggerAutoUpdateResult | null>>;
export async function triggerAutoUpdate(
  params0: TriggerAutoUpdate,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TriggerAutoUpdateResult | null>> {
  return service.triggerAutoUpdate(params0, serverConfig);
}

export async function getRuntimeVersionInfo(
  params: GetRuntimeVersionInfo,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RuntimeVersionInfo | null>>>;
export async function getRuntimeVersionInfo(
  params: GetRuntimeVersionInfo,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RuntimeVersionInfo | null>>;
export async function getRuntimeVersionInfo(
  params0: GetRuntimeVersionInfo,
  serverConfig?: ActionConfig,
): Promise<ActionResult<RuntimeVersionInfo | null>> {
  return service.getRuntimeVersionInfo(params0, serverConfig);
}
