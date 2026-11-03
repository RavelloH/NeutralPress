"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  ClearRecycleBin,
  GetRecycleBinList,
  GetRecycleBinStats,
  PurgeRecycleBinItems,
  RecycleBinListItem,
  RecycleBinResourceType,
  RecycleBinStatsData,
  RestoreAllProjectsFromRecycleBin,
  RestoreRecycleBinItems,
} from "@repo/shared-types/api/recycle-bin";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/recycle-bin-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getRecycleBinList(
  params: GetRecycleBinList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RecycleBinListItem[] | null>>>;

export async function getRecycleBinList(
  params?: GetRecycleBinList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RecycleBinListItem[] | null>>;

export async function getRecycleBinList(
  arg0: GetRecycleBinList = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<RecycleBinListItem[] | null>> {
  return service.getRecycleBinList(arg0, serverConfig);
}

export async function getRecycleBinStats(
  params: GetRecycleBinStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RecycleBinStatsData | null>>>;

export async function getRecycleBinStats(
  params?: GetRecycleBinStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RecycleBinStatsData | null>>;

export async function getRecycleBinStats(
  arg0: GetRecycleBinStats = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<RecycleBinStatsData | null>> {
  return service.getRecycleBinStats(arg0, serverConfig);
}

export async function restoreRecycleBinItems(
  params: RestoreRecycleBinItems,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      restored: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;

export async function restoreRecycleBinItems(
  params: RestoreRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    restored: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;

export async function restoreRecycleBinItems(
  arg0: RestoreRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    restored: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  return service.restoreRecycleBinItems(arg0, serverConfig);
}

export async function purgeRecycleBinItems(
  params: PurgeRecycleBinItems,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;

export async function purgeRecycleBinItems(
  params: PurgeRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;

export async function purgeRecycleBinItems(
  arg0: PurgeRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  return service.purgeRecycleBinItems(arg0, serverConfig);
}

export async function restoreAllProjectsFromRecycleBin(
  params: RestoreAllProjectsFromRecycleBin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ restored: number } | null>>>;

export async function restoreAllProjectsFromRecycleBin(
  params?: RestoreAllProjectsFromRecycleBin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ restored: number } | null>>;

export async function restoreAllProjectsFromRecycleBin(
  arg0: RestoreAllProjectsFromRecycleBin = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ restored: number } | null>> {
  return service.restoreAllProjectsFromRecycleBin(arg0, serverConfig);
}

export async function clearRecycleBin(
  params: ClearRecycleBin,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;

export async function clearRecycleBin(
  params?: ClearRecycleBin,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;

export async function clearRecycleBin(
  arg0: ClearRecycleBin = {},
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  return service.clearRecycleBin(arg0, serverConfig);
}
