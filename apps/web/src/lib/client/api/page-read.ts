import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetPageDetail,
  GetPagesList,
  PageDetail,
  PageListItem,
} from "@repo/shared-types/api/page";

import type {
  ResolvedBlock,
  RuntimeBlockInput,
} from "@/blocks/core/definition";
import { fetchPublicRead } from "@/lib/client/api/read";

export function getPagesList(
  params: GetPagesList,
  signal?: AbortSignal,
): Promise<ApiResponse<PageListItem[] | null>> {
  return fetchPublicRead("/api/public/pages/list", params, signal);
}
export function getPageDetail(
  params: GetPageDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<PageDetail | null>> {
  return fetchPublicRead("/api/public/pages/detail", params, signal);
}
export function getAllPlaceholders(signal?: AbortSignal): Promise<
  ApiResponse<Array<{
    name: string;
    description: string;
    value: string;
    params?: string;
  }> | null>
> {
  return fetchPublicRead("/api/public/pages/placeholders", {}, signal);
}

/** Uncached same-origin JSON POST for a potentially large editor block request. */
export async function fetchBlockData(
  params: { access_token?: string; block: RuntimeBlockInput },
  signal?: AbortSignal,
): Promise<ApiResponse<{ block: ResolvedBlock } | null>> {
  const response = await fetch("/api/public/admin/pages/block-data", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ block: params.block }),
    signal,
  });
  if (response.status >= 500) throw new Error("获取 Block 数据失败");
  return (await response.json()) as ApiResponse<{
    block: ResolvedBlock;
  } | null>;
}
