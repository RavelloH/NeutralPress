"use server";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  CheckMessagePermissionSuccessResponse,
  DeleteConversationSuccessResponse,
  GetConversationMessagesSuccessResponse,
  GetConversationsSuccessResponse,
  MarkConversationAsReadSuccessResponse,
  SearchUsersSuccessResponse,
  SendMessageSuccessResponse,
} from "@repo/shared-types/api/message";
import type { NextResponse } from "next/server";

import * as service from "@/lib/server/services/message-domain";

type MessageActionEnvironment = "serverless" | "serveraction";

type MessageActionConfig = { environment?: MessageActionEnvironment };

type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getConversations(
  lastPolledAt: Date | undefined,
  skip: number,
  take: number,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetConversationsSuccessResponse["data"]>>>;

export async function getConversations(
  lastPolledAt?: Date,
  skip?: number,
  take?: number,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<GetConversationsSuccessResponse["data"]>>;

export async function getConversations(
  lastPolledAt?: Date | MessageActionConfig,
  skip?: number,
  take?: number,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<GetConversationsSuccessResponse["data"] | null>> {
  return service.getConversations(lastPolledAt, skip, take, serverConfig);
}

export async function getConversationMessages(
  conversationId: string,
  skip: number,
  take: number,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<GetConversationMessagesSuccessResponse["data"]>>
>;

export async function getConversationMessages(
  conversationId: string,
  skip?: number,
  take?: number,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<GetConversationMessagesSuccessResponse["data"]>>;

export async function getConversationMessages(
  conversationId: string,
  skip?: number | MessageActionConfig,
  take?: number,
  serverConfig?: MessageActionConfig,
): Promise<
  ActionResult<GetConversationMessagesSuccessResponse["data"] | null>
> {
  return service.getConversationMessages(
    conversationId,
    skip,
    take,
    serverConfig,
  );
}

export async function sendMessage(
  targetUid: number,
  content: string,
  tempId: string | undefined,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SendMessageSuccessResponse["data"]>>>;

export async function sendMessage(
  targetUid: number,
  content: string,
  tempId?: string,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<SendMessageSuccessResponse["data"]>>;

export async function sendMessage(
  targetUid: number,
  content: string,
  tempId?: string | MessageActionConfig,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<SendMessageSuccessResponse["data"] | null>> {
  return service.sendMessage(targetUid, content, tempId, serverConfig);
}

export async function markConversationAsRead(
  conversationId: string,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<MarkConversationAsReadSuccessResponse["data"]>>
>;

export async function markConversationAsRead(
  conversationId: string,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<MarkConversationAsReadSuccessResponse["data"]>>;

export async function markConversationAsRead(
  conversationId: string,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<MarkConversationAsReadSuccessResponse["data"] | null>> {
  return service.markConversationAsRead(conversationId, serverConfig);
}

export async function deleteConversation(
  conversationId: string,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<DeleteConversationSuccessResponse["data"]>>
>;

export async function deleteConversation(
  conversationId: string,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<DeleteConversationSuccessResponse["data"]>>;

export async function deleteConversation(
  conversationId: string,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<DeleteConversationSuccessResponse["data"] | null>> {
  return service.deleteConversation(conversationId, serverConfig);
}

export async function searchUsers(
  query: string,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchUsersSuccessResponse["data"]>>>;

export async function searchUsers(
  query: string,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<SearchUsersSuccessResponse["data"]>>;

export async function searchUsers(
  query: string,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<SearchUsersSuccessResponse["data"] | null>> {
  return service.searchUsers(query, serverConfig);
}

export async function checkMessagePermission(
  targetUid: number,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<CheckMessagePermissionSuccessResponse["data"]>>
>;

export async function checkMessagePermission(
  targetUid: number,
  serverConfig?: MessageActionConfig,
): Promise<ApiResponse<CheckMessagePermissionSuccessResponse["data"]>>;

export async function checkMessagePermission(
  targetUid: number,
  serverConfig?: MessageActionConfig,
): Promise<ActionResult<CheckMessagePermissionSuccessResponse["data"] | null>> {
  return service.checkMessagePermission(targetUid, serverConfig);
}
