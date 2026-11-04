import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  SearchPosts,
  SearchPostsResult,
} from "@repo/shared-types/api/search";

/** Published posts only; query/visitor correlation stay in JSON and outside proxy URL logs. */
export async function searchPosts(
  params: SearchPosts,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchPostsResult | null>> {
  const response = await fetch("/api/public/search/posts", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, status: "PUBLISHED" }),
    signal,
  });
  if (response.status >= 500) throw new Error("搜索文章失败");
  return (await response.json()) as ApiResponse<SearchPostsResult | null>;
}
