"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateStorage,
  CreateStorageResponseWrapper,
  DeleteStorage,
  DeleteStorageResponseWrapper,
  GetStorageDetail,
  GetStorageDetailResponse,
  GetStorageList,
  GetStorageListResponse,
  SetDefaultStorage,
  SetDefaultStorageResponseWrapper,
  ToggleStorageStatus,
  ToggleStorageStatusResponseWrapper,
  UpdateStorage,
  UpdateStorageResponseWrapper,
} from "@repo/shared-types/api/storage";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/storage-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getStorageList(
  params: GetStorageList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageListResponse["data"] | null>>>;

export async function getStorageList(
  params: GetStorageList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageListResponse["data"] | null>>;

export async function getStorageList(
  arg0: GetStorageList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageListResponse["data"] | null>> {
  return service.getStorageList(arg0, serverConfig);
}

export async function getStorageDetail(
  params: GetStorageDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageDetailResponse["data"] | null>>>;

export async function getStorageDetail(
  params: GetStorageDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageDetailResponse["data"] | null>>;

export async function getStorageDetail(
  arg0: GetStorageDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageDetailResponse["data"] | null>> {
  return service.getStorageDetail(arg0, serverConfig);
}

export async function createStorage(
  params: CreateStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<CreateStorageResponseWrapper["data"] | null>>
>;

export async function createStorage(
  params: CreateStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateStorageResponseWrapper["data"] | null>>;

export async function createStorage(
  arg0: CreateStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateStorageResponseWrapper["data"] | null>> {
  return service.createStorage(arg0, serverConfig);
}

export async function updateStorage(
  params: UpdateStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<UpdateStorageResponseWrapper["data"] | null>>
>;

export async function updateStorage(
  params: UpdateStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateStorageResponseWrapper["data"] | null>>;

export async function updateStorage(
  arg0: UpdateStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateStorageResponseWrapper["data"] | null>> {
  return service.updateStorage(arg0, serverConfig);
}

export async function deleteStorage(
  params: DeleteStorage,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<DeleteStorageResponseWrapper["data"] | null>>
>;

export async function deleteStorage(
  params: DeleteStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteStorageResponseWrapper["data"] | null>>;

export async function deleteStorage(
  arg0: DeleteStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteStorageResponseWrapper["data"] | null>> {
  return service.deleteStorage(arg0, serverConfig);
}

export async function toggleStorageStatus(
  params: ToggleStorageStatus,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<ToggleStorageStatusResponseWrapper["data"]>>
>;

export async function toggleStorageStatus(
  params: ToggleStorageStatus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<ToggleStorageStatusResponseWrapper["data"]>>;

export async function toggleStorageStatus(
  arg0: ToggleStorageStatus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<ToggleStorageStatusResponseWrapper["data"] | null>> {
  return service.toggleStorageStatus(arg0, serverConfig);
}

export async function setDefaultStorage(
  params: SetDefaultStorage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SetDefaultStorageResponseWrapper["data"]>>>;

export async function setDefaultStorage(
  params: SetDefaultStorage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SetDefaultStorageResponseWrapper["data"]>>;

export async function setDefaultStorage(
  arg0: SetDefaultStorage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SetDefaultStorageResponseWrapper["data"] | null>> {
  return service.setDefaultStorage(arg0, serverConfig);
}
