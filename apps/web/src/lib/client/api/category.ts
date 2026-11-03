import type {
  CategoryDetail,
  CategoryDistributionItem,
  CategoryListItem,
  CategoryTreeNode,
  GetCategoriesDistribution,
  GetCategoriesList,
  GetCategoriesTree,
  GetCategoryDetail,
  SearchCategories,
  SearchCategoryItem,
} from "@repo/shared-types/api/category";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

async function requestRead<T extends ApiResponseData>(
  operation: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(
    "/api/public/admin/taxonomy/categories/" + operation,
    window.location.origin,
  );
  const { access_token: _token, ...safeParams } = params;
  url.searchParams.set("params", JSON.stringify(safeParams));
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok && response.status >= 500)
    throw new Error("读取管理数据失败");
  return (await response.json()) as ApiResponse<T>;
}

export function getCategoriesList(
  params: GetCategoriesList,
  signal?: AbortSignal,
): Promise<ApiResponse<CategoryListItem[] | null>> {
  return requestRead<CategoryListItem[] | null>("list", params, signal);
}

export function getCategoryDetail(
  params: GetCategoryDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<CategoryDetail | null>> {
  return requestRead<CategoryDetail | null>("detail", params, signal);
}

export function searchCategories(
  params: SearchCategories,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchCategoryItem[] | null>> {
  return requestRead<SearchCategoryItem[] | null>("search", params, signal);
}

export function getCategoriesDistribution(
  params: GetCategoriesDistribution,
  signal?: AbortSignal,
): Promise<ApiResponse<CategoryDistributionItem[] | null>> {
  return requestRead<CategoryDistributionItem[] | null>(
    "distribution",
    params,
    signal,
  );
}

export function getCategoriesTree(
  params: GetCategoriesTree,
  signal?: AbortSignal,
): Promise<ApiResponse<CategoryTreeNode[] | null>> {
  return requestRead<CategoryTreeNode[] | null>("tree", params, signal);
}
