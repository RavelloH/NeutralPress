"use server";

import * as service from "@/lib/server/services/mail-subscription-domain";
import type {
  DispatchLatestPostMailData,
  DispatchLatestPostMailParams,
  DispatchOverviewData,
  GetMailSubscriptionListParams,
  MailSubscriptionActionResult,
  MailSubscriptionListData,
  MailSubscriptionStatus,
  MailSubscriptionStatusDistributionItem,
  SubscriptionActionData,
} from "@/lib/shared/mail-subscription-types";

export async function subscribeMail(params: {
  email?: string;
  captcha_token: string;
}): Promise<MailSubscriptionActionResult<SubscriptionActionData | null>> {
  return service.subscribeMail(params);
}

export async function confirmMailSubscription(params: {
  token: string;
}): Promise<MailSubscriptionActionResult<{ status: "ACTIVE" } | null>> {
  return service.confirmMailSubscription(params);
}

export async function unsubscribeMailSubscription(params: {
  token: string;
}): Promise<MailSubscriptionActionResult<{ status: "UNSUBSCRIBED" } | null>> {
  return service.unsubscribeMailSubscription(params);
}

export async function getMailSubscriptionList(
  params: GetMailSubscriptionListParams = {},
): Promise<MailSubscriptionActionResult<MailSubscriptionListData | null>> {
  return service.getMailSubscriptionList(params);
}

export async function updateMailSubscriptionStatusByAdmin(params: {
  id: number;
  status: "ACTIVE" | "UNSUBSCRIBED";
}): Promise<
  MailSubscriptionActionResult<{
    id: number;
    status: MailSubscriptionStatus;
  } | null>
> {
  return service.updateMailSubscriptionStatusByAdmin(params);
}

export async function resetMailSubscriptionLastSentByAdmin(params: {
  id: number;
}): Promise<
  MailSubscriptionActionResult<{
    id: number;
    lastSentPostId: number | null;
  } | null>
> {
  return service.resetMailSubscriptionLastSentByAdmin(params);
}

export async function getLatestMailDispatchOverview(): Promise<
  MailSubscriptionActionResult<DispatchOverviewData | null>
> {
  return service.getLatestMailDispatchOverview();
}

export async function getMailSubscriptionStatusDistribution(): Promise<
  MailSubscriptionActionResult<MailSubscriptionStatusDistributionItem[] | null>
> {
  return service.getMailSubscriptionStatusDistribution();
}

export async function cleanupInvalidMailSubscriptions(): Promise<
  MailSubscriptionActionResult<{
    deleted: number;
  } | null>
> {
  return service.cleanupInvalidMailSubscriptions();
}

export async function dispatchLatestPostMail(
  params: DispatchLatestPostMailParams = {},
): Promise<MailSubscriptionActionResult<DispatchLatestPostMailData | null>> {
  return service.dispatchLatestPostMail(params);
}
