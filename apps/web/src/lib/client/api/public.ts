import type { ApiResponse } from "@repo/shared-types/api/common";

export interface UnreadNotificationCounts {
  count: number;
  messageCount: number;
}

/**
 * Authenticated, uncached GET replacing a serialized Server Function read.
 * Same-origin credentials are forwarded automatically.
 */
export async function getUnreadNoticeCount(
  signal?: AbortSignal,
): Promise<ApiResponse<UnreadNotificationCounts>> {
  const response = await fetch("/api/public/notifications/unread", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });

  if (!response.ok && response.status >= 500) {
    throw new Error("获取未读通知数量失败");
  }

  return (await response.json()) as ApiResponse<UnreadNotificationCounts>;
}
