"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreatePage,
  CreatePageResult,
  DeletePages,
  GetPageDetail,
  GetPagesList,
  PageDetail,
  PageListItem,
  UpdatePage,
  UpdatePageResult,
  UpdatePages,
} from "@repo/shared-types/api/page";
import type { NextResponse } from "next/server";

import type {
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import * as service from "@/lib/server/services/page-domain";

type ActionEnvironment = "serverless" | "serveraction";

type ActionConfig = { environment?: ActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getPagesList(
  params: GetPagesList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PageListItem[] | null>>>;

export async function getPagesList(
  params: GetPagesList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PageListItem[] | null>>;

export async function getPagesList(
  params: GetPagesList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PageListItem[] | null>> {
  return service.getPagesList(params, serverConfig);
}

export async function getPageDetail(
  params: GetPageDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<PageDetail | null>>>;

export async function getPageDetail(
  params: GetPageDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<PageDetail | null>>;

export async function getPageDetail(
  params: GetPageDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<PageDetail | null>> {
  return service.getPageDetail(params, serverConfig);
}

export async function createPage(
  params: CreatePage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CreatePageResult | null>>>;

export async function createPage(
  params: CreatePage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CreatePageResult | null>>;

export async function createPage(
  params: CreatePage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CreatePageResult | null>> {
  return service.createPage(params, serverConfig);
}

export async function updatePage(
  params: UpdatePage,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<UpdatePageResult | null>>>;

export async function updatePage(
  params: UpdatePage,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<UpdatePageResult | null>>;

export async function updatePage(
  params: UpdatePage,
  serverConfig?: ActionConfig,
): Promise<ActionResult<UpdatePageResult | null>> {
  return service.updatePage(params, serverConfig);
}

export async function updatePages(
  params: UpdatePages,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ updated: number } | null>>>;

export async function updatePages(
  params: UpdatePages,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number } | null>>;

export async function updatePages(
  params: UpdatePages,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number } | null>> {
  return service.updatePages(params, serverConfig);
}

export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ block: ResolvedBlock } | null>>>;

export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ block: ResolvedBlock } | null>>;

export async function fetchBlockData(
  params: { access_token: string; block: RuntimeBlockInput },
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ block: ResolvedBlock } | null>> {
  return service.fetchBlockData(params, serverConfig);
}

export async function deletePages(
  params: DeletePages,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ deleted: number } | null>>>;

export async function deletePages(
  params: DeletePages,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number } | null>>;

export async function deletePages(
  params: DeletePages,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number } | null>> {
  return service.deletePages(params, serverConfig);
}

export async function getAllPlaceholders(serverConfig: {
  environment: "serverless";
}): Promise<
  NextResponse<
    ApiResponse<
      | { name: string; description: string; value: string; params?: string }[]
      | null
    >
  >
>;

export async function getAllPlaceholders(
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<
    | { name: string; description: string; value: string; params?: string }[]
    | null
  >
>;

export async function getAllPlaceholders(
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<
    | { name: string; description: string; value: string; params?: string }[]
    | null
  >
> {
  return service.getAllPlaceholders(serverConfig);
}
