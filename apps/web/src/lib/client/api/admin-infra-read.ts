import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type { SettingItem } from "@repo/shared-types/api/setting";
import type { SystemInfo } from "@repo/shared-types/api/system";

export type ReauthProfile = {
  uid: number;
  username: string;
  email: string;
  hasPassword: boolean;
  linkedProviders: string[];
  hasTotpEnabled: boolean;
};

async function privateGet<T extends ApiResponseData>(
  path: string,
  signal?: AbortSignal,
): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("读取失败，请稍后重试");
  return (await response.json()) as ApiResponse<T>;
}

/** Admin-only host/IP/CPU information; bypass shared HTTP caches. */
export function getSystemInfo(
  signal?: AbortSignal,
): Promise<ApiResponse<SystemInfo>> {
  return privateGet<SystemInfo>("/api/public/admin/system/info", signal);
}

/** All settings may contain keys and credentials, so use same-origin JSON POST. */
export async function getSettings(
  signal?: AbortSignal,
): Promise<ApiResponse<SettingItem[] | null>> {
  const response = await fetch("/api/public/admin/settings/list", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal,
  });
  if (response.status >= 500) throw new Error("获取站点配置失败");
  return (await response.json()) as ApiResponse<SettingItem[] | null>;
}

/** Reauth profile includes email/auth-method flags; never put its data in URLs. */
export function getCurrentUserForReauth(
  signal?: AbortSignal,
): Promise<ApiResponse<ReauthProfile>> {
  return privateGet<ReauthProfile>(
    "/api/public/account/security/reauth-profile",
    signal,
  );
}
