import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  GetUsersList,
  GetUsersTrends,
  UserActivityResponse,
  UserListItem,
  UserProfile,
  UserTrendItem,
} from "@repo/shared-types/api/user";

import { fetchPublicRead } from "@/lib/client/api/read";

export interface OwnUserProfile {
  uid: number;
  username: string;
  email: string;
  nickname: string | null;
  website: string | null;
  bio: string | null;
  role: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
  createdAt: string;
  hasPassword: boolean;
  linkedAccounts: Array<{ provider: string; email: string }>;
}
export function getUsersTrends(
  params: GetUsersTrends,
  signal?: AbortSignal,
): Promise<ApiResponse<UserTrendItem[] | null>> {
  return fetchPublicRead("/api/public/admin/users/trends", params, signal);
}
export function getUsersList(
  params: GetUsersList,
  signal?: AbortSignal,
): Promise<ApiResponse<UserListItem[] | null>> {
  return fetchPublicRead("/api/public/admin/users/list", params, signal);
}
export function getUserProfile(
  signal?: AbortSignal,
): Promise<ApiResponse<OwnUserProfile | null>> {
  return fetchPublicRead("/api/public/users/self", {}, signal);
}
export function getUserPublicProfile(
  uid: number,
  signal?: AbortSignal,
): Promise<ApiResponse<UserProfile | null>> {
  return fetchPublicRead("/api/public/users/profile", { uid }, signal);
}
export function getUserActivity(
  uid: number,
  offset = 0,
  limit = 20,
  _isGuest = false,
  signal?: AbortSignal,
): Promise<ApiResponse<UserActivityResponse | null>> {
  return fetchPublicRead(
    "/api/public/users/activity",
    { uid, offset, limit },
    signal,
  );
}
