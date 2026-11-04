import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CustomWordItem,
  GetIndexStatus,
  GetPostTokenDetails,
  GetSearchLogs,
  IndexStatusItem,
  PostTokenDetails,
  SearchLogItem,
  TestTokenize,
  TestTokenizeResult,
} from "@repo/shared-types/api/search";

/** Keep private filters and search terms in an authenticated same-origin JSON body. */
async function adminSearchPost<T extends ApiResponseData>(
  operation: "words" | "index-status" | "tokens" | "logs" | "test-tokenize",
  params: object,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const response = await fetch("/api/public/admin/search/" + operation, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });
  if (response.status >= 500) throw new Error("获取搜索管理数据失败");
  return (await response.json()) as ApiResponse<T>;
}

export function testTokenize(
  params: Omit<TestTokenize, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<TestTokenizeResult | null>> {
  return adminSearchPost("test-tokenize", params, signal);
}

export function getCustomWords(
  signal?: AbortSignal,
): Promise<ApiResponse<CustomWordItem[] | null>> {
  return adminSearchPost("words", {}, signal);
}

export function getIndexStatus(
  params: Omit<GetIndexStatus, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<IndexStatusItem[] | null>> {
  return adminSearchPost("index-status", params, signal);
}

export function getPostTokenDetails(
  params: Omit<GetPostTokenDetails, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<PostTokenDetails | null>> {
  return adminSearchPost("tokens", params, signal);
}

export function getSearchLogs(
  params: Omit<GetSearchLogs, "access_token">,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchLogItem[] | null>> {
  return adminSearchPost("logs", params, signal);
}
