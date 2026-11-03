import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";

export type MailSubscriptionActionResult<T extends ApiResponseData> =
  ApiResponse<T>;

export type MailSubscriptionStatus =
  | "PENDING_VERIFY"
  | "ACTIVE"
  | "UNSUBSCRIBED";

export type MailSubscriptionListSortField =
  | "id"
  | "createdAt"
  | "updatedAt"
  | "lastSentAt";

export interface GetMailSubscriptionListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: MailSubscriptionStatus[];
  boundUser?: boolean[];
  pendingOnly?: boolean;
  sortBy?: MailSubscriptionListSortField;
  sortOrder?: "asc" | "desc";
}

export interface MailSubscriptionListItem {
  id: number;
  email: string;
  userUid: number | null;
  username: string | null;
  nickname: string | null;
  status: MailSubscriptionStatus;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
  lastSentPostId: number | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  isPendingForLatest: boolean;
}

export interface MailSubscriptionListData {
  latestPostId: number | null;
  items: MailSubscriptionListItem[];
}

export interface DispatchLatestPostMailParams {
  cursorId?: number;
  batchSize?: number;
  expectedLatestPostId?: number;
}

export interface DispatchFailureItem {
  subscriptionId: number;
  email: string;
  reason: string;
}

export interface DispatchLatestPostMailData {
  latestPost: {
    id: number;
    title: string;
    slug: string;
  };
  pendingTotal: number;
  remainingAfter: number;
  processed: number;
  sent: number;
  failed: number;
  nextCursor: number;
  hasMore: boolean;
  failures: DispatchFailureItem[];
}

export interface DispatchOverviewData {
  latestPost: {
    id: number;
    title: string;
    slug: string;
    publishedAt: string | null;
  } | null;
  totalActive: number;
  pendingTotal: number;
}

export interface MailSubscriptionStatusDistributionItem {
  status: MailSubscriptionStatus;
  count: number;
  percentage: number;
}

export interface SubscriptionActionData {
  status: "PENDING_VERIFY" | "ACTIVE";
}
