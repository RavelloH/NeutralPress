import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetTagDetail,
  GetTagsDistribution,
  GetTagsList,
  SearchTagItem,
  SearchTags,
  TagDetail,
  TagDistributionItem,
  TagListItem,
} from "@repo/shared-types/api/tag";

async function requestRead<T extends ApiResponseData>(
  operation: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(
    "/api/public/admin/taxonomy/tags/" + operation,
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

export function getTagsList(
  params: GetTagsList,
  signal?: AbortSignal,
): Promise<ApiResponse<TagListItem[] | null>> {
  return requestRead<TagListItem[] | null>("list", params, signal);
}

export function getTagDetail(
  params: GetTagDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<TagDetail | null>> {
  return requestRead<TagDetail | null>("detail", params, signal);
}

export function searchTags(
  params: SearchTags,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchTagItem[] | null>> {
  return requestRead<SearchTagItem[] | null>("search", params, signal);
}

export function getTagsDistribution(
  params: GetTagsDistribution,
  signal?: AbortSignal,
): Promise<ApiResponse<TagDistributionItem[] | null>> {
  return requestRead<TagDistributionItem[] | null>(
    "distribution",
    params,
    signal,
  );
}
