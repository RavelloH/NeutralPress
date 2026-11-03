import type { ApiResponse } from "@repo/shared-types/api/common";

import type { PasskeyListData } from "@/lib/shared/passkey-types";

/** Credentials stay in same-origin Cookies; no UID or credential ID goes into the URL. */
export async function listUserPasskeys(
  signal?: AbortSignal,
): Promise<ApiResponse<PasskeyListData>> {
  const response = await fetch("/api/public/account/security/passkeys", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("获取通行密钥失败");
  return (await response.json()) as ApiResponse<PasskeyListData>;
}
