import type { ApiResponse } from "@repo/shared-types/api/common";

type PushSubscriptionInfo = {
  id: string;
  deviceName: string;
  browser: string | null;
  os: string | null;
  isActive: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
  endpoint: string;
};

export type UserPushSubscriptions = {
  subscriptions: PushSubscriptionInfo[];
};

/** VAPID public key is safe to request without auth; private VAPID key is never returned. */
export async function getVapidPublicKey(
  signal?: AbortSignal,
): Promise<ApiResponse<{ publicKey: string } | null>> {
  const response = await fetch("/api/public/web-push/vapid-key", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500 && response.status !== 503) {
    throw new Error("获取 VAPID 公钥失败");
  }
  return (await response.json()) as ApiResponse<{ publicKey: string } | null>;
}

/** Preserves Server Action Date semantics after switching from Flight to HTTP JSON. */
export async function getUserPushSubscriptions(
  signal?: AbortSignal,
): Promise<ApiResponse<UserPushSubscriptions | null>> {
  const response = await fetch("/api/public/account/web-push/subscriptions", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (response.status >= 500) throw new Error("获取推送订阅列表失败");
  const result = (await response.json()) as ApiResponse<{
    subscriptions: Array<
      Omit<PushSubscriptionInfo, "createdAt" | "lastUsedAt"> & {
        createdAt: string;
        lastUsedAt: string | null;
      }
    >;
  } | null>;

  if (!result.success || !result.data?.subscriptions) {
    return result as ApiResponse<UserPushSubscriptions | null>;
  }
  return {
    ...result,
    data: {
      subscriptions: result.data.subscriptions.map((item) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        lastUsedAt: item.lastUsedAt ? new Date(item.lastUsedAt) : null,
      })),
    },
  };
}
