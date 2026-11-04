"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RiQuestionAnswerLine } from "@remixicon/react";
import type {
  Conversation,
  ConversationUser,
  Message,
} from "@repo/shared-types/api/message";
import { useSearchParams } from "next/navigation";

import ChatWindow from "@/components/client/features/chat/ChatWindow";
import ConversationList from "@/components/client/features/chat/ConversationList";
import { useNotification } from "@/components/client/features/notice/NotificationProvider";
import { useBroadcast } from "@/hooks/use-broadcast";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { useMessagePolling } from "@/hooks/use-message-polling";
import { useMobile } from "@/hooks/use-mobile";
import { getConversations, searchUsers } from "@/lib/client/api/message-read";
import { AutoTransition } from "@/ui/AutoTransition";

const MOBILE_CHAT_HISTORY_STATE_KEY = "neutralPressMessagesMobileChat";

function getMobileConversationStateValue(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const value = (state as Record<string, unknown>)[
    MOBILE_CHAT_HISTORY_STATE_KEY
  ];
  return typeof value === "string" && value.length > 0 ? value : null;
}

interface MessagesClientProps {
  initialConversations: Conversation[];
  initialTotal: number;
  initialHasMore: boolean;
  currentUserId: number;
  isModal?: boolean;
  onRequestClose?: (targetPath?: string) => void;
  onMobileConversationStateChange?: (isConversationOpen: boolean) => void;
}

export default function MessagesClient({
  initialConversations,
  initialTotal,
  initialHasMore,
  currentUserId,
  isModal = false,
  onMobileConversationStateChange,
}: MessagesClientProps) {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations);
  const [total, setTotal] = useState(initialTotal);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [temporaryTargetUser, setTemporaryTargetUser] =
    useState<ConversationUser | null>(null);
  const [temporaryLastMessage, setTemporaryLastMessage] = useState<{
    content: string;
    createdAt: string;
    senderUid: number;
  } | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const allConversationsRef = useRef<Conversation[]>(initialConversations);
  const processedUidParamRef = useRef<string | null>(null);
  const [_isLoadingTargetUser, setIsLoadingTargetUser] = useState(false);
  const isMobile = useMobile();
  const searchParams = useSearchParams();
  const { removeMessageNotificationsByConversation, connectionStatus } =
    useNotification();
  const { broadcast } = useBroadcastSender();

  // 监听已读状态更新（来自 WebSocket）
  const [wsOtherUserLastReadMessageId, setWsOtherUserLastReadMessageId] =
    useState<string | null>(null);

  useBroadcast<{
    type: "read_receipt_update";
    conversationId: string;
    otherUserLastReadMessageId: string;
  }>((message) => {
    if (
      message.type === "read_receipt_update" &&
      message.conversationId === selectedConversationId
    ) {
      console.log(
        "[MessagesClient] Received read receipt update:",
        message.otherUserLastReadMessageId,
      );
      setWsOtherUserLastReadMessageId(message.otherUserLastReadMessageId);
    }
  });

  // 监听来自 WebSocket 的新私信消息广播
  useBroadcast<{
    type: "new_private_message";
    conversationId: string;
    message: {
      id: string;
      content: string;
      type: "TEXT" | "SYSTEM";
      senderUid: number;
      createdAt: string;
    };
    sender: {
      uid: number;
      username: string;
      nickname: string | null;
    };
    messageCount: number;
  }>((message) => {
    if (message.type === "new_private_message") {
      const { conversationId, message: newMsg, sender, messageCount } = message;

      console.log(
        "[MessagesClient] Received new private message from WebSocket:",
        conversationId,
      );

      // 更新私信未读数
      if (typeof messageCount === "number") {
        // 这个会通过 NotificationProvider 的 localStorage 同步机制更新
      }

      // 更新会话列表
      setConversations((prev) => {
        const existingIndex = prev.findIndex(
          (conv) => conv.conversationId === conversationId,
        );

        const lastMessage = {
          content: newMsg.content,
          createdAt: newMsg.createdAt,
          senderUid: newMsg.senderUid,
        };

        if (existingIndex >= 0) {
          // 更新现有会话
          const updated = [...prev];
          const conversation = updated[existingIndex];

          if (!conversation) return prev;

          // 如果当前会话是打开的，不增加未读数
          const isCurrentConversation =
            selectedConversationId === conversationId;

          updated[existingIndex] = {
            ...conversation,
            lastMessage,
            lastMessageAt: newMsg.createdAt,
            unreadCount: isCurrentConversation
              ? 0
              : (conversation.unreadCount || 0) + 1,
          };

          // 将更新的会话移到最前面
          const [movedConv] = updated.splice(existingIndex, 1);
          if (!movedConv) return prev;
          return [movedConv, ...updated];
        } else {
          // 新会话，添加到列表顶部
          const newConversation: Conversation = {
            conversationId,
            otherUser: {
              ...sender,
              avatar: null,
              role: "USER" as const,
              emailMd5: null,
            },
            lastMessage,
            lastMessageAt: new Date(newMsg.createdAt).toISOString(),
            updatedAt: new Date(newMsg.createdAt).toISOString(),
            unreadCount: selectedConversationId === conversationId ? 0 : 1,
            otherUserLastReadMessageId: null,
          };

          return [newConversation, ...prev];
        }
      });

      // 注意：不再在这里直接更新 currentConversationMessages
      // 而是通过 NotificationProvider 的广播直接发送给 ChatWindow
    }
  });

  // 处理会话更新（轮询或 WebSocket 回调）
  const handleConversationsUpdate = useCallback(
    (updatedConversations: Conversation[]) => {
      setConversations((prev) => {
        // 创建一个 Map 用于快速查找
        const updatedMap = new Map(
          updatedConversations.map((conv) => [conv.conversationId, conv]),
        );

        // 更新现有会话或添加新会话
        const merged = prev.map((conv) => {
          const updated = updatedMap.get(conv.conversationId);
          if (updated) {
            updatedMap.delete(conv.conversationId);

            // 如果本地的 lastMessageAt 更新（说明有乐观更新），保留本地数据
            const localTime = new Date(conv.lastMessageAt).getTime();
            const serverTime = new Date(updated.lastMessageAt).getTime();

            if (localTime > serverTime) {
              // 本地数据更新，保留本地的 lastMessage 和 lastMessageAt
              return {
                ...updated,
                lastMessage: conv.lastMessage,
                lastMessageAt: conv.lastMessageAt,
              };
            }

            return updated;
          }
          return conv;
        });

        // 添加新的会话到开头
        const newConversations = Array.from(updatedMap.values());
        const allConversations = [...newConversations, ...merged];

        // 按最后一条消息的时间降序排序（最新的在前面）
        // 使用 lastMessageAt 字段（从数据库获取），只在有新消息时更新，不在标记已读时更新
        return allConversations.sort((a, b) => {
          const aTime = new Date(a.lastMessageAt).getTime();
          const bTime = new Date(b.lastMessageAt).getTime();
          return bTime - aTime;
        });
      });

      // 如果当前打开的会话在更新列表中，更新其已读状态
      if (selectedConversationId) {
        const currentConvUpdated = updatedConversations.find(
          (conv) => conv.conversationId === selectedConversationId,
        );
        if (currentConvUpdated?.otherUserLastReadMessageId) {
          setPolledOtherUserLastReadMessageId(
            currentConvUpdated.otherUserLastReadMessageId,
          );
        }
      }

      // 如果有临时用户，检查是否有对应的正式会话出现
      if (temporaryTargetUser) {
        const matchingConversation = updatedConversations.find(
          (conv) => conv.otherUser.uid === temporaryTargetUser.uid,
        );
        if (matchingConversation) {
          // 找到对应的正式会话，切换过去
          setTemporaryTargetUser(null);
          setTemporaryLastMessage(null);
          // 只有当前选中的是临时会话时才切换到正式会话
          if (
            selectedConversationId?.startsWith(
              `temp-${temporaryTargetUser.uid}`,
            )
          ) {
            setSelectedConversationId(matchingConversation.conversationId);
          }
        }
      }
    },
    [selectedConversationId, temporaryTargetUser],
  );

  // 处理当前会话消息更新（轮询回调）
  const [currentConversationMessages, setCurrentConversationMessages] =
    useState<Message[]>([]);
  const [
    polledOtherUserLastReadMessageId,
    setPolledOtherUserLastReadMessageId,
  ] = useState<string | null>(null);

  const handleCurrentConversationUpdate = useCallback(
    (messages: Message[], otherUserLastReadMessageId: string | null) => {
      setCurrentConversationMessages(messages);
      setPolledOtherUserLastReadMessageId(otherUserLastReadMessageId);
    },
    [],
  );

  // 启用消息更新：WebSocket 连接时使用 WebSocket，否则使用轮询
  useMessagePolling({
    enabled: true,
    connectionStatus, // 传入 WebSocket 连接状态
    onConversationsUpdate: handleConversationsUpdate,
    onCurrentConversationUpdate: handleCurrentConversationUpdate,
    currentConversationId: selectedConversationId,
  });

  // 处理发送已读回执
  const handleSendReadReceipt = useCallback(
    (lastReadMessageId: string) => {
      // 如果 WebSocket 已连接，通过 WebSocket 发送已读标记
      if (connectionStatus === "connected" && selectedConversationId) {
        console.log(
          "[MessagesClient] Sending read receipt via WebSocket:",
          lastReadMessageId,
        );
        broadcast({
          type: "send_read_receipt",
          conversationId: selectedConversationId,
          lastReadMessageId,
        });
      }
      // 否则依赖 ChatWindow 内部的 markAsRead action
    },
    [connectionStatus, selectedConversationId, broadcast],
  );

  const clearConversationSelection = useCallback(() => {
    if (selectedConversationId?.startsWith("temp-")) {
      setTemporaryTargetUser(null);
      setTemporaryLastMessage(null);
    }

    setSelectedConversationId(null);
    setMobileView("list");
  }, [selectedConversationId]);

  const pushMobileConversationHistoryState = useCallback(
    (conversationId: string) => {
      if (!isMobile || typeof window === "undefined") {
        return;
      }

      if (getMobileConversationStateValue(window.history.state)) {
        return;
      }

      const baseState =
        window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {};

      window.history.pushState(
        {
          ...baseState,
          [MOBILE_CHAT_HISTORY_STATE_KEY]: conversationId,
        },
        "",
        window.location.href,
      );
    },
    [isMobile],
  );

  const returnToConversationList = useCallback(() => {
    if (!isMobile || typeof window === "undefined") {
      clearConversationSelection();
      return;
    }

    if (getMobileConversationStateValue(window.history.state)) {
      window.history.back();
      return;
    }

    clearConversationSelection();
  }, [clearConversationSelection, isMobile]);

  // 当选中的会话变化时，订阅/取消订阅 chat 频道并清空消息缓存
  useEffect(() => {
    setCurrentConversationMessages([]);
    setPolledOtherUserLastReadMessageId(null);
    setWsOtherUserLastReadMessageId(null);

    // 如果有选中的会话且 WebSocket 已连接，订阅 chat 频道
    if (selectedConversationId && connectionStatus === "connected") {
      console.log(
        `[MessagesClient] Subscribing to chat channel: ${selectedConversationId}`,
      );
      broadcast({
        type: "subscribe_chat_channel",
        conversationId: selectedConversationId,
      });

      return () => {
        console.log(
          `[MessagesClient] Unsubscribing from chat channel: ${selectedConversationId}`,
        );
        broadcast({
          type: "unsubscribe_chat_channel",
          conversationId: selectedConversationId,
        });
      };
    }
  }, [selectedConversationId, connectionStatus, broadcast]); // 移除 broadcast，它是稳定的

  // 处理会话选择
  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      // 如果是临时会话，只设置选中状态，不做其他处理
      if (conversationId.startsWith("temp-")) {
        setSelectedConversationId(conversationId);
        return;
      }

      // 移除该会话的所有消息通知
      removeMessageNotificationsByConversation?.(conversationId);

      // 立即更新本地会话列表，清除未读数
      setConversations((prev) =>
        prev.map((conv) =>
          conv.conversationId === conversationId
            ? { ...conv, unreadCount: 0 }
            : conv,
        ),
      );

      // 选择会话，不清空临时用户（允许临时会话继续存在于列表中）
      setSelectedConversationId(conversationId);
      if (isMobile) {
        setMobileView("chat");
        pushMobileConversationHistoryState(conversationId);
      }
    },
    [
      isMobile,
      pushMobileConversationHistoryState,
      removeMessageNotificationsByConversation,
    ],
  );

  // 处理 URL 中的 conversation 参数，自动打开指定会话
  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (conversationId && conversations.length > 0) {
      // 检查该会话是否存在
      const conversation = conversations.find(
        (conv) => conv.conversationId === conversationId,
      );
      if (conversation && selectedConversationId !== conversationId) {
        // 清除 URL 中的 conversation 参数，避免重复触发
        const url = new URL(window.location.href);
        url.searchParams.delete("conversation");
        window.history.replaceState(window.history.state, "", url.toString());

        handleSelectConversation(conversationId);
      }
    }
  }, [
    searchParams,
    conversations,
    selectedConversationId,
    handleSelectConversation,
  ]);

  // 处理新会话
  const handleNewConversation = useCallback(
    async (uid: number) => {
      // 先检查是否已有会话
      const existingConversation = conversations.find(
        (conv) => conv.otherUser.uid === uid,
      );

      if (existingConversation) {
        // 如果已有会话，直接选择
        handleSelectConversation(existingConversation.conversationId);
        return;
      }

      // 加载目标用户信息
      setIsLoadingTargetUser(true);
      try {
        const result = await searchUsers(uid.toString());

        if (result.success && result.data && result.data.users.length > 0) {
          const user =
            result.data.users.find((item) => item.uid === uid) ||
            result.data.users[0];
          if (user) {
            // 设置临时用户并选中临时会话
            setTemporaryTargetUser(user);
            setTemporaryLastMessage(null);
            const temporaryConversationId = `temp-${user.uid}`;
            setSelectedConversationId(temporaryConversationId);
            if (isMobile) {
              setMobileView("chat");
              pushMobileConversationHistoryState(temporaryConversationId);
            }
          }
        }
      } catch (error) {
        console.error("加载用户信息失败:", error);
      } finally {
        setIsLoadingTargetUser(false);
      }
    },
    [
      conversations,
      handleSelectConversation,
      isMobile,
      pushMobileConversationHistoryState,
    ],
  );

  // 处理 URL 中的 uid 参数，自动打开已有会话或创建临时会话
  useEffect(() => {
    // 如果已指定 conversation，优先使用 conversation 参数
    if (searchParams.get("conversation")) {
      return;
    }

    const uidParam = searchParams.get("uid");
    if (!uidParam) {
      processedUidParamRef.current = null;
      return;
    }

    if (processedUidParamRef.current === uidParam) {
      return;
    }
    processedUidParamRef.current = uidParam;

    const parsedUid = Number.parseInt(uidParam, 10);
    if (
      !Number.isFinite(parsedUid) ||
      parsedUid <= 0 ||
      parsedUid === currentUserId
    ) {
      const url = new URL(window.location.href);
      url.searchParams.delete("uid");
      window.history.replaceState(window.history.state, "", url.toString());
      return;
    }

    // 清除 URL 中的 uid 参数，避免重复触发
    const url = new URL(window.location.href);
    url.searchParams.delete("uid");
    window.history.replaceState(window.history.state, "", url.toString());

    void handleNewConversation(parsedUid);
  }, [searchParams, currentUserId, handleNewConversation]);

  // 处理会话删除
  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.filter((conv) => conv.conversationId !== conversationId),
      );
      setTotal((prev) => prev - 1);

      // 如果删除的是当前选中的会话，清空选择
      if (selectedConversationId === conversationId) {
        if (isMobile) {
          returnToConversationList();
        } else {
          setSelectedConversationId(null);
        }
      }
    },
    [isMobile, returnToConversationList, selectedConversationId],
  );

  // 处理消息发送成功（立即更新会话列表）
  const handleMessageSent = useCallback(
    (conversationId: string, message: Message) => {
      // 如果有临时用户，说明是临时会话发送的第一条消息
      // 此时 conversationId 是新创建的正式会话 ID，但我们需要更新临时会话的显示
      if (temporaryTargetUser) {
        setTemporaryLastMessage({
          content: message.content,
          createdAt: message.createdAt,
          senderUid: message.senderUid,
        });
        return;
      }

      setConversations((prev) => {
        // 找到对应的会话
        const targetConv = prev.find(
          (conv) => conv.conversationId === conversationId,
        );
        if (!targetConv) return prev;

        // 更新会话的最后消息和时间
        const updatedConv = {
          ...targetConv,
          lastMessage: {
            content: message.content,
            createdAt: message.createdAt,
            senderUid: message.senderUid,
          },
          updatedAt: message.createdAt,
          lastMessageAt: message.createdAt, // 更新最后消息时间
        };

        // 将更新后的会话移到列表顶部
        const otherConvs = prev.filter(
          (conv) => conv.conversationId !== conversationId,
        );
        return [updatedConv, ...otherConvs];
      });
    },
    [temporaryTargetUser],
  );

  // 处理加载更多会话
  const handleLoadMore = useCallback(
    async (skip: number) => {
      // 如果有临时会话,需要减去1(临时会话不应计入 skip)
      const actualSkip = temporaryTargetUser ? skip - 1 : skip;
      if (actualSkip < 0) return; // 防止负数

      const result = await getConversations(undefined, actualSkip, 20);

      if (result.success && result.data) {
        setConversations((prev) => [...prev, ...result.data!.conversations]);
        setHasMore(result.data.hasMore);
      }
    },
    [temporaryTargetUser],
  );

  // 处理新会话创建成功
  const handleConversationCreated = useCallback((conversationId: string) => {
    // 会话创建后，清除未读标记
    setConversations((prev) =>
      prev.map((conv) =>
        conv.conversationId === conversationId
          ? { ...conv, unreadCount: 0 }
          : conv,
      ),
    );

    // 不立即设置 selectedConversationId 或清空 temporaryTargetUser
    // 保持临时会话状态，让轮询自然检测到新会话后自动切换
    // 这样可以避免中间状态的加载指示器闪现
  }, []);

  // 获取当前选中的会话信息
  const selectedConversation = conversations.find(
    (conv) => conv.conversationId === selectedConversationId,
  );

  // 构建完整的会话列表(包含临时会话)
  const allConversations = temporaryTargetUser
    ? [
        // 临时会话(虚拟对象,仅在内存中)
        {
          conversationId: `temp-${temporaryTargetUser.uid}`,
          otherUser: temporaryTargetUser,
          lastMessage: temporaryLastMessage,
          unreadCount: 0,
          updatedAt: new Date().toISOString(),
          lastMessageAt: new Date().toISOString(),
          otherUserLastReadMessageId: null,
        },
        ...conversations,
      ]
    : conversations;
  allConversationsRef.current = allConversations;

  useEffect(() => {
    if (!isMobile || typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const nextConversationId = getMobileConversationStateValue(event.state);

      if (nextConversationId) {
        setMobileView("chat");

        const matchedConversation = allConversationsRef.current.find(
          (conversation) => conversation.conversationId === nextConversationId,
        );
        if (matchedConversation) {
          setSelectedConversationId(nextConversationId);
        }
        return;
      }

      clearConversationSelection();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [clearConversationSelection, isMobile]);

  // 判断是否显示聊天窗口
  // 如果 selectedConversationId 存在（无论是临时会话还是正式会话），就显示聊天窗口
  const shouldShowChatWindow = !!selectedConversationId;
  const isMobileConversationOpen =
    isMobile && mobileView === "chat" && shouldShowChatWindow;
  const shouldShowConversationList = !isMobile || !isMobileConversationOpen;
  const shouldRenderChatPane = !isMobile || isMobileConversationOpen;

  // 确定要显示的会话：优先使用 selectedConversation，如果是临时会话则使用 null
  const conversationToShow = selectedConversationId?.startsWith("temp-")
    ? undefined
    : selectedConversation;

  // 确定要显示的临时用户：只有当选中的是临时会话时才传递
  const temporaryUserToShow = selectedConversationId?.startsWith("temp-")
    ? temporaryTargetUser
    : null;

  // 合并已读状态：优先使用 WebSocket 的，fallback 到轮询的
  const effectiveOtherUserLastReadMessageId =
    wsOtherUserLastReadMessageId || polledOtherUserLastReadMessageId;

  useEffect(() => {
    onMobileConversationStateChange?.(isMobileConversationOpen);
  }, [isMobileConversationOpen, onMobileConversationStateChange]);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* 左侧：会话列表 */}
      {shouldShowConversationList && (
        <div
          className={
            isMobile
              ? "min-w-0 flex-1 bg-background"
              : `flex-shrink-0 border-r border-foreground/10 bg-background ${
                  isModal ? "w-80" : "w-96"
                }`
          }
        >
          <ConversationList
            conversations={allConversations}
            selectedConversationId={selectedConversationId}
            currentUserId={currentUserId}
            hasMore={hasMore}
            total={total}
            onSelectConversation={handleSelectConversation}
            onDeleteConversation={handleDeleteConversation}
            onLoadMore={handleLoadMore}
            isModal={isModal}
            onNewConversation={handleNewConversation}
          />
        </div>
      )}

      {/* 右侧：聊天窗口 */}
      {shouldRenderChatPane && (
        <AutoTransition
          className={
            isMobile
              ? "flex h-full w-full min-w-0 flex-col bg-background"
              : "flex min-w-0 flex-1 flex-col"
          }
        >
          {shouldShowChatWindow ? (
            <ChatWindow
              conversationKey={selectedConversationId || "unknown"}
              conversation={conversationToShow}
              temporaryTargetUser={temporaryUserToShow}
              currentUserId={currentUserId}
              onDeleteConversation={handleDeleteConversation}
              onConversationCreated={handleConversationCreated}
              onMessageSent={handleMessageSent}
              polledMessages={currentConversationMessages}
              polledOtherUserLastReadMessageId={
                effectiveOtherUserLastReadMessageId
              }
              onSendReadReceipt={handleSendReadReceipt}
              connectionStatus={connectionStatus}
              showBackButton={isMobileConversationOpen}
              onBack={returnToConversationList}
            />
          ) : (
            <div
              className="flex flex-1 flex-col items-center justify-center text-muted-foreground"
              key="empty-state"
            >
              <RiQuestionAnswerLine size="4em" className="mb-4" />
              <p className="text-lg">选择一个会话来开始聊天</p>
            </div>
          )}
        </AutoTransition>
      )}
    </div>
  );
}
