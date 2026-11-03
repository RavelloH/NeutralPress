"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  Doctor,
  DoctorHistoryItem,
  DoctorSuccessResponse,
  DoctorTrendItem,
  GetDoctorHistory,
  GetDoctorTrends,
} from "@repo/shared-types/api/doctor";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/doctor-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function doctor(
  params: Doctor,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorSuccessResponse["data"]>>>;

export async function doctor(
  params: Doctor,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorSuccessResponse["data"]>>;

export async function doctor(
  arg0: Doctor,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorSuccessResponse["data"] | null>> {
  return service.doctor(arg0, serverConfig);
}

export async function getDoctorHistory(
  params: GetDoctorHistory,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorHistoryItem[] | null>>>;

export async function getDoctorHistory(
  params: GetDoctorHistory,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorHistoryItem[] | null>>;

export async function getDoctorHistory(
  arg0: GetDoctorHistory,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorHistoryItem[] | null>> {
  return service.getDoctorHistory(arg0, serverConfig);
}

export async function getDoctorTrends(
  params: GetDoctorTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DoctorTrendItem[] | null>>>;

export async function getDoctorTrends(
  params: GetDoctorTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DoctorTrendItem[] | null>>;

export async function getDoctorTrends(
  arg0: GetDoctorTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DoctorTrendItem[] | null>> {
  return service.getDoctorTrends(arg0, serverConfig);
}
