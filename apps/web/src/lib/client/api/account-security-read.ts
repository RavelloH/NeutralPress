import type {
  GetSessionsSuccessResponse,
  TotpStatusResponse,
} from "@repo/shared-types/api/auth";
import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

async function getAccountSecurityRead<T extends ApiResponseData>(
  path: string,
  fallback: string,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error(fallback);
  return (await response.json()) as ApiResponse<T>;
}

export function getSessions(
  signal?: AbortSignal,
): Promise<ApiResponse<GetSessionsSuccessResponse["data"]>> {
  return getAccountSecurityRead(
    "/api/public/account/sessions",
    "获取会话列表失败",
    signal,
  );
}

export function getTotpStatus(
  signal?: AbortSignal,
): Promise<ApiResponse<TotpStatusResponse["data"]>> {
  return getAccountSecurityRead(
    "/api/public/account/security/totp-status",
    "获取 TOTP 状态失败",
    signal,
  );
}
