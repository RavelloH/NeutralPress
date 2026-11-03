"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
// 动态导入 Ably 类型
import type * as Ably from "ably";
import type {
  ErrorInfo,
  Message,
  PresenceMessage,
  Realtime,
  TokenDetails,
  TokenParams,
  TokenRequest,
} from "ably";

import { getAblyTokenRequest } from "@/actions/ably";
import { type MessageNotificationItem } from "@/components/client/features/notice/MessageNotificationToast";
import { type NotificationItem } from "@/components/client/features/notice/NotificationToast";
import UnifiedNotificationContainer from "@/components/client/features/notice/UnifiedNotificationContainer";
import UnreadNoticeTracker from "@/components/client/features/notice/UnreadNoticeTracker";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getUnreadNoticeCount } from "@/lib/client/api/public";

type AblyRealtime = Realtime;

/**
 * 从 localStorage 获取用户信息
 */
const getUserInfoFromStorage = (): { uid: number } | null => {
  try {
    const userInfo = localStorage.getItem("user_info");
    if (!userInfo) return null;

    const data = JSON.parse(userInfo);
    if (typeof data.uid === "number") {
      return { uid: data.uid };
    }
    return null;
  } catch (error) {
    console.error("[Notification] Failed to parse user_info:", error);
    return null;
  }
};

/**
 * 检查是否正在加载未读数量
 */
const isLoadingUnreadCount = (): boolean => {
  try {
    const loading = sessionStorage.getItem("unread_notice_loading");
    if (!loading) return false;

    const timestamp = parseInt(loading, 10);
    // 如果加载标志超过 10 秒，认为已过期
    return Date.now() - timestamp < 10000;
  } catch {
    return false;
  }
};

/**
 * 设置正在加载标志
 */
const setLoadingUnreadCount = (loading: boolean) => {
  try {
    if (loading) {
      sessionStorage.setItem("unread_notice_loading", Date.now().toString());
    } else {
      // 延迟清除标志，给 StrictMode 的第二次 mount 留出时间
      setTimeout(() => {
        sessionStorage.removeItem("unread_notice_loading");
      }, 3000);
    }
  } catch {
    // 忽略错误
  }
};

/**
 * 连接状态类型
 */
export type ConnectionStatus =
  | "idle" // 未连接
  | "connecting" // 连接中
  | "connected" // 已连接
  | "disconnected" // 断开连接
  | "suspended" // 连接挂起
  | "failed" // 连接失败
  | "fallback"; // 使用轮询回退

/**
 * 通知上下文值
 */
interface NotificationContextValue {
  connectionStatus: ConnectionStatus;
  unreadCount: number;
  unreadMessageCount: number; // 私信未读数
  isLeader: boolean; // 是否为主标签页（持有锁）
  removeMessageNotificationsByConversation?: (conversationId: string) => void; // 移除特定会话的所有消息通知
}

/**
 * 通知上下文
 */
const NotificationContext = createContext<NotificationContextValue>({
  connectionStatus: "fallback",
  unreadCount: 0,
  unreadMessageCount: 0,
  isLeader: false,
});

/**
 * 未读通知更新消息类型（组件内广播）
 */
interface UnreadNoticeUpdateMessage {
  type: "unread_notice_update";
  count: number;
}

interface UnreadMessageCountUpdateMessage {
  type: "unread_message_count_update";
  count: number;
}

/**
 * 新私信消息广播（推送到消息页面组件）
 */
interface NewPrivateMessageBroadcast {
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
}

/**
 * 新消息添加到当前会话（直接发送给 ChatWindow）
 */
interface AppendMessageToConversation {
  type: "append_message_to_conversation";
  conversationId: string;
  message: {
    id: string;
    content: string;
    type: "TEXT" | "SYSTEM";
    senderUid: number;
    createdAt: string;
  };
}

/**
 * 订阅 chat 频道请求（从 MessagesClient 发送到 NotificationProvider）
 */
interface SubscribeChatChannelMessage {
  type: "subscribe_chat_channel";
  conversationId: string;
}

/**
 * 取消订阅 chat 频道请求
 */
interface UnsubscribeChatChannelMessage {
  type: "unsubscribe_chat_channel";
  conversationId: string;
}

/**
 * 发送已读标记到 chat 频道
 */
interface SendReadReceiptMessage {
  type: "send_read_receipt";
  conversationId: string;
  lastReadMessageId: string;
}

/**
 * 已读状态更新广播（从 NotificationProvider 发送到 MessagesClient）
 */
interface ReadReceiptUpdateMessage {
  type: "read_receipt_update";
  conversationId: string;
  otherUserLastReadMessageId: string;
}

/**
 * 发送正在输入信号
 */
interface SendTypingSignalMessage {
  type: "send_typing_signal";
  conversationId: string;
  userUid: number;
}

/**
 * 正在输入广播（从 NotificationProvider 发送到 ChatWindow）
 */
interface UserTypingMessage {
  type: "user_typing";
  conversationId: string;
  userUid: number;
}

/**
 * Chat 频道在线状态更新（从 NotificationProvider 发送到 ChatWindow）
 */
interface ChatPresenceUpdateMessage {
  type: "chat_presence_update";
  conversationId: string;
  isOnline: boolean; // 对方是否在频道中
}

type BroadcastMessage =
  | UnreadNoticeUpdateMessage
  | UnreadMessageCountUpdateMessage
  | NewPrivateMessageBroadcast
  | AppendMessageToConversation
  | SubscribeChatChannelMessage
  | UnsubscribeChatChannelMessage
  | SendReadReceiptMessage
  | ReadReceiptUpdateMessage
  | SendTypingSignalMessage
  | UserTypingMessage
  | ChatPresenceUpdateMessage;

/**
 * 跨标签页消息类型
 */
interface CrossTabMessage {
  type:
    | "new_notice"
    | "unread_count_update"
    | "new_private_message"
    | "unread_message_count_update";
  payload: {
    id?: string;
    title?: string;
    content?: string;
    link?: string | null;
    createdAt?: string;
    count?: number;
    messageCount?: number; // 私信未读数
    conversationId?: string;
    message?: {
      id: string;
      content: string;
      type: "TEXT" | "SYSTEM";
      senderUid: number;
      createdAt: string;
    };
    sender?: {
      uid: number;
      username: string;
      nickname: string | null;
    };
  };
}

const MAX_RETRIES = 5;
const TOKEN_CACHE_DURATION = 50000; // Token 缓存时间 50 秒（Ably token 通常 60 秒有效）
const LOCK_NAME = "ably_connection_lock"; // Web Locks API 锁名称

/**
 * 通知 Provider 组件
 *
 * 使用 Web Locks API 管理多标签页的 Ably 连接。
 * 只有持有锁的标签页（主标签页）会建立 Ably 连接。
 *
 * @param props - 组件属性
 * @param props.children - 子组件
 */
export default function NotificationProvider({
  children,
  ablyEnabled,
}: {
  children: ReactNode;
  ablyEnabled: boolean;
}) {
  const isAblyEnabled = ablyEnabled;
  const { broadcast } = useBroadcastSender<BroadcastMessage>();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0); // 私信未读数
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [messageNotifications, setMessageNotifications] = useState<
    MessageNotificationItem[]
  >([]);

  // ============ Ably 连接相关 ============
  const ablyClientRef = useRef<AblyRealtime | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const AblyRef = useRef<typeof Ably | null>(null);
  const userUidRef = useRef<number | null>(null); // 存储用户 UID
  const tokenRequestCacheRef = useRef<{
    token: string | TokenRequest | TokenDetails;
    timestamp: number;
  } | null>(null); // Token 缓存

  // ============ Web Locks 相关 ============
  const lockControllerRef = useRef<AbortController | null>(null);
  const [isLeader, setIsLeader] = useState(false); // 是否持有锁（主标签页）
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false); // 用户是否已登录

  // ============ 跨标签页通信 ============
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // ============ Service Worker 注册 ============
  const [_swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  // ============ Chat 频道管理 ============
  const subscribedChatChannelsRef = useRef<
    Map<
      string,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        channel: any; // Ably RealtimeChannel 类型
        handler: (msg: Message) => void;
        typingHandler?: (msg: Message) => void;
        presenceHandler?: (msg: PresenceMessage) => void;
      }
    >
  >(new Map()); // conversationId -> { channel, handler, typingHandler, presenceHandler }

  // 移除通知
  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // 移除消息通知
  const removeMessageNotification = useCallback((id: string) => {
    setMessageNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // 移除特定会话的所有消息通知
  const removeMessageNotificationsByConversation = useCallback(
    (conversationId: string) => {
      setMessageNotifications((prev) =>
        prev.filter((n) => n.conversationId !== conversationId),
      );
    },
    [],
  );

  /**
   * 处理新私信消息的通用逻辑
   * 用于 WebSocket 和 BroadcastChannel 共享
   */
  const handleNewPrivateMessage = useCallback(
    (payload: {
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
    }) => {
      const { message, sender, conversationId, messageCount } = payload;

      if (!message || !sender || !conversationId) {
        console.warn("[Notification] Invalid private message data:", payload);
        return;
      }

      // 检查用户是否在 /messages 路由下
      const isOnMessagesPage =
        window.location.pathname === "/messages" ||
        window.location.pathname.startsWith("/messages?");

      // 更新私信未读数（服务器返回的数字）
      // 注意：如果用户正在查看该会话，ChatWindow 会立即调用 markAsRead 来纠正这个数字
      if (typeof messageCount === "number") {
        setUnreadMessageCount(messageCount);

        // 只在不在 /messages 页面时才广播（触发 ripple）
        if (!isOnMessagesPage) {
          broadcast({
            type: "unread_message_count_update",
            count: messageCount,
          });

          // 更新缓存
          localStorage.setItem(
            "unread_message_count",
            JSON.stringify({ count: messageCount, cachedAt: Date.now() }),
          );
        }
      }

      if (isOnMessagesPage) {
        // 用户在消息页面，广播新消息给页面组件
        console.log(
          "[Notification] User is on /messages page, broadcasting to MessagesClient",
        );
        // 广播会话列表更新
        broadcast({
          type: "new_private_message",
          conversationId,
          message,
          sender,
          messageCount,
        });
        // 广播消息添加到当前会话（直接发送给 ChatWindow）
        broadcast({
          type: "append_message_to_conversation",
          conversationId,
          message,
        });
        return;
      }

      // 用户不在消息页面时，显示消息通知

      // 用户不在消息页面，显示消息通知
      const isTabVisible = !document.hidden;

      if (isTabVisible) {
        // 标签页在前台 → 显示页面内消息通知
        const newMessageNotification: MessageNotificationItem = {
          id: `message-${message.id}-${Date.now()}`,
          conversationId,
          sender: {
            uid: sender.uid,
            username: sender.username,
            nickname: sender.nickname,
          },
          messageContent: message.content,
          createdAt: message.createdAt,
        };

        setMessageNotifications((prev) => {
          // 避免重复
          if (prev.some((n) => n.id === newMessageNotification.id)) {
            return prev;
          }
          return [newMessageNotification, ...prev];
        });
      } else {
        // 标签页在后台 → 通过 Service Worker 发送系统通知
        if (navigator.serviceWorker.controller) {
          const siteUrl = window.location.origin || "http://localhost:3000";
          const senderName = sender.nickname || sender.username;
          const messagePreview =
            message.content.substring(0, 20) +
            (message.content.length > 20 ? "..." : "");

          navigator.serviceWorker.controller.postMessage({
            type: "SHOW_NOTIFICATION",
            payload: {
              title: `${senderName} 私信了您`,
              body: messagePreview,
              icon: `${siteUrl}/icon/192x`,
              badge: `${siteUrl}/icon/72x`,
              data: {
                url: `/messages?conversation=${conversationId}`,
              },
            },
          });
        }
      }
    },
    [broadcast],
  );

  // 清理重试定时器
  const clearRetryTimeout = () => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  };

  // 计算重连延迟（指数退避 + 随机抖动）
  const getReconnectDelay = (retryCount: number): number => {
    const baseDelay = 1000;
    const maxDelay = 30000;
    const multiplier = 2;

    const delay = Math.min(
      baseDelay * Math.pow(multiplier, retryCount),
      maxDelay,
    );

    // 添加随机抖动 (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, delay + jitter);
  };

  // 回退到轮询模式
  const fallbackToPolling = useCallback(() => {
    console.log("[WebSocket] Falling back to polling mode");
    setConnectionStatus("fallback");
    clearRetryTimeout();

    // 关闭 Ably 连接
    if (ablyClientRef.current) {
      ablyClientRef.current.close();
      ablyClientRef.current = null;
    }
  }, []);

  // 初始化 Ably 连接
  const initializeAblyConnection = useCallback(async () => {
    // 如果已经有连接，不要重复建立
    if (ablyClientRef.current) {
      console.log("[WebSocket] Connection already exists, skipping");
      return;
    }

    // 检查用户是否已登录（双重保险）
    if (!userUidRef.current) {
      console.log("[WebSocket] User not logged in, skipping connection");
      fallbackToPolling();
      return;
    }

    console.log("[WebSocket] Initializing Ably connection as leader...");
    setConnectionStatus("connecting");

    let isMounted = true;

    try {
      // 动态导入 Ably
      const AblyModule = await import("ably");

      if (!isMounted) {
        console.log("[WebSocket] Component unmounted, skipping connection");
        return;
      }

      AblyRef.current = AblyModule;
      const Ably = AblyModule;

      // 创建 Ably 客户端
      const client = new Ably.Realtime({
        authCallback: (
          tokenParams: TokenParams,
          callback: (
            error: string | ErrorInfo | null,
            tokenRequestOrDetails: string | TokenRequest | TokenDetails | null,
          ) => void,
        ) => {
          void (async () => {
            try {
              // 检查缓存的 token 是否还有效
              const now = Date.now();
              if (
                tokenRequestCacheRef.current &&
                now - tokenRequestCacheRef.current.timestamp <
                  TOKEN_CACHE_DURATION
              ) {
                console.log("[WebSocket] Using cached token");
                callback(null, tokenRequestCacheRef.current.token);
                return;
              }

              console.log("[WebSocket] Requesting new token...");
              const result = await getAblyTokenRequest();

              if (result.success && result.data?.tokenRequest) {
                console.log("[WebSocket] Token acquired successfully");
                // 缓存 token
                tokenRequestCacheRef.current = {
                  token: result.data.tokenRequest,
                  timestamp: now,
                };
                callback(null, result.data.tokenRequest);
              } else {
                const errorInfo: ErrorInfo = {
                  name: "AuthenticationError",
                  message:
                    result.error?.message ||
                    result.message ||
                    "Failed to get token",
                  code: 40100,
                  statusCode: 401,
                };
                callback(errorInfo, null);
              }
            } catch (error) {
              console.error("[WebSocket] Auth failed:", error);
              const errorInfo: ErrorInfo = {
                name: "AuthenticationError",
                message:
                  error instanceof Error ? error.message : "Unknown error",
                code: 40100,
                statusCode: 401,
              };
              callback(errorInfo, null);
              // 认证失败，回退到轮询
              if (isMounted) {
                fallbackToPolling();
              }
            }
          })();
        },
      });

      // 监听连接状态
      client.connection.on("connected", () => {
        console.log("[WebSocket] Connected");
        if (isMounted) {
          setConnectionStatus("connected");
          retryCountRef.current = 0;
          clearRetryTimeout();
        }
      });

      client.connection.on("connecting", () => {
        console.log("[WebSocket] Connecting...");
        if (isMounted) {
          setConnectionStatus("connecting");
        }
      });

      client.connection.on("disconnected", () => {
        console.log("[WebSocket] Disconnected");
        if (isMounted) {
          setConnectionStatus("disconnected");

          // 尝试重连
          if (retryCountRef.current < MAX_RETRIES) {
            const delay = getReconnectDelay(retryCountRef.current);
            console.log(
              `[WebSocket] Retrying connection in ${Math.round(delay / 1000)}s (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`,
            );

            retryTimeoutRef.current = setTimeout(() => {
              retryCountRef.current++;
              client.connect();
            }, delay);
          } else {
            console.error("[WebSocket] Max retries reached");
            fallbackToPolling();
          }
        }
      });

      client.connection.on("suspended", () => {
        console.warn("[WebSocket] Connection suspended");
        if (isMounted) {
          setConnectionStatus("suspended");
          fallbackToPolling();
        }
      });

      client.connection.on("failed", () => {
        console.error("[WebSocket] Connection failed");
        if (isMounted) {
          setConnectionStatus("failed");
          fallbackToPolling();
        }
      });

      ablyClientRef.current = client;
    } catch (error) {
      console.error("[WebSocket] Failed to load Ably module:", error);
      if (isMounted) {
        fallbackToPolling();
      }
    }

    return () => {
      isMounted = false;
    };
  }, [fallbackToPolling]);

  // 清理 Ably 连接
  const cleanupAblyConnection = useCallback(() => {
    console.log("[WebSocket] Cleaning up connection");
    clearRetryTimeout();

    if (ablyClientRef.current) {
      ablyClientRef.current.close();
      ablyClientRef.current = null;
    }

    setConnectionStatus("idle");
  }, []);

  // ============ Web Locks 主标签页管理 ============
  useEffect(() => {
    if (!isAblyEnabled) {
      console.log("[Locks] Ably not enabled, using polling fallback");
      setConnectionStatus("fallback");
      return;
    }

    // 检查用户是否已登录
    if (!isUserLoggedIn) {
      console.log("[Locks] User not logged in, skipping Ably connection");
      setConnectionStatus("idle");
      return;
    }

    // Check if Web Locks API is available
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      console.log("[Locks] Requesting lock for Ably connection...");

      // 创建 AbortController 用于取消锁请求
      const controller = new AbortController();
      lockControllerRef.current = controller;

      // 请求锁
      void navigator.locks
        .request(LOCK_NAME, { signal: controller.signal }, async (lock) => {
          if (!lock) {
            console.log("[Locks] Failed to acquire lock");
            setConnectionStatus("fallback");
            return;
          }

          console.log("[Locks] Acquired lock, becoming leader");
          setIsLeader(true);

          // 初始化 Ably 连接
          await initializeAblyConnection();

          // 保持锁直到组件卸载或标签页关闭
          return new Promise<void>((resolve) => {
            // 这个 Promise 永不 resolve，直到：
            // 1. 组件卸载（controller.abort()）
            // 2. 标签页关闭（自动释放）
            controller.signal.addEventListener("abort", () => {
              console.log("[Locks] Releasing lock");
              setIsLeader(false);
              cleanupAblyConnection();
              resolve();
            });
          });
        })
        .catch((error) => {
          // AbortError 是正常的（组件卸载时）
          if (error.name !== "AbortError") {
            console.error("[Locks] Error acquiring lock:", error);
            setConnectionStatus("fallback");
          }
        });

      return () => {
        // 组件卸载时释放锁
        console.log("[Locks] Component unmounting, aborting lock request");
        controller.abort();
      };
    } else {
      // Web Locks API不可用时（如不支持的浏览器或非安全上下文），回退到每个标签页独立连接
      console.warn(
        "[Locks] Web Locks API not available, falling back to independent connection per tab",
      );

      // 既然无法协调，就让当前标签页作为 Leader 独立运行
      setIsLeader(true);
      initializeAblyConnection();

      return () => {
        setIsLeader(false);
        cleanupAblyConnection();
      };
    }
  }, [
    isAblyEnabled,
    isUserLoggedIn,
    initializeAblyConnection,
    cleanupAblyConnection,
  ]);

  // 首次加载时获取未读通知数量和用户 UID
  useEffect(() => {
    const fetchInitialUnreadCount = async () => {
      // 检查是否已有其他实例正在加载
      if (isLoadingUnreadCount()) {
        console.log("[Notification] Already loading, skipping");
        return;
      }

      try {
        // 设置加载标志
        setLoadingUnreadCount(true);

        // 从 localStorage 读取用户 UID
        const userInfo = getUserInfoFromStorage();
        if (userInfo) {
          userUidRef.current = userInfo.uid;
          setIsUserLoggedIn(true);
          console.log("[Notification] User UID:", userInfo.uid);
        } else {
          // 用户未登录，清空状态并退出
          userUidRef.current = null;
          setIsUserLoggedIn(false);
          setUnreadCount(0);
          // 清空缓存的未读数量
          localStorage.removeItem("unread_notice_count");
          console.log("[Notification] User not logged in, skipping");
          return;
        }

        // 立即设置缓存时间戳，防止其他组件重复调用
        const existingCache = localStorage.getItem("unread_notice_count");
        let cachedCount = 0;
        let cachedMessageCount = 0;

        if (existingCache) {
          try {
            const data = JSON.parse(existingCache);
            if (typeof data.count === "number") {
              cachedCount = data.count;
              setUnreadCount(data.count);
              console.log(
                "[Notification] Loaded cached unread count:",
                data.count,
              );
            }
            if (typeof data.messageCount === "number") {
              cachedMessageCount = data.messageCount;
              setUnreadMessageCount(data.messageCount);
              console.log(
                "[Notification] Loaded cached message count:",
                data.messageCount,
              );
            }
          } catch {
            // 忽略解析错误
          }
        }

        // 更新缓存时间戳，标记正在获取数据
        localStorage.setItem(
          "unread_notice_count",
          JSON.stringify({
            count: cachedCount,
            messageCount: cachedMessageCount,
            cachedAt: Date.now(),
          }),
        );

        // 调用 API 获取最新数据
        const result = await getUnreadNoticeCount();
        if (result.success && result.data) {
          const count = result.data.count;
          const messageCount = result.data.messageCount;
          setUnreadCount(count);
          setUnreadMessageCount(messageCount);

          // 更新缓存
          localStorage.setItem(
            "unread_notice_count",
            JSON.stringify({ count, messageCount, cachedAt: Date.now() }),
          );

          // 广播给其他组件
          broadcast({ type: "unread_notice_update", count });
          broadcast({
            type: "unread_message_count_update",
            count: messageCount,
          });

          console.log("[Notification] Initial unread count:", count);
        }
      } catch (error) {
        console.error(
          "[Notification] Failed to fetch initial unread count:",
          error,
        );
      } finally {
        // 清除加载标志
        setLoadingUnreadCount(false);
      }
    };

    fetchInitialUnreadCount();
  }, [broadcast]);

  // ============ 处理 chat 频道订阅请求 ============
  useBroadcast<BroadcastMessage>((message) => {
    // 只有主标签页（持有 Ably 连接的标签页）处理订阅请求
    if (!isLeader || !ablyClientRef.current) return;

    if (message.type === "subscribe_chat_channel") {
      const { conversationId } = message;
      console.log(`[Chat] Subscribing to chat:${conversationId}`);

      // 检查是否已订阅
      if (subscribedChatChannelsRef.current.has(conversationId)) {
        console.log(`[Chat] Already subscribed to chat:${conversationId}`);
        return;
      }

      const channel = ablyClientRef.current.channels.get(
        `chat:${conversationId}`,
      );

      const readReceiptHandler = (msg: Message) => {
        try {
          const { type, lastReadMessageId, userUid } = msg.data;

          if (type === "read_receipt" && lastReadMessageId) {
            console.log(
              `[Chat] Received read receipt from user ${userUid}:`,
              lastReadMessageId,
            );

            // 广播给 MessagesClient
            broadcast({
              type: "read_receipt_update",
              conversationId,
              otherUserLastReadMessageId: lastReadMessageId,
            });
          }
        } catch (error) {
          console.error("[Chat] Failed to process read receipt:", error);
        }
      };

      const typingHandler = (msg: Message) => {
        try {
          const { type, userUid } = msg.data;

          if (type === "typing" && userUid !== userUidRef.current) {
            // 广播给 ChatWindow
            broadcast({
              type: "user_typing",
              conversationId,
              userUid,
            });
          }
        } catch (error) {
          console.error("[Chat] Failed to process typing signal:", error);
        }
      };

      const presenceHandler = (_msg: PresenceMessage) => {
        try {
          // 检查 Presence 中是否有其他用户（排除自己）
          channel.presence.get().then((members: PresenceMessage[]) => {
            const otherUsersOnline = members.some(
              (member) => member.clientId !== `user:${userUidRef.current}`,
            );

            console.log(
              `[Chat] Presence update for chat:${conversationId}, other users online:`,
              otherUsersOnline,
            );

            // 广播给 ChatWindow
            broadcast({
              type: "chat_presence_update",
              conversationId,
              isOnline: otherUsersOnline,
            });
          });
        } catch (error) {
          console.error("[Chat] Failed to process presence update:", error);
        }
      };

      channel.subscribe("read_receipt", readReceiptHandler);
      channel.subscribe("typing", typingHandler);
      channel.presence.subscribe(presenceHandler);

      // 进入 Presence（标记自己在这个 chat 频道）
      channel.presence
        .enter()
        .then(() => {
          console.log(`[Chat] Entered presence for chat:${conversationId}`);

          // 立即检查一次对方是否在线
          channel.presence.get().then((members: PresenceMessage[]) => {
            const otherUsersOnline = members.some(
              (member) => member.clientId !== `user:${userUidRef.current}`,
            );

            broadcast({
              type: "chat_presence_update",
              conversationId,
              isOnline: otherUsersOnline,
            });
          });
        })
        .catch((error: Error) => {
          console.error("[Chat] Failed to enter presence:", error);
        });

      subscribedChatChannelsRef.current.set(conversationId, {
        channel,
        handler: readReceiptHandler,
        typingHandler,
        presenceHandler,
      });

      console.log(`[Chat] Successfully subscribed to chat:${conversationId}`);
    } else if (message.type === "unsubscribe_chat_channel") {
      const { conversationId } = message;
      console.log(`[Chat] Unsubscribing from chat:${conversationId}`);

      const subscription =
        subscribedChatChannelsRef.current.get(conversationId);
      if (subscription) {
        // 离开 Presence
        subscription.channel.presence.leave().catch((error: Error) => {
          console.error("[Chat] Failed to leave presence:", error);
        });

        // 取消订阅所有事件
        subscription.channel.unsubscribe("read_receipt", subscription.handler);
        if (subscription.typingHandler) {
          subscription.channel.unsubscribe(
            "typing",
            subscription.typingHandler,
          );
        }
        if (subscription.presenceHandler) {
          subscription.channel.presence.unsubscribe(
            subscription.presenceHandler,
          );
        }

        subscribedChatChannelsRef.current.delete(conversationId);
        console.log(
          `[Chat] Successfully unsubscribed from chat:${conversationId}`,
        );
      }
    } else if (message.type === "send_read_receipt") {
      const { conversationId, lastReadMessageId } = message;
      console.log(
        `[Chat] Sending read receipt for conversation ${conversationId}:`,
        lastReadMessageId,
      );

      const subscription =
        subscribedChatChannelsRef.current.get(conversationId);
      if (subscription && userUidRef.current) {
        subscription.channel
          .publish("read_receipt", {
            type: "read_receipt",
            lastReadMessageId,
            userUid: userUidRef.current,
          })
          .then(() => {
            console.log(
              `[Chat] Read receipt sent successfully for ${conversationId}`,
            );
          })
          .catch((error: Error) => {
            console.error("[Chat] Failed to send read receipt:", error);
          });
      }
    } else if (message.type === "send_typing_signal") {
      const { conversationId, userUid } = message;

      const subscription =
        subscribedChatChannelsRef.current.get(conversationId);
      if (subscription) {
        subscription.channel
          .publish("typing", {
            type: "typing",
            userUid,
          })
          .catch((error: Error) => {
            console.error("[Chat] Failed to send typing signal:", error);
          });
      }
    }
  });

  // ============ 跨标签页通信（BroadcastChannel） ============
  useEffect(() => {
    // 只在用户登录时创建 BroadcastChannel
    if (!isUserLoggedIn) {
      console.log("[BroadcastChannel] User not logged in, skipping");
      return;
    }

    // 创建 BroadcastChannel 实例
    const channel = new BroadcastChannel("notifications");
    broadcastChannelRef.current = channel;

    console.log("[BroadcastChannel] Channel created");

    // 监听来自其他标签页的消息
    channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
      const { type, payload } = event.data;
      console.log("[BroadcastChannel] Received message:", type, payload);

      try {
        // 处理新通知（显示 Toast）
        if (type === "new_notice") {
          const { id, title, content, link, createdAt, count } = payload;

          if (!id || !title || !content) {
            console.warn(
              "[BroadcastChannel] Invalid notification data:",
              payload,
            );
            return;
          }

          // ✅ 检测标签页是否在前台
          const isTabVisible = !document.hidden;
          console.log(
            `[BroadcastChannel] Tab visibility: ${isTabVisible ? "VISIBLE (foreground)" : "HIDDEN (background)"}`,
          );

          if (isTabVisible) {
            // 标签页在前台 → 显示页面内通知（NotificationToast）
            console.log(
              "[BroadcastChannel] Tab is in foreground, showing in-page notification",
            );

            setNotifications((prev) => {
              // 避免重复
              if (prev.some((n) => n.id === id)) {
                return prev;
              }

              const newNotification: NotificationItem = {
                id,
                title,
                content,
                link: link ?? null,
                createdAt: createdAt ?? new Date().toISOString(),
              };

              // 如果已经有5个通知，先移除最旧的，再延迟添加新通知
              if (prev.length >= 5) {
                const withoutOldest = prev.slice(0, 4);

                setTimeout(() => {
                  setNotifications((current) => {
                    if (current.some((n) => n.id === id)) {
                      return current;
                    }
                    return [newNotification, ...current];
                  });
                }, 350);

                return withoutOldest;
              }

              return [newNotification, ...prev];
            });
          } else {
            // 标签页在后台 → 联系 Service Worker 发送系统通知
            console.log(
              "[BroadcastChannel] Tab is in background, requesting system notification from SW",
            );

            if (navigator.serviceWorker.controller) {
              // 构建通知数据
              const siteUrl = window.location.origin || "http://localhost:3000";

              navigator.serviceWorker.controller.postMessage({
                type: "SHOW_NOTIFICATION",
                payload: {
                  title,
                  body: content,
                  icon: `${siteUrl}/icon/192x`,
                  badge: `${siteUrl}/icon/72x`,
                  data: {
                    url: link || siteUrl,
                    noticeId: id,
                  },
                },
              });

              console.log(
                "[BroadcastChannel] System notification request sent to SW",
              );
            } else {
              console.warn(
                "[BroadcastChannel] Service Worker not available, cannot show system notification",
              );
            }
          }

          // 更新未读数（无论前后台都需要）
          if (typeof count === "number") {
            setUnreadCount(count);

            // 广播给其他组件（同一标签页内）
            // 注意：先广播再更新 localStorage，确保 UserInfo 能在 storage 事件前收到消息
            broadcast({ type: "unread_notice_update", count });
          }
        }
        // 处理未读数更新（仅更新数字，不显示 Toast）
        else if (
          type === "unread_count_update" &&
          typeof payload.count === "number"
        ) {
          setUnreadCount(payload.count);

          // 广播给其他组件（同一标签页内）
          broadcast({ type: "unread_notice_update", count: payload.count });
        }
        // 处理新私信消息
        else if (type === "new_private_message") {
          handleNewPrivateMessage(
            payload as Parameters<typeof handleNewPrivateMessage>[0],
          );
        }
        // 处理私信未读数更新（仅更新数字，不显示 Toast）
        else if (
          type === "unread_message_count_update" &&
          typeof payload.messageCount === "number"
        ) {
          setUnreadMessageCount(payload.messageCount);
          // 广播给其他组件
          broadcast({
            type: "unread_message_count_update",
            count: payload.messageCount,
          });
        }
      } catch (error) {
        console.error("[BroadcastChannel] Failed to process message:", error);
      }
    };

    return () => {
      console.log("[BroadcastChannel] Channel closed");
      channel.close();
    };
  }, [broadcast, isUserLoggedIn, handleNewPrivateMessage]);

  // 订阅通知频道（仅主标签页）
  useEffect(() => {
    if (
      !ablyClientRef.current ||
      connectionStatus !== "connected" ||
      !isAblyEnabled ||
      !isLeader ||
      !userUidRef.current
    ) {
      return;
    }

    const channelName = `user:${userUidRef.current}`;
    console.log(`[WebSocket] Leader subscribing to channel: ${channelName}`);

    const channel = ablyClientRef.current.channels.get(channelName);

    // 进入 Presence（标记用户为在线状态）
    channel.presence
      .enter({ timestamp: Date.now() })
      .then(() => {
        console.log(
          `[WebSocket] Successfully entered Presence for user:${userUidRef.current}`,
        );
      })
      .catch((error) => {
        console.error("[WebSocket] Failed to enter Presence:", error);
      });

    const messageHandler = (message: Message) => {
      console.log("[WebSocket] Leader received notification:", message.data);

      try {
        const { type, payload } = message.data;

        // 处理新通知（显示 Toast）
        if (type === "new_notice") {
          const { id, title, content, link, createdAt, count } = payload;

          if (!id || !title || !content) {
            console.warn("[WebSocket] Invalid notification data:", payload);
            return;
          }

          // ✅ 检测标签页是否在前台
          const isTabVisible = !document.hidden;
          console.log(
            `[WebSocket] Tab visibility: ${isTabVisible ? "VISIBLE (foreground)" : "HIDDEN (background)"}`,
          );

          if (isTabVisible) {
            // 标签页在前台 → 显示页面内通知（NotificationToast）
            console.log(
              "[WebSocket] Tab is in foreground, showing in-page notification",
            );

            setNotifications((prev) => {
              // 避免重复
              if (prev.some((n) => n.id === id)) {
                return prev;
              }

              const newNotification: NotificationItem = {
                id,
                title,
                content,
                link: link ?? null,
                createdAt: createdAt ?? new Date().toISOString(),
              };

              // 如果已经有5个通知，先移除最旧的，再延迟添加新通知
              if (prev.length >= 5) {
                const withoutOldest = prev.slice(0, 4);

                setTimeout(() => {
                  setNotifications((current) => {
                    if (current.some((n) => n.id === id)) {
                      return current;
                    }
                    return [newNotification, ...current];
                  });
                }, 350);

                return withoutOldest;
              }

              return [newNotification, ...prev];
            });
          } else {
            // 标签页在后台 → 联系 Service Worker 发送系统通知
            console.log(
              "[WebSocket] Tab is in background, requesting system notification from SW",
            );

            if (navigator.serviceWorker.controller) {
              // 构建通知数据
              const siteUrl = window.location.origin || "http://localhost:3000";

              navigator.serviceWorker.controller.postMessage({
                type: "SHOW_NOTIFICATION",
                payload: {
                  title,
                  body: content,
                  icon: `${siteUrl}/icon/192x`,
                  badge: `${siteUrl}/icon/72x`,
                  data: {
                    url: link || siteUrl,
                    noticeId: id,
                  },
                },
              });

              console.log("[WebSocket] System notification request sent to SW");
            } else {
              console.warn(
                "[WebSocket] Service Worker not available, cannot show system notification",
              );
            }
          }

          // 更新未读数（无论前后台都需要）
          if (typeof count === "number") {
            setUnreadCount(count);

            // 1. 先广播给其他标签页（通过 BroadcastChannel），确保最快送达
            if (broadcastChannelRef.current) {
              const message: CrossTabMessage = {
                type: "new_notice",
                payload: { id, title, content, link, createdAt, count },
              };
              broadcastChannelRef.current.postMessage(message);
              console.log("[BroadcastChannel] Sent new_notice to other tabs");
            }

            // 2. 广播给本标签页的其他组件
            broadcast({ type: "unread_notice_update", count });

            // 3. 最后写入 localStorage（作为持久化和备份机制）
            localStorage.setItem(
              "unread_notice_count",
              JSON.stringify({ count, cachedAt: Date.now() }),
            );
          }
        }
        // 处理未读数更新（仅更新数字，不显示 Toast）
        else if (
          type === "unread_count_update" &&
          typeof payload.count === "number"
        ) {
          setUnreadCount(payload.count);

          // 1. 先广播给其他标签页（通过 BroadcastChannel）
          if (broadcastChannelRef.current) {
            const message: CrossTabMessage = {
              type: "unread_count_update",
              payload: { count: payload.count },
            };
            broadcastChannelRef.current.postMessage(message);
            console.log(
              "[BroadcastChannel] Sent unread_count_update to other tabs",
            );
          }

          // 2. 广播给本标签页的其他组件
          broadcast({ type: "unread_notice_update", count: payload.count });

          // 3. 最后写入 localStorage
          localStorage.setItem(
            "unread_notice_count",
            JSON.stringify({ count: payload.count, cachedAt: Date.now() }),
          );
        }
        // 处理新私信消息
        else if (type === "new_private_message") {
          console.log("[WebSocket] Received new private message:", payload);

          const typedPayload = payload as {
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
          };

          // 处理消息（使用共享逻辑）
          handleNewPrivateMessage(typedPayload);

          // 广播给其他标签页
          if (broadcastChannelRef.current) {
            broadcastChannelRef.current.postMessage({
              type: "new_private_message",
              payload,
            });
            console.log(
              "[BroadcastChannel] Sent new_private_message to other tabs",
            );
          }
        }
      } catch (error) {
        console.error("[WebSocket] Failed to process notification:", error);
      }
    };

    channel.subscribe("notification", messageHandler);

    return () => {
      // 离开 Presence（标记用户为离线状态）
      channel.presence
        .leave()
        .then(() => {
          console.log(
            `[WebSocket] Successfully left Presence for user:${userUidRef.current}`,
          );
        })
        .catch((error) => {
          console.error("[WebSocket] Failed to leave Presence:", error);
        });

      channel.unsubscribe("notification", messageHandler);
    };
  }, [
    connectionStatus,
    isAblyEnabled,
    isLeader,
    broadcast,
    handleNewPrivateMessage,
  ]);

  // 监听 localStorage 变化（同步未读数量）
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // 监听未读数量缓存的变化
      if (e.key === "unread_notice_count" && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          if (typeof data.count === "number") {
            console.log(
              "[Storage] Syncing unread count from storage:",
              data.count,
            );
            setUnreadCount(data.count);

            // 广播给其他组件
            broadcast({ type: "unread_notice_update", count: data.count });
          }
          if (typeof data.messageCount === "number") {
            console.log(
              "[Storage] Syncing message count from storage:",
              data.messageCount,
            );
            setUnreadMessageCount(data.messageCount);

            // 广播给其他组件
            broadcast({
              type: "unread_message_count_update",
              count: data.messageCount,
            });
          }
        } catch (error) {
          console.error("[Storage] Failed to parse storage data:", error);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [broadcast]);

  // ============ Service Worker 注册和消息监听 ============
  useEffect(() => {
    // 检查浏览器是否支持 Service Worker 和 Push API
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("[SW] Service Worker or Push API not supported");
      return;
    }

    // 注册 Service Worker
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[SW] Registration successful");
        setSwRegistration(registration);
      })
      .catch((error) => {
        console.error("[SW] Registration failed:", error);
      });

    // 监听来自 Service Worker 的消息
    const handleSWMessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};

      if (type === "PUSH_RECEIVED_WHILE_FOCUSED") {
        console.log(
          "[SW] Received PUSH_RECEIVED_WHILE_FOCUSED message:",
          payload,
        );

        const { title, body, data: notificationData } = payload;

        if (!title || !body) {
          console.warn("[SW] Invalid notification data:", payload);
          return;
        }

        const noticeId = notificationData?.noticeId;
        const link = notificationData?.url;

        // 显示页面内通知（使用 NotificationToast 组件）
        setNotifications((prev) => {
          // 避免重复
          if (noticeId && prev.some((n) => n.id === noticeId)) {
            return prev;
          }

          const newNotification: NotificationItem = {
            id: noticeId || `web-push-${Date.now()}`,
            title,
            content: body,
            link: link || null,
            createdAt: new Date().toISOString(),
          };

          // 如果已经有5个通知，先移除最旧的，再延迟添加新通知
          if (prev.length >= 5) {
            const withoutOldest = prev.slice(0, 4);

            setTimeout(() => {
              setNotifications((current) => {
                if (noticeId && current.some((n) => n.id === noticeId)) {
                  return current;
                }
                return [newNotification, ...current];
              });
            }, 350);

            return withoutOldest;
          }

          return [newNotification, ...prev];
        });

        // 只在非私信通知时触发未读数量刷新
        // 私信通知的未读数由消息系统管理，不需要重新获取通知数
        const notificationType = notificationData?.type;
        if (notificationType !== "message") {
          getUnreadNoticeCount()
            .then((result) => {
              if (result.success && result.data) {
                const count = result.data.count;
                setUnreadCount(count);

                // 更新缓存
                localStorage.setItem(
                  "unread_notice_count",
                  JSON.stringify({ count, cachedAt: Date.now() }),
                );

                // 广播给其他组件
                broadcast({ type: "unread_notice_update", count });
              }
            })
            .catch((error) => {
              console.error(
                "[Notification] Failed to refresh unread notice count:",
                error,
              );
            });
        } else {
          console.log(
            "[Notification] Skipping unread notice count refresh for message notification",
          );
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handleSWMessage);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleSWMessage);
    };
  }, [broadcast]);

  return (
    <NotificationContext.Provider
      value={{
        connectionStatus,
        unreadCount,
        unreadMessageCount,
        isLeader,
        removeMessageNotificationsByConversation,
      }}
    >
      {/* 仅在回退模式且用户已登录时启用轮询组件 */}
      {connectionStatus === "fallback" && isUserLoggedIn && (
        <UnreadNoticeTracker />
      )}
      {/* 统一的通知容器（消息通知在上，普通通知在下） */}
      <UnifiedNotificationContainer
        notifications={notifications}
        messageNotifications={messageNotifications}
        onRemoveNotification={removeNotification}
        onRemoveMessageNotification={removeMessageNotification}
      />
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * 使用通知上下文的 Hook
 *
 * @returns 通知上下文值（连接状态和未读数量）
 *
 * @example
 * ```tsx
 * const { connectionStatus, unreadCount } = useNotification();
 * ```
 */
export const useNotification = () => useContext(NotificationContext);
