import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  FriendLinkListItem,
  FriendLinksStats,
  FriendLinkTrendItem,
  GetFriendLinkDetail,
  GetFriendLinksList,
  GetFriendLinksStats,
  GetFriendLinksTrends,
  GetOwnFriendLink,
} from "@repo/shared-types/api/friendlink";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getOwnFriendLink(
  params: GetOwnFriendLink = {},
  signal?: AbortSignal,
): Promise<ApiResponse<FriendLinkListItem | null>> {
  return fetchPublicRead("/api/public/friends/own", params, signal);
}
export function getFriendLinkDetail(
  params: GetFriendLinkDetail,
  signal?: AbortSignal,
): Promise<ApiResponse<FriendLinkListItem | null>> {
  return fetchPublicRead("/api/public/admin/friends/detail", params, signal);
}
export function getFriendLinksStats(
  params: GetFriendLinksStats,
  signal?: AbortSignal,
): Promise<ApiResponse<FriendLinksStats | null>> {
  return fetchPublicRead("/api/public/admin/friends/stats", params, signal);
}
export function getFriendLinksTrends(
  params: GetFriendLinksTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<FriendLinkTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/friends/trends", params, signal);
}
export function getFriendLinksList(
  params: GetFriendLinksList,
  signal?: AbortSignal,
): Promise<ApiResponse<FriendLinkListItem[] | null>> {
  return fetchPublicRead("/api/public/admin/friends/list", params, signal);
}
