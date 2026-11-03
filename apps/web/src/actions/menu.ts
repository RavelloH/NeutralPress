"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateMenu,
  CreateMenuResult,
  DeleteMenus,
  DeleteMenusResult,
  GetMenuDetail,
  GetMenusList,
  GetMenusStats,
  MenuDetail,
  MenuListItem,
  MenusStatsData,
  UpdateMenu,
  UpdateMenuResult,
  UpdateMenus,
  UpdateMenusResult,
} from "@repo/shared-types/api/menu";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/menu-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getMenusStats(
  params: GetMenusStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenusStatsData | null>>>;

export async function getMenusStats(
  params: GetMenusStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenusStatsData | null>>;

export async function getMenusStats(
  params: GetMenusStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenusStatsData | null>> {
  return service.getMenusStats(params, serverConfig);
}

export async function getMenusList(
  params: GetMenusList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenuListItem[] | null>>>;

export async function getMenusList(
  params: GetMenusList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenuListItem[] | null>>;

export async function getMenusList(
  params: GetMenusList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenuListItem[] | null>> {
  return service.getMenusList(params, serverConfig);
}

export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MenuDetail | null>>>;

export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MenuDetail | null>>;

export async function getMenuDetail(
  params: GetMenuDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MenuDetail | null>> {
  return service.getMenuDetail(params, serverConfig);
}

export async function createMenu(
  params: CreateMenu,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreateMenuResult | null>>>;

export async function createMenu(
  params: CreateMenu,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreateMenuResult | null>>;

export async function createMenu(
  params: CreateMenu,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreateMenuResult | null>> {
  return service.createMenu(params, serverConfig);
}

export async function updateMenu(
  params: UpdateMenu,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateMenuResult | null>>>;

export async function updateMenu(
  params: UpdateMenu,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateMenuResult | null>>;

export async function updateMenu(
  params: UpdateMenu,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateMenuResult | null>> {
  return service.updateMenu(params, serverConfig);
}

export async function updateMenus(
  params: UpdateMenus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdateMenusResult | null>>>;

export async function updateMenus(
  params: UpdateMenus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdateMenusResult | null>>;

export async function updateMenus(
  params: UpdateMenus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdateMenusResult | null>> {
  return service.updateMenus(params, serverConfig);
}

export async function deleteMenus(
  params: DeleteMenus,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteMenusResult | null>>>;

export async function deleteMenus(
  params: DeleteMenus,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteMenusResult | null>>;

export async function deleteMenus(
  params: DeleteMenus,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteMenusResult | null>> {
  return service.deleteMenus(params, serverConfig);
}
