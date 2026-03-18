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
import {
  CheckMessagePermissionRequestSchema,
  DeleteConversationRequestSchema,
  GetConversationMessagesRequestSchema,
  GetConversationsRequestSchema,
  MarkConversationAsReadRequestSchema,
  SearchUsersRequestSchema,
  SendMessageRequestSchema,
} from "@repo/shared-types/api/message";
import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";

import { checkUserOnlineStatus, publishNoticeToUser } from "@/lib/server/ably";
import { isAblyEnabled } from "@/lib/server/ably-config";
import { authVerify } from "@/lib/server/auth-verify";
import { getConfig } from "@/lib/server/config-cache";
import { calculateMD5 } from "@/lib/server/crypto";
import { sendNotice } from "@/lib/server/notice";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

type MessageActionEnvironment = "serverless" | "serveraction";
type MessageActionConfig = { environment?: MessageActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/**
 * 检查消息系统是否启用
 */
async function checkMessageSystemEnabled(): Promise<boolean> {
  const enabled = await getConfig("message.enable");
  return enabled;
}

/**
 * 检查用户是否有权限向目标用户发送消息
 */
async function checkUserMessagePermission(
  currentUserRole: string,
  targetUserRole: string,
): Promise<{ allowed: boolean; reason?: string }> {
  // ADMIN/EDITOR/AUTHOR 可以给任何人发消息
  if (["ADMIN", "EDITOR", "AUTHOR"].includes(currentUserRole)) {
    return { allowed: true };
  }

  // USER 的权限检查
  if (currentUserRole === "USER") {
    // USER 给 USER 发消息
    if (targetUserRole === "USER") {
      const userToUserEnabled = await getConfig("message.userToUser.enable");
      if (!userToUserEnabled) {
        return { allowed: false, reason: "用户间私信功能已关闭" };
      }
      return { allowed: true };
    }

    // USER 给 ADMIN/EDITOR/AUTHOR 发消息
    if (["ADMIN", "EDITOR", "AUTHOR"].includes(targetUserRole)) {
      const userToAdminEnabled = await getConfig("message.userToAdmin.enable");
      if (!userToAdminEnabled) {
        return { allowed: false, reason: "不允许向管理员发送私信" };
      }
      return { allowed: true };
    }
  }

  return { allowed: false, reason: "无权限发送私信" };
}

/**
 * 获取会话列表
 * @param lastPolledAt - 上次轮询时间（用于增量更新）
 * @param skip - 跳过的记录数
 * @param take - 获取的记录数
 */
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
  // 处理参数重载
  let actualLastPolledAt: Date | undefined;
  let actualSkip = 0;
  let actualTake = 20;
  let actualServerConfig = serverConfig;

  if (lastPolledAt instanceof Date) {
    actualLastPolledAt = lastPolledAt;
    actualSkip = skip ?? 0;
    actualTake = take ?? 20;
  } else if (typeof lastPolledAt === "object") {
    actualServerConfig = lastPolledAt;
  }

  const response = new ResponseBuilder(
    actualServerConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "getConversations"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      skip: actualSkip,
      take: actualTake,
      ...(actualLastPolledAt
        ? { lastPolledAt: actualLastPolledAt.toISOString() }
        : {}),
    },
    GetConversationsRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 构建查询条件
    const whereClause: {
      userUid: number;
      isVisible: boolean;
      updatedAt?: { gt: Date };
    } = {
      userUid: user.uid,
      isVisible: true,
    };

    // 如果提供了 lastPolledAt，只获取有更新的会话
    if (actualLastPolledAt) {
      whereClause.updatedAt = { gt: actualLastPolledAt };
    }

    // 获取会话参与者记录
    const participants = await prisma.conversationParticipant.findMany({
      where: whereClause,
      orderBy: {
        updatedAt: "desc",
      },
      skip: actualSkip,
      take: actualTake,
      include: {
        conversation: {
          include: {
            participants: {
              where: {
                userUid: { not: user.uid },
              },
              include: {
                user: {
                  select: {
                    uid: true,
                    username: true,
                    nickname: true,
                    avatar: true,
                    role: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // 获取总数
    const total = await prisma.conversationParticipant.count({
      where: {
        userUid: user.uid,
        isVisible: true,
      },
    });

    // 转换为响应格式
    const conversations = await Promise.all(
      participants.map(async (participant) => {
        const otherParticipant = participant.conversation.participants[0];
        if (!otherParticipant) {
          return null;
        }

        // 获取最后一条消息
        const lastMessage = await prisma.message.findFirst({
          where: {
            conversationId: participant.conversationId,
            deletedAt: null,
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            content: true,
            createdAt: true,
            senderUid: true,
          },
        });

        // 检查对方用户的在线状态
        const isOnline = await checkUserOnlineStatus(otherParticipant.user.uid);

        return {
          conversationId: participant.conversationId,
          otherUser: {
            uid: otherParticipant.user.uid,
            username: otherParticipant.user.username,
            nickname: otherParticipant.user.nickname,
            avatar: otherParticipant.user.avatar,
            role: otherParticipant.user.role,
            emailMd5: calculateMD5(otherParticipant.user.email),
            isOnline,
          },
          lastMessage: lastMessage
            ? {
                content: lastMessage.content,
                createdAt: lastMessage.createdAt.toISOString(),
                senderUid: lastMessage.senderUid,
              }
            : null,
          unreadCount: participant.unreadCount,
          updatedAt: participant.updatedAt.toISOString(),
          lastMessageAt: participant.lastMessageAt.toISOString(),
          // 获取对方的已读状态（对方读到了我发的哪条消息）
          otherUserLastReadMessageId: otherParticipant.lastReadMessageId,
        };
      }),
    );

    // 过滤掉 null 值
    const validConversations = conversations.filter(
      (conv) => conv !== null,
    ) as GetConversationsSuccessResponse["data"]["conversations"];

    return response.ok({
      message: "获取会话列表成功",
      data: {
        conversations: validConversations,
        hasMore: actualSkip + actualTake < total,
        total,
      },
    }) as unknown as ActionResult<
      GetConversationsSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("获取会话列表失败:", error);
    return response.serverError({
      message: "获取会话列表失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "获取会话列表失败",
      },
    });
  }
}

/**
 * 获取会话消息
 * @param conversationId - 会话 ID
 * @param skip - 跳过的记录数
 * @param take - 获取的记录数
 */
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
  // 处理参数重载
  let actualSkip = 0;
  let actualTake = 25;
  let actualServerConfig = serverConfig;

  if (typeof skip === "number") {
    actualSkip = skip;
    actualTake = take ?? 25;
  } else if (typeof skip === "object") {
    actualServerConfig = skip;
  }

  const response = new ResponseBuilder(
    actualServerConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "getConversationMessages"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      conversationId,
      skip: actualSkip,
      take: actualTake,
    },
    GetConversationMessagesRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 验证用户是否是该会话的参与者
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userUid: {
          conversationId,
          userUid: user.uid,
        },
      },
    });

    if (!participant) {
      return response.notFound({
        message: "会话不存在",
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "会话不存在或无权访问",
        },
      });
    }

    // 获取消息列表
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: actualSkip,
      take: actualTake,
    });

    // 获取总消息数
    const totalMessages = await prisma.message.count({
      where: {
        conversationId,
        deletedAt: null,
      },
    });

    // 自动标记为已读（服务器端自动标记逻辑）
    // 只要最新消息被发送给客户端（skip === 0），就将其标记为已读
    // 注意：加载历史消息（skip > 0）时不标记已读，避免将已读指针倒退
    let totalUnreadMessageCount: number | undefined;
    if (actualSkip === 0 && messages.length > 0) {
      const latestMessage = messages[0]!; // messages 是降序，第一条是最新的（已检查 length > 0）

      // 更新当前用户的已读状态
      await prisma.conversationParticipant.update({
        where: {
          conversationId_userUid: {
            conversationId,
            userUid: user.uid,
          },
        },
        data: {
          unreadCount: 0,
          lastReadMessageId: latestMessage.id,
          updatedAt: new Date(), // 更新时间戳，让轮询能检测到已读状态变化
        },
      });

      // 同时更新对方的 updatedAt，确保对方的轮询能检测到已读状态变化
      await prisma.conversationParticipant.updateMany({
        where: {
          conversationId,
          userUid: { not: user.uid },
        },
        data: {
          updatedAt: new Date(),
        },
      });

      // 计算用户的总私信未读数（标记已读后）
      const messageUnreadResult =
        await prisma.conversationParticipant.aggregate({
          where: {
            userUid: user.uid,
          },
          _sum: {
            unreadCount: true,
          },
        });
      totalUnreadMessageCount = messageUnreadResult._sum?.unreadCount || 0;
    }

    // 获取对方的 lastReadMessageId（在更新当前用户的已读状态之后获取）
    const otherParticipant = await prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userUid: { not: user.uid },
      },
      select: {
        lastReadMessageId: true,
      },
    });

    return response.ok({
      message: "获取消息成功",
      data: {
        messages: messages.reverse(), // 反转为正序（旧 → 新）
        hasMore: actualSkip + actualTake < totalMessages,
        otherUserLastReadMessageId: otherParticipant?.lastReadMessageId || null,
        unreadMessageCount: totalUnreadMessageCount,
      },
    }) as unknown as ActionResult<
      GetConversationMessagesSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("获取消息失败:", error);
    return response.serverError({
      message: "获取消息失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "获取消息失败",
      },
    });
  }
}

/**
 * 发送消息
 * @param targetUid - 目标用户 UID
 * @param content - 消息内容
 * @param tempId - 临时 ID（可选，用于乐观更新）
 */
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
  // 处理参数重载
  let actualTempId: string | undefined;
  let actualServerConfig = serverConfig;

  if (typeof tempId === "string") {
    actualTempId = tempId;
  } else if (typeof tempId === "object") {
    actualServerConfig = tempId;
  }

  const response = new ResponseBuilder(
    actualServerConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "sendMessage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      targetUid,
      content,
      ...(actualTempId ? { tempId: actualTempId } : {}),
    },
    SendMessageRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    const normalizedContent = content.trim();

    // 验证不能给自己发消息
    if (targetUid === user.uid) {
      return response.badRequest({
        message: "不能给自己发消息",
        error: {
          code: "INVALID_REQUEST",
          message: "不能给自己发消息",
        },
      });
    }

    // 获取目标用户信息
    const targetUser = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { uid: true, role: true },
    });

    if (!targetUser) {
      return response.notFound({
        message: "目标用户不存在",
        error: {
          code: "USER_NOT_FOUND",
          message: "目标用户不存在",
        },
      });
    }

    // 检查权限
    const permissionCheck = await checkUserMessagePermission(
      user.role,
      targetUser.role,
    );
    if (!permissionCheck.allowed) {
      return response.forbidden({
        message: permissionCheck.reason || "无权限发送消息",
        error: {
          code: "PERMISSION_DENIED",
          message: permissionCheck.reason || "无权限发送消息",
        },
      });
    }

    // 查找或创建会话
    let conversation = await prisma.conversation.findFirst({
      where: {
        participants: {
          every: {
            userUid: { in: [user.uid, targetUid] },
          },
        },
      },
      include: {
        participants: true,
      },
    });

    // 如果会话不存在，创建新会话
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participants: {
            create: [
              {
                userUid: user.uid,
                isVisible: true,
                unreadCount: 0,
              },
              {
                userUid: targetUid,
                isVisible: true,
                unreadCount: 0,
              },
            ],
          },
        },
        include: {
          participants: true,
        },
      });
    } else {
      // 如果会话已存在，但发送方已删除（isVisible=false），恢复显示
      await prisma.conversationParticipant.updateMany({
        where: {
          conversationId: conversation.id,
          userUid: user.uid,
          isVisible: false,
        },
        data: {
          isVisible: true,
        },
      });
    }

    // 创建消息
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderUid: user.uid,
        content: normalizedContent,
        type: "TEXT",
      },
    });

    // 更新会话的 lastMessageId 和 updatedAt
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageId: message.id,
        updatedAt: new Date(),
      },
    });

    // 更新对方的未读数和显示状态
    await prisma.conversationParticipant.updateMany({
      where: {
        conversationId: conversation.id,
        userUid: targetUid,
      },
      data: {
        unreadCount: { increment: 1 },
        isVisible: true, // 恢复显示（如果对方已删除）
        lastNotifiedAt: null, // 重置邮件通知时间
        lastMessageAt: message.createdAt, // 更新最后消息时间
      },
    });

    // 更新发送方的 updatedAt 和 lastMessageAt
    await prisma.conversationParticipant.updateMany({
      where: {
        conversationId: conversation.id,
        userUid: user.uid,
      },
      data: {
        updatedAt: new Date(),
        lastMessageAt: message.createdAt, // 更新最后消息时间
      },
    });

    // ============ 通知系统集成 ============
    const { after } = await import("next/server");
    after(async () => {
      // 获取对方的 ConversationParticipant 信息
      const targetParticipant = await prisma.conversationParticipant.findUnique(
        {
          where: {
            conversationId_userUid: {
              conversationId: conversation.id,
              userUid: targetUid,
            },
          },
          select: {
            lastNotifiedAt: true,
          },
        },
      );

      // 检查是否需要发送通知
      const shouldNotify =
        !targetParticipant?.lastNotifiedAt ||
        new Date().getTime() - targetParticipant.lastNotifiedAt.getTime() >
          10 * 60 * 1000;

      if (shouldNotify) {
        // 更新 lastNotifiedAt
        await prisma.conversationParticipant.updateMany({
          where: {
            conversationId: conversation.id,
            userUid: targetUid,
          },
          data: {
            lastNotifiedAt: new Date(),
          },
        });

        // 获取发送者信息
        const sender = await prisma.user.findUnique({
          where: { uid: user.uid },
          select: {
            username: true,
            nickname: true,
          },
        });

        const senderName = sender?.nickname || sender?.username || "用户";
        const messagePreview =
          normalizedContent.substring(0, 20) +
          (normalizedContent.length > 20 ? "..." : "");

        // 检查 Ably 是否启用
        const ablyEnabled = await isAblyEnabled();

        if (!ablyEnabled) {
          // Ably 未启用，直接发送通知
          await sendNotice(
            targetUid,
            `${senderName} 私信了您`,
            messagePreview,
            `/messages?conversation=${conversation.id}`,
            {
              type: "message",
              senderName: senderName,
            },
          );
        } else {
          // Ably 已启用，检查用户是否在线
          try {
            const isOnline = await checkUserOnlineStatus(targetUid);

            if (!isOnline) {
              // 用户不在线，发送通知
              await sendNotice(
                targetUid,
                `${senderName} 私信了您`,
                messagePreview,
                `/messages?conversation=${conversation.id}`,
                {
                  type: "message",
                  senderName: senderName,
                },
              );
            } else {
              // 用户在线，通过 WebSocket 发送消息详情
              // 计算接收者的私信未读总数（在 increment 之后）
              const messageUnreadResult =
                await prisma.conversationParticipant.aggregate({
                  where: {
                    userUid: targetUid,
                  },
                  _sum: {
                    unreadCount: true,
                  },
                });
              const messageCount = messageUnreadResult._sum?.unreadCount || 0;

              // 尝试通过 WebSocket 推送消息
              const pushSuccess = await publishNoticeToUser(targetUid, {
                type: "new_private_message",
                payload: {
                  conversationId: conversation.id,
                  message: {
                    id: message.id,
                    content: message.content,
                    type: message.type,
                    senderUid: message.senderUid,
                    createdAt: message.createdAt.toISOString(),
                  },
                  sender: {
                    uid: user.uid,
                    username: sender?.username || "",
                    nickname: sender?.nickname || null,
                  },
                  messageCount,
                },
              });

              // 如果 WebSocket 推送失败，降级到站内通知
              if (!pushSuccess) {
                console.warn(
                  `[Message] WebSocket push failed for user ${targetUid}, falling back to notice`,
                );
                await sendNotice(
                  targetUid,
                  `${senderName} 私信了您`,
                  messagePreview,
                  `/messages?conversation=${conversation.id}`,
                  {
                    type: "message",
                    senderName: senderName,
                  },
                );
              }
            }
          } catch (error) {
            // Ably 操作失败，降级到站内通知
            console.error(
              `[Message] Failed to send notification via Ably for user ${targetUid}:`,
              error,
            );
            await sendNotice(
              targetUid,
              `${senderName} 私信了您`,
              messagePreview,
              `/messages?conversation=${conversation.id}`,
              {
                type: "message",
                senderName: senderName,
              },
            );
          }
        }
      }
    });

    // 不需要 revalidatePath，因为：
    // 1. WebSocket 模式：客户端通过实时通知已经更新了界面
    // 2. 轮询模式：轮询会自动获取更新
    // 3. revalidatePath 会导致页面重新渲染，触发不必要的 getConversations 调用
    // revalidatePath("/messages");

    return response.ok({
      message: "发送成功",
      data: {
        message: {
          id: message.id,
          content: message.content,
          type: message.type,
          senderUid: message.senderUid,
          createdAt: message.createdAt,
          status: "sent" as const,
          tempId: actualTempId,
        },
        conversationId: conversation.id,
      },
    }) as unknown as ActionResult<SendMessageSuccessResponse["data"] | null>;
  } catch (error) {
    console.error("发送消息失败:", error);
    return response.serverError({
      message: "发送消息失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "发送消息失败",
      },
    });
  }
}

/**
 * 标记会话已读
 * @param conversationId - 会话 ID
 */
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
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "markConversationAsRead"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      conversationId,
    },
    MarkConversationAsReadRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 验证用户是否是该会话的参与者
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userUid: {
          conversationId,
          userUid: user.uid,
        },
      },
    });

    if (!participant) {
      return response.notFound({
        message: "会话不存在",
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "会话不存在或无权访问",
        },
      });
    }

    // 获取最新的消息 ID
    const lastMessage = await prisma.message.findFirst({
      where: {
        conversationId,
        deletedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
      },
    });

    // 更新参与者的已读状态
    await prisma.conversationParticipant.update({
      where: {
        conversationId_userUid: {
          conversationId,
          userUid: user.uid,
        },
      },
      data: {
        unreadCount: 0,
        lastReadMessageId: lastMessage?.id || null,
      },
    });

    // 计算用户的总私信未读数
    const messageUnreadResult = await prisma.conversationParticipant.aggregate({
      where: {
        userUid: user.uid,
      },
      _sum: {
        unreadCount: true,
      },
    });
    const totalUnreadMessageCount = messageUnreadResult._sum?.unreadCount || 0;

    return response.ok({
      message: "标记已读成功",
      data: {
        message: "标记已读成功",
        unreadMessageCount: totalUnreadMessageCount,
      },
    }) as unknown as ActionResult<
      MarkConversationAsReadSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("标记已读失败:", error);
    return response.serverError({
      message: "标记已读失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "标记已读失败",
      },
    });
  }
}

/**
 * 删除会话（软删除）
 * @param conversationId - 会话 ID
 */
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
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "deleteConversation"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      conversationId,
    },
    DeleteConversationRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 验证用户是否是该会话的参与者
    const participant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userUid: {
          conversationId,
          userUid: user.uid,
        },
      },
    });

    if (!participant) {
      return response.notFound({
        message: "会话不存在",
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "会话不存在或无权访问",
        },
      });
    }

    // 软删除：设置 isVisible = false
    await prisma.conversationParticipant.update({
      where: {
        conversationId_userUid: {
          conversationId,
          userUid: user.uid,
        },
      },
      data: {
        isVisible: false,
      },
    });

    // 注意：不需要 revalidatePath，因为消息页面是客户端驱动的
    // 数据通过轮询或 WebSocket 实时更新

    return response.ok({
      message: "删除会话成功",
      data: {
        message: "删除会话成功",
      },
    }) as unknown as ActionResult<
      DeleteConversationSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("删除会话失败:", error);
    return response.serverError({
      message: "删除会话失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "删除会话失败",
      },
    });
  }
}

/**
 * 搜索用户
 * @param query - 搜索关键词（用户名、昵称、UID）
 */
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
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "searchUsers"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      query,
    },
    SearchUsersRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.forbidden({
        message: "消息系统未启用",
        error: {
          code: "MESSAGE_SYSTEM_DISABLED",
          message: "消息系统未启用",
        },
      });
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 尝试将 query 解析为 UID
    const uid = parseInt(query, 10);
    const isUidSearch = !isNaN(uid);

    // 搜索用户（排除自己）
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { uid: { not: user.uid } }, // 排除自己
          {
            OR: [
              { username: { contains: query, mode: "insensitive" } },
              { nickname: { contains: query, mode: "insensitive" } },
              ...(isUidSearch ? [{ uid }] : []),
            ],
          },
        ],
      },
      select: {
        uid: true,
        username: true,
        nickname: true,
        avatar: true,
        email: true,
        role: true,
      },
      take: 20, // 限制结果数量
    });

    return response.ok({
      message: "搜索成功",
      data: {
        users: users.map((u) => ({
          ...u,
          emailMd5: calculateMD5(u.email),
          email: null,
        })),
      },
    }) as unknown as ActionResult<SearchUsersSuccessResponse["data"] | null>;
  } catch (error) {
    console.error("搜索用户失败:", error);
    return response.serverError({
      message: "搜索用户失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "搜索用户失败",
      },
    });
  }
}

/**
 * 检查消息权限
 * @param targetUid - 目标用户 UID
 */
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
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 速率控制
  if (!(await limitControl(await headers(), "checkMessagePermission"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      targetUid,
    },
    CheckMessagePermissionRequestSchema,
  );
  if (validationError) return response.badRequest(validationError);

  try {
    // 检查消息系统是否启用
    if (!(await checkMessageSystemEnabled())) {
      return response.ok({
        message: "消息系统未启用",
        data: {
          allowed: false,
          reason: "消息系统未启用",
        },
      }) as unknown as ActionResult<
        CheckMessagePermissionSuccessResponse["data"] | null
      >;
    }

    const cookieStore = await cookies();
    const token = cookieStore.get("ACCESS_TOKEN")?.value;
    const user = await authVerify({
      allowedRoles: ["USER", "ADMIN", "EDITOR", "AUTHOR"],
      accessToken: token,
    });

    if (!user) {
      return response.unauthorized({
        message: "未登录",
      });
    }

    // 检查不能给自己发消息
    if (targetUid === user.uid) {
      return response.ok({
        message: "权限检查完成",
        data: {
          allowed: false,
          reason: "不能给自己发消息",
        },
      }) as unknown as ActionResult<
        CheckMessagePermissionSuccessResponse["data"] | null
      >;
    }

    // 获取目标用户信息
    const targetUser = await prisma.user.findUnique({
      where: { uid: targetUid },
      select: { uid: true, role: true },
    });

    if (!targetUser) {
      return response.ok({
        message: "权限检查完成",
        data: {
          allowed: false,
          reason: "目标用户不存在",
        },
      }) as unknown as ActionResult<
        CheckMessagePermissionSuccessResponse["data"] | null
      >;
    }

    // 检查权限
    const permissionCheck = await checkUserMessagePermission(
      user.role,
      targetUser.role,
    );

    return response.ok({
      message: "权限检查完成",
      data: permissionCheck,
    }) as unknown as ActionResult<
      CheckMessagePermissionSuccessResponse["data"] | null
    >;
  } catch (error) {
    console.error("检查权限失败:", error);
    return response.serverError({
      message: "检查权限失败",
      error: {
        code: "SERVER_ERROR",
        message: error instanceof Error ? error.message : "检查权限失败",
      },
    });
  }
}
