"use server";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetSystemInfo,
  GetSystemInfoSuccessResponse,
} from "@repo/shared-types/api/system";
import type { NextResponse } from "next/server";

import * as systemdomainService from "@/lib/server/services/system-domain";
type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;
export async function getSystemInfo(
  params: GetSystemInfo,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetSystemInfoSuccessResponse["data"]>>>;

export async function getSystemInfo(
  params: GetSystemInfo,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetSystemInfoSuccessResponse["data"]>>;

export async function getSystemInfo(
  { access_token }: GetSystemInfo,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetSystemInfoSuccessResponse["data"] | null>> {
  return systemdomainService.getSystemInfo({ access_token }, serverConfig);
}
