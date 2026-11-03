import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  CheckMessagePermissionSuccessResponse,
  GetConversationMessagesSuccessResponse,
  GetConversationsSuccessResponse,
  SearchUsersSuccessResponse,
} from "@repo/shared-types/api/message";

import { fetchPublicRead } from "@/lib/client/api/read";

export function getConversations(
  lastPolledAt?: Date,
  skip = 0,
  take = 20,
  signal?: AbortSignal,
): Promise<ApiResponse<GetConversationsSuccessResponse["data"]>> {
  return fetchPublicRead(
    "/api/public/messages/conversations",
    { lastPolledAt: lastPolledAt?.toISOString(), skip, take },
    signal,
  );
}
export function getConversationMessages(
  conversationId: string,
  skip = 0,
  take = 25,
  signal?: AbortSignal,
): Promise<ApiResponse<GetConversationMessagesSuccessResponse["data"]>> {
  return fetchPublicRead(
    "/api/public/messages/thread",
    { conversationId, skip, take },
    signal,
  );
}
export function searchUsers(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResponse<SearchUsersSuccessResponse["data"]>> {
  return fetchPublicRead("/api/public/messages/users", { query }, signal);
}
export function checkMessagePermission(
  targetUid: number,
  signal?: AbortSignal,
): Promise<ApiResponse<CheckMessagePermissionSuccessResponse["data"]>> {
  return fetchPublicRead(
    "/api/public/messages/permission",
    { targetUid },
    signal,
  );
}
