"use server";

import type {
  AuditLogItem,
  AuditTrendItem,
  GetAuditLogs,
  GetAuditTrends,
} from "@repo/shared-types/api/audit";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import {
  getAuditLogs as getAuditLogsService,
  getAuditTrends as getAuditTrendsService,
} from "@/lib/server/services/audit";

type ActionConfig = { environment?: "serverless" | "serveraction" };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getAuditLogs(
  params: GetAuditLogs,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AuditLogItem[] | null>>>;
export async function getAuditLogs(
  params: GetAuditLogs,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AuditLogItem[] | null>>;
export async function getAuditLogs(
  params: GetAuditLogs,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AuditLogItem[] | null>> {
  return getAuditLogsService(params, serverConfig);
}

export async function getAuditTrends(
  params: GetAuditTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<AuditTrendItem[] | null>>>;
export async function getAuditTrends(
  params: GetAuditTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<AuditTrendItem[] | null>>;
export async function getAuditTrends(
  params: GetAuditTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<AuditTrendItem[] | null>> {
  return getAuditTrendsService(params, serverConfig);
}
