"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiArrowLeftLine, RiDeleteBinLine, RiMoreLine } from "@remixicon/react";
import type {
  Conversation,
  ConversationUser,
  Message,
} from "@repo/shared-types/api/message";

import { markConversationAsRead, sendMessage } from "@/actions/message";
import MessageInput from "@/components/client/features/chat/MessageInput";
import type { MessageListRef } from "@/components/client/features/chat/MessageList";
import MessageList from "@/components/client/features/chat/MessageList";
import NewMessageFloatingNotice from "@/components/client/features/chat/NewMessageFloatingNotice";
import type { ConnectionStatus } from "@/components/client/features/notice/NotificationProvider";
import Link from "@/components/ui/Link";
import UserAvatar from "@/components/ui/UserAvatar";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { useOptimisticMessages } from "@/hooks/use-optimistic-messages";
import { getConversationMessages } from "@/lib/client/api/message-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import {
  Menu,
  MenuAction,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/ui/Menu";
import { useToast } from "@/ui/Toast";

interface ChatWindowProps {
  conversation?: Conversation; // 可选，临时会话时为空
  temporaryTargetUser?: ConversationUser | null; // 临时目标用户
  currentUserId: number;
  conversationKey: string; // 用于区分不同会话的唯一标识符
  onDeleteConversation: (conversationId: string) => void;
  onConversationCreated?: (conversationId: string) => void; // 会话创建回调
  onMessageSent?: (conversationId: string, message: Message) => void; // 消息发送成功回调
  polledMessages?: Message[]; // 轮询获取的消息
  polledOtherUserLastReadMessageId?: string | null; // 轮询获取的对方已读消息ID
  onSendReadReceipt?: (lastReadMessageId: string) => void; // 发送已读标记回调
  connectionStatus?: ConnectionStatus; // WebSocket 连接状态
  showBackButton?: boolean;
  onBack?: () => void;
}

export default function ChatWindow({
  conversation,
  temporaryTargetUser,
  currentUserId,
  conversationKey,
  onDeleteConversation,
  onConversationCreated,
  onMessageSent,
  polledMessages = [],
  polledOtherUserLastReadMessageId = null,
  onSendReadReceipt,
  connectionStatus = "fallback",
  showBackButton = false,
  onBack,
}: ChatWindowProps) {
  // 使用现有会话或临时用户信息
  const otherUser = conversation?.otherUser || temporaryTargetUser;
  const conversationId = conversation?.conversationId;
  const isTemporaryConversation = !conversation && !!temporaryTargetUser;

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showNewMessageNotice, setShowNewMessageNotice] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  const [isOtherUserInChatChannel, setIsOtherUserInChatChannel] =
    useState(false);
  const messageListRef = useRef<MessageListRef>(null);
  const toast = useToast();
  const lastMessageIdRef = useRef<string | null>(null); // 记录最后一条消息的 ID
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingBroadcastIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { broadcast } = useBroadcastSender();

  const {
    messages,
    addOptimisticMessage,
    updateMessageStatus,
    markMessageFailed,
    retryMessage,
    updateReadStatus,
    resetMessages,
    appendMessages,
    addMessages,
  } = useOptimisticMessages();

  // 监听来自 WebSocket 的新消息（直接添加到当前会话）
  useBroadcast<{
    type: "append_message_to_conversation";
    conversationId: string;
    message: {
      id: string;
      content: string;
      type: "TEXT" | "SYSTEM";
      senderUid: number;
      createdAt: string;
    };
  }>((msg) => {
    if (
      msg.type === "append_message_to_conversation" &&
      msg.conversationId === conversationId
    ) {
      console.log(
        "[ChatWindow] Received new message from WebSocket:",
        msg.message.id,
      );
      // 直接添加消息，不需要通过 polledMessages
      appendMessages([
        {
          ...msg.message,
          createdAt:
            typeof msg.message.createdAt === "string"
              ? msg.message.createdAt
              : new Date(msg.message.createdAt).toISOString(),
        },
      ]);

      // 如果消息不是当前用户发送的，立即标记为已读
      // 这样可以防止未读数增加（因为用户正在查看该会话）
      if (msg.message.senderUid !== currentUserId && conversationId) {
        console.log(
          "[ChatWindow] Auto-marking conversation as read (user is viewing)",
        );
        markConversationAsRead(conversationId).then((result) => {
          if (result.success && result.data) {
            // 广播未读数更新
            broadcast({
              type: "unread_message_count_update",
              count: result.data.unreadMessageCount,
            });
          }
        });
      }
    }
  });

  // 监听对方正在输入的状态
  useBroadcast<{
    type: "user_typing";
    conversationId: string;
    userUid: number;
  }>((msg) => {
    if (
      msg.type === "user_typing" &&
      msg.conversationId === conversationId &&
      msg.userUid === otherUser?.uid
    ) {
      setIsOtherUserTyping(true);

      // 清除之前的定时器
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // 5秒后自动隐藏
      typingTimeoutRef.current = setTimeout(() => {
        setIsOtherUserTyping(false);
      }, 5000);
    }
  });

  // 监听对方在 chat 频道的在线状态
  useBroadcast<{
    type: "chat_presence_update";
    conversationId: string;
    isOnline: boolean;
  }>((msg) => {
    if (
      msg.type === "chat_presence_update" &&
      msg.conversationId === conversationId
    ) {
      console.log("[ChatWindow] Received chat presence update:", msg.isOnline);
      setIsOtherUserInChatChannel(msg.isOnline);
    }
  });

  // 当会话切换时，立即清空消息（避免显示上一个会话的内容）
  useEffect(() => {
    resetMessages([]);
    setIsLoadingMessages(true); // 开始加载
    setShowNewMessageNotice(false); // 隐藏新消息提示
    setNewMessageCount(0); // 重置计数
    lastMessageIdRef.current = null; // 重置最后一条消息 ID
    setIsOtherUserTyping(false); // 重置对方输入状态
    setIsOtherUserInChatChannel(false); // 重置对方在线状态

    // 清理输入信号发送定时器
    if (typingBroadcastIntervalRef.current) {
      clearInterval(typingBroadcastIntervalRef.current);
      typingBroadcastIntervalRef.current = null;
    }

    // 清理输入状态超时定时器
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  }, [conversationKey, resetMessages]);

  // 加载初始消息
  useEffect(() => {
    const loadInitialMessages = async () => {
      if (!conversationId) {
        setIsLoadingMessages(false);
        return;
      }

      try {
        setIsLoadingMessages(true);
        const result = await getConversationMessages(conversationId, 0, 25);

        if (result.success && result.data) {
          // 完全使用服务器数据，不保留本地乐观消息
          resetMessages(result.data.messages);

          // 初始化最后一条消息 ID
          if (result.data.messages.length > 0) {
            const lastMsg =
              result.data.messages[result.data.messages.length - 1];
            if (lastMsg) {
              lastMessageIdRef.current = lastMsg.id;
            }
          }

          // 立即应用已读状态
          if (result.data.otherUserLastReadMessageId) {
            updateReadStatus(result.data.otherUserLastReadMessageId);
          }
        }
      } catch (error) {
        console.error("加载消息失败:", error);
      } finally {
        setIsLoadingMessages(false);
      }
    };

    loadInitialMessages();
  }, [conversationId, resetMessages, updateReadStatus]);

  // 处理轮询获取的新消息和已读状态
  useEffect(() => {
    // 轮询返回的是完整的消息列表（最新25条），需要过滤出真正的新消息
    if (polledMessages.length > 0) {
      // appendMessages 内部会自动去重，只添加真正的新消息
      // 但不传入 lastReadMessageId，避免覆盖已有消息的状态
      appendMessages(polledMessages);
    }

    // 单独更新已读状态，不影响消息的添加
    if (polledOtherUserLastReadMessageId) {
      updateReadStatus(polledOtherUserLastReadMessageId);
    }
  }, [
    polledMessages,
    polledOtherUserLastReadMessageId,
    appendMessages,
    updateReadStatus,
    conversationId,
  ]);

  // 处理加载更多历史消息
  const handleLoadMoreMessages = async (skip: number): Promise<boolean> => {
    if (!conversationId) return false;

    try {
      const result = await getConversationMessages(conversationId, skip, 25);

      if (result.success && result.data) {
        // 先添加消息
        addMessages(result.data.messages);

        // 立即更新已读状态
        if (result.data.otherUserLastReadMessageId) {
          // 强制立即应用已读状态到新加载的消息
          updateReadStatus(result.data.otherUserLastReadMessageId);
        }

        return result.data.hasMore;
      }
      return false;
    } catch (error) {
      console.error("加载更多消息失败:", error);
      return false;
    }
  };

  // 处理发送消息
  const handleSendMessage = async (content: string) => {
    if (!content.trim() || !otherUser) return;

    // 添加乐观消息
    const tempId = addOptimisticMessage(content, currentUserId);

    try {
      const result = await sendMessage(otherUser.uid, content, tempId);

      if (result.success && result.data) {
        // 更新消息状态，用真实 ID 替换临时 ID
        updateMessageStatus(tempId, result.data.message, "sent");

        // 如果是临时会话且会话被创建，调用回调
        if (
          isTemporaryConversation &&
          result.data.conversationId &&
          onConversationCreated
        ) {
          onConversationCreated(result.data.conversationId);
        }

        // 通知父组件消息已发送（用于更新会话列表）
        if (onMessageSent && result.data.conversationId) {
          onMessageSent(result.data.conversationId, result.data.message);
        }

        // 滚动到底部
        if (messageListRef.current) {
          messageListRef.current.scrollToBottom();
        }
      } else {
        // 标记为失败
        markMessageFailed(tempId);

        // 显示错误提示
        toast.error(result.error?.message || "发送失败");
      }
    } catch {
      markMessageFailed(tempId);
      toast.error("发送失败，请重试");
    }
  };

  // 处理重试发送
  const handleRetryMessage = async (tempId: string, content: string) => {
    if (!otherUser) return;

    retryMessage(tempId);

    try {
      const result = await sendMessage(otherUser.uid, content, tempId);

      if (result.success && result.data) {
        updateMessageStatus(tempId, result.data.message, "sent");

        // 如果是临时会话且会话被创建，调用回调
        if (
          isTemporaryConversation &&
          result.data.conversationId &&
          onConversationCreated
        ) {
          onConversationCreated(result.data.conversationId);
        }

        // 通知父组件消息已发送（用于更新会话列表）
        if (onMessageSent && result.data.conversationId) {
          onMessageSent(result.data.conversationId, result.data.message);
        }
      } else {
        markMessageFailed(tempId);
        toast.error(result.error?.message || "发送失败");
      }
    } catch {
      markMessageFailed(tempId);
      toast.error("发送失败，请重试");
    }
  };

  // 处理删除会话
  const handleDeleteConversation = async () => {
    if (!conversationId) return; // 临时会话不能删除

    setIsDeleting(true);
    try {
      const { deleteConversation } = await import("@/actions/message");
      const result = await deleteConversation(conversationId);

      if (result.success) {
        setShowDeleteDialog(false);
        onDeleteConversation(conversationId);
        toast.success("会话已删除");
      } else {
        toast.error(result.error?.message || "删除失败");
      }
    } catch {
      toast.error("删除失败，请重试");
    } finally {
      setIsDeleting(false);
    }
  };

  // 处理滚动位置变化
  const handleScrollChange = (atBottom: boolean) => {
    setIsAtBottom(atBottom);

    // 如果滚动到底部，隐藏新消息提示并重置计数
    if (atBottom) {
      setShowNewMessageNotice(false);
      setNewMessageCount(0);
      // 更新最后一条消息 ID
      if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (lastMsg) {
          lastMessageIdRef.current = lastMsg.id;

          // 发送已读标记（只有当最后一条消息不是自己发的时候）
          if (lastMsg.senderUid !== currentUserId && onSendReadReceipt) {
            console.log("[ChatWindow] Sending read receipt for:", lastMsg.id);
            onSendReadReceipt(lastMsg.id);
          }
        }
      }
    }
  };

  // 监听新消息，如果不在底部显示提示并计数
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) {
      return;
    }

    // 检查是否有新消息（通过最后一条消息的 ID 判断）
    const isNewMessage = lastMessageIdRef.current !== lastMessage.id;

    if (isNewMessage && !isAtBottom) {
      // 只有当最后一条消息是对方发的，才显示提示
      if (lastMessage.senderUid !== currentUserId) {
        // 计算新消息数量：找到上次记录的消息 ID 之后的所有消息
        let newCount = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg && msg.id === lastMessageIdRef.current) {
            break;
          }
          if (msg && msg.senderUid !== currentUserId) {
            newCount++;
          }
        }

        if (newCount > 0) {
          setShowNewMessageNotice(true);
          setNewMessageCount(newCount);
        }
      }

      // 更新最后一条消息 ID
      lastMessageIdRef.current = lastMessage.id;
    }
  }, [messages, isAtBottom, currentUserId]);

  // 处理点击新消息提示 - 使用平滑滚动
  const handleScrollToBottom = () => {
    if (messageListRef.current) {
      messageListRef.current.scrollToBottom(true); // 启用平滑滚动
    }
    setShowNewMessageNotice(false);
    setNewMessageCount(0);
  };

  // 处理用户输入（用于发送正在输入信号）
  const handleUserTyping = useCallback(() => {
    if (!conversationId || connectionStatus !== "connected") return;

    // 如果还没有启动间隔发送，启动它
    if (!typingBroadcastIntervalRef.current) {
      // 立即发送第一次
      broadcast({
        type: "send_typing_signal",
        conversationId,
        userUid: currentUserId,
      });

      // 然后每3秒发送一次
      typingBroadcastIntervalRef.current = setInterval(() => {
        broadcast({
          type: "send_typing_signal",
          conversationId,
          userUid: currentUserId,
        });
      }, 3000);
    }
  }, [conversationId, connectionStatus, currentUserId, broadcast]);

  // 处理用户停止输入
  const handleUserStopTyping = useCallback(() => {
    if (typingBroadcastIntervalRef.current) {
      clearInterval(typingBroadcastIntervalRef.current);
      typingBroadcastIntervalRef.current = null;
    }
  }, []);

  // 如果没有用户信息，返回空
  if (!otherUser) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <p>加载用户信息失败</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-foreground/10 bg-background">
        <div className="flex items-center justify-between">
          {/* 用户信息 */}
          <div className="flex min-w-0 items-center gap-3">
            {showBackButton && onBack && (
              <button
                type="button"
                onClick={onBack}
                className="-ml-2 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors duration-200 hover:bg-foreground/5 hover:text-foreground"
                aria-label="返回会话列表"
              >
                <RiArrowLeftLine size="1.2em" />
              </button>
            )}

            <AutoTransition type="slide">
              <div
                className="flex min-w-0 items-center gap-3"
                key={otherUser.uid}
              >
                <Link href={`/user/${otherUser.uid}`}>
                  <UserAvatar
                    username={otherUser.nickname || otherUser.username}
                    avatarUrl={otherUser.avatar}
                    emailMd5={otherUser.emailMd5}
                    shape="circle"
                    className="!block w-10 h-10"
                  />
                </Link>
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-foreground">
                    {otherUser.nickname || otherUser.username}
                  </h2>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">@{otherUser.username}</span>
                    <AutoTransition>
                      {connectionStatus === "connected" &&
                        conversationId &&
                        isOtherUserInChatChannel && (
                          <AutoTransition>
                            {/* 正在输入提示 */}
                            {isOtherUserTyping ? (
                              <div key="inputing">正在输入...</div>
                            ) : (
                              <div
                                className="flex items-center gap-1"
                                key="online-status"
                              >
                                <div className="relative w-3 h-3 flex items-center justify-center">
                                  <span
                                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-success opacity-75 animate-ping"
                                    style={{ animationDuration: "2s" }}
                                  />
                                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-success" />
                                </div>
                                <span className="text-success/90">
                                  对方在当前会话中
                                </span>
                              </div>
                            )}
                          </AutoTransition>
                        )}
                    </AutoTransition>
                  </p>
                </div>
              </div>
            </AutoTransition>
          </div>

          {/* 更多菜单（仅在非临时会话时显示） */}
          {!isTemporaryConversation && (
            <Menu orientation="vertical">
              <MenuItem value="more">
                <MenuTrigger asChild>
                  <Clickable>
                    <RiMoreLine size="1.5em" />
                  </Clickable>
                </MenuTrigger>
                <MenuContent align="end" minWidth={160}>
                  <MenuAction
                    icon={<RiDeleteBinLine size="1em" className="text-error" />}
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-error"
                  >
                    删除会话
                  </MenuAction>
                </MenuContent>
              </MenuItem>
            </Menu>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <AutoTransition className="flex-1 relative overflow-hidden">
        {isLoadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <LoadingIndicator size="md" />
          </div>
        ) : (
          <MessageList
            key={conversationKey}
            ref={messageListRef}
            messages={messages}
            currentUserId={currentUserId}
            conversationId={conversationId || ""}
            onScrollChange={handleScrollChange}
            onRetryMessage={handleRetryMessage}
            onLoadMoreMessages={handleLoadMoreMessages}
          />
        )}

        {/* 新消息提示 */}
        <AutoTransition type="slideUp">
          {showNewMessageNotice && (
            <NewMessageFloatingNotice
              onClick={handleScrollToBottom}
              count={newMessageCount}
            />
          )}
        </AutoTransition>
      </AutoTransition>

      {/* 输入框 */}
      <div className="flex-shrink-0 border-t border-foreground/10 bg-background">
        <MessageInput
          onSendMessage={handleSendMessage}
          onTyping={handleUserTyping}
          onStopTyping={handleUserStopTyping}
        />
      </div>

      {/* 删除确认对话框 */}
      <AlertDialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        title="删除会话"
        description={`确定要删除与 ${otherUser.nickname || otherUser.username} 的会话吗？此操作不可恢复。`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleDeleteConversation}
        loading={isDeleting}
        variant="danger"
      />
    </div>
  );
}
