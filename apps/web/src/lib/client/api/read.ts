import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

/**
 * Client-side GET transport for public-facing read endpoints.
 * Public refers to the external API surface, not unrestricted authorization.
 * Authentication is always decided by the server-only service using cookies.
 */
export async function fetchPublicRead<T extends ApiResponseData>(
  pathname: string,
  params?: object,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const url = new URL(pathname, window.location.origin);
  const safeParams = { ...(params ?? {}) } as Record<string, unknown>;
  // An access token must never be serialized into the URL, browser history, or proxy logs.
  delete safeParams.access_token;
  url.searchParams.set("params", JSON.stringify(safeParams));
  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("获取数据失败");
  return (await response.json()) as ApiResponse<T>;
}
