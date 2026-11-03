"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CreateTag,
  DeleteTags,
  GetTagDetail,
  GetTagsDistribution,
  GetTagsList,
  SearchTagItem,
  SearchTags,
  TagDetail,
  TagDistributionItem,
  TagListItem,
  UpdateTag,
} from "@repo/shared-types/api/tag";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/tag";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function createTag(
  params: CreateTag,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      createdAt: string;
      updatedAt: string;
    } | null>
  >
>;
export async function createTag(
  params: CreateTag,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    slug: string;
    name: string;
    description: string | null;
    featuredImage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null>
>;
export async function createTag(
  params: CreateTag,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    slug: string;
    name: string;
    description: string | null;
    featuredImage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null>
> {
  return service.createTag(params, serverConfig);
}

export async function deleteTags(
  params: DeleteTags,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ deleted: number; slugs: string[] } | null>>
>;
export async function deleteTags(
  params: DeleteTags,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number; slugs: string[] } | null>>;
export async function deleteTags(
  params: DeleteTags,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number; slugs: string[] } | null>> {
  return service.deleteTags(params, serverConfig);
}

export async function getTagDetail(
  params: GetTagDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagDetail | null>>>;
export async function getTagDetail(
  params: GetTagDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagDetail | null>>;
export async function getTagDetail(
  params: GetTagDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagDetail | null>> {
  return service.getTagDetail(params, serverConfig);
}

export async function getTagsDistribution(
  params: GetTagsDistribution,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagDistributionItem[] | null>>>;
export async function getTagsDistribution(
  params: GetTagsDistribution,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagDistributionItem[] | null>>;
export async function getTagsDistribution(
  params: GetTagsDistribution,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagDistributionItem[] | null>> {
  return service.getTagsDistribution(params, serverConfig);
}

export async function getTagsList(
  params: GetTagsList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<TagListItem[] | null>>>;
export async function getTagsList(
  params: GetTagsList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<TagListItem[] | null>>;
export async function getTagsList(
  params: GetTagsList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<TagListItem[] | null>> {
  return service.getTagsList(params, serverConfig);
}

export async function searchTags(
  params: SearchTags,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchTagItem[] | null>>>;
export async function searchTags(
  params: SearchTags,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchTagItem[] | null>>;
export async function searchTags(
  params: SearchTags,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchTagItem[] | null>> {
  return service.searchTags(params, serverConfig);
}

export async function updateTag(
  params: UpdateTag,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      updatedAt: string;
    } | null>
  >
>;
export async function updateTag(
  params: UpdateTag,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    slug: string;
    name: string;
    description: string | null;
    updatedAt: string;
  } | null>
>;
export async function updateTag(
  params: UpdateTag,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    slug: string;
    name: string;
    description: string | null;
    updatedAt: string;
  } | null>
> {
  return service.updateTag(params, serverConfig);
}
