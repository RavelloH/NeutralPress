"use server";

import type {
  CategoryDetail,
  CategoryDistributionItem,
  CategoryListItem,
  CategoryTreeNode,
  CreateCategory,
  DeleteCategories,
  GetCategoriesDistribution,
  GetCategoriesList,
  GetCategoriesTree,
  GetCategoryDetail,
  MoveCategories,
  SearchCategories,
  SearchCategoryItem,
  UpdateCategory,
} from "@repo/shared-types/api/category";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/category";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function createCategory(
  params: CreateCategory,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      slug: string;
      name: string;
      description: string | null;
      parentId: number | null;
      createdAt: string;
      updatedAt: string;
    } | null>
  >
>;
export async function createCategory(
  params: CreateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    createdAt: string;
    updatedAt: string;
  } | null>
>;
export async function createCategory(
  params: CreateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    createdAt: string;
    updatedAt: string;
  } | null>
> {
  return service.createCategory(params, serverConfig);
}

export async function deleteCategories(
  params: DeleteCategories,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      ids: number[];
      cascadeDeleted: number;
    } | null>
  >
>;
export async function deleteCategories(
  params: DeleteCategories,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    ids: number[];
    cascadeDeleted: number;
  } | null>
>;
export async function deleteCategories(
  params: DeleteCategories,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    ids: number[];
    cascadeDeleted: number;
  } | null>
> {
  return service.deleteCategories(params, serverConfig);
}

export async function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryDistributionItem[] | null>>>;
export async function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryDistributionItem[] | null>>;
export async function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryDistributionItem[] | null>> {
  return service.getCategoriesDistribution(params, serverConfig);
}

export async function getCategoriesList(
  params: GetCategoriesList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryListItem[] | null>>>;
export async function getCategoriesList(
  params: GetCategoriesList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryListItem[] | null>>;
export async function getCategoriesList(
  params: GetCategoriesList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryListItem[] | null>> {
  return service.getCategoriesList(params, serverConfig);
}

export async function getCategoriesTree(
  params: GetCategoriesTree,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryTreeNode[] | null>>>;
export async function getCategoriesTree(
  params: GetCategoriesTree,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryTreeNode[] | null>>;
export async function getCategoriesTree(
  params: GetCategoriesTree,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryTreeNode[] | null>> {
  return service.getCategoriesTree(params, serverConfig);
}

export async function getCategoryDetail(
  params: GetCategoryDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<CategoryDetail | null>>>;
export async function getCategoryDetail(
  params: GetCategoryDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<CategoryDetail | null>>;
export async function getCategoryDetail(
  params: GetCategoryDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<CategoryDetail | null>> {
  return service.getCategoryDetail(params, serverConfig);
}

export async function moveCategories(
  params: MoveCategories,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      moved: number;
      ids: number[];
      targetParentId: number | null;
    } | null>
  >
>;
export async function moveCategories(
  params: MoveCategories,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    moved: number;
    ids: number[];
    targetParentId: number | null;
  } | null>
>;
export async function moveCategories(
  params: MoveCategories,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    moved: number;
    ids: number[];
    targetParentId: number | null;
  } | null>
> {
  return service.moveCategories(params, serverConfig);
}

export async function searchCategories(
  params: SearchCategories,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchCategoryItem[] | null>>>;
export async function searchCategories(
  params: SearchCategories,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchCategoryItem[] | null>>;
export async function searchCategories(
  params: SearchCategories,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchCategoryItem[] | null>> {
  return service.searchCategories(params, serverConfig);
}

export async function updateCategory(
  params: UpdateCategory,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      slug: string;
      name: string;
      description: string | null;
      featuredImage: string | null;
      parentId: number | null;
      updatedAt: string;
    } | null>
  >
>;
export async function updateCategory(
  params: UpdateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    updatedAt: string;
  } | null>
>;
export async function updateCategory(
  params: UpdateCategory,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    slug: string;
    name: string;
    description: string | null;
    parentId: number | null;
    updatedAt: string;
  } | null>
> {
  return service.updateCategory(params, serverConfig);
}
