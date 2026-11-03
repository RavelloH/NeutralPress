import type { ApiResponse } from "@repo/shared-types/api/common";

import { fetchPublicRead } from "@/lib/client/api/read";
import type {
  DispatchOverviewData,
  GetMailSubscriptionListParams,
  MailSubscriptionListData,
  MailSubscriptionStatusDistributionItem,
} from "@/lib/shared/mail-subscription-types";

/** Admin/Editor only. Read via same-origin cookies, never send emails by GET. */
export function getMailSubscriptionList(
  params: GetMailSubscriptionListParams = {},
  signal?: AbortSignal,
): Promise<ApiResponse<MailSubscriptionListData | null>> {
  // Search filters can contain private subscriber email addresses: keep them out of URLs.
  return fetch("/api/public/admin/mail-subscriptions/list", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    signal,
  }).then(async (response) => {
    if (response.status >= 500) throw new Error("获取邮件订阅列表失败");
    return (await response.json()) as ApiResponse<MailSubscriptionListData | null>;
  });
}

export function getLatestMailDispatchOverview(
  signal?: AbortSignal,
): Promise<ApiResponse<DispatchOverviewData | null>> {
  return fetchPublicRead(
    "/api/public/admin/mail-subscriptions/overview",
    {},
    signal,
  );
}

export function getMailSubscriptionStatusDistribution(
  signal?: AbortSignal,
): Promise<ApiResponse<MailSubscriptionStatusDistributionItem[] | null>> {
  return fetchPublicRead(
    "/api/public/admin/mail-subscriptions/distribution",
    {},
    signal,
  );
}
