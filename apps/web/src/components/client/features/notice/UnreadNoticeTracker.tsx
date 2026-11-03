"use client";

import { useCallback, useEffect, useRef } from "react";

import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getUnreadNoticeCount } from "@/lib/client/api/public";

interface BroadcastMessage {
  type: "check_intent" | "check_started" | "check_completed";
  timestamp: string;
  tabId?: string;
  count?: number;
}

interface CachedNoticeCount {
  count: number;
  cachedAt: number;
}

const CHECK_INTERVAL = 5 * 60 * 1000; // 5分钟
const CHECK_DELAY = 1000; // 1秒延迟，用于多页面协调
const BROADCAST_RANDOM_DELAY_MAX = 200; // 随机延迟最大值
const BROADCAST_CHANNEL_NAME = "unread_notice_channel";
const CACHE_KEY = "unread_notice_count";

interface UnreadNoticeUpdateMessage {
  type: "unread_notice_update";
  count: number;
}

const generateTabId = () =>
  `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
const getRandomDelay = () =>
  Math.floor(Math.random() * BROADCAST_RANDOM_DELAY_MAX);

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

export default function UnreadNoticeTracker() {
  const { broadcast } = useBroadcastSender<UnreadNoticeUpdateMessage>();
  const timersRef = useRef({
    main: null as NodeJS.Timeout | null,
    checkDelay: null as NodeJS.Timeout | null,
    broadcastDelay: null as NodeJS.Timeout | null,
  });
  const stateRef = useRef({
    isChecking: false,
    isPendingCheck: false,
    isFirstCheck: true, // 首次检查标志
  });
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(generateTabId());

  // 统一的定时器清理函数
  const clearTimer = useCallback(
    (timerKey: keyof (typeof timersRef)["current"]) => {
      if (timersRef.current[timerKey]) {
        clearTimeout(timersRef.current[timerKey]!);
        timersRef.current[timerKey] = null;
      }
    },
    [],
  );

  const clearAllTimers = useCallback(() => {
    Object.keys(timersRef.current).forEach((key) =>
      clearTimer(key as keyof (typeof timersRef)["current"]),
    );
  }, [clearTimer]);

  const broadcastMessage = useCallback(
    (message: Omit<BroadcastMessage, "tabId">, delay = 0) => {
      const send = () => {
        if (broadcastChannelRef.current) {
          try {
            broadcastChannelRef.current.postMessage({
              ...message,
              tabId: tabIdRef.current,
            });
          } catch {
            //
          }
        }
      };

      if (delay > 0) {
        timersRef.current.broadcastDelay = setTimeout(send, delay);
      } else {
        send();
      }
    },
    [],
  );

  // 从 localStorage 获取缓存的未读数
  const getCachedCount = useCallback((): CachedNoticeCount | null => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const data = JSON.parse(cached);
      if (typeof data.count === "number" && typeof data.cachedAt === "number") {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // 保存未读数到 localStorage
  const setCachedCount = useCallback(
    (count: number) => {
      const data: CachedNoticeCount = {
        count,
        cachedAt: Date.now(),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));

      // 使用 broadcast 通知其他组件
      broadcast({ type: "unread_notice_update", count });
    },
    [broadcast],
  );

  const doCheck = useCallback(async () => {
    if (stateRef.current.isChecking) return false;

    stateRef.current.isChecking = true;
    stateRef.current.isPendingCheck = false;

    broadcastMessage({
      type: "check_started",
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await getUnreadNoticeCount();

      if (result.success && result.data) {
        const count = result.data.count;
        setCachedCount(count);

        broadcastMessage({
          type: "check_completed",
          timestamp: new Date().toISOString(),
          count,
        });

        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      stateRef.current.isChecking = false;
    }
  }, [broadcastMessage, setCachedCount]);

  // Forward declarations via ref
  const checkAndScheduleRef = useRef<() => void>(() => {});
  const performCheckRef = useRef<(immediate?: boolean) => void>(
    (immediate = false) => {
      if (stateRef.current.isPendingCheck || stateRef.current.isChecking)
        return;

      stateRef.current.isPendingCheck = true;

      // 如果是立即检查（首次加载），跳过广播协调直接执行
      if (immediate) {
        (async () => {
          await doCheck();
          scheduleNextCheck(CHECK_INTERVAL);
        })();
        return;
      }

      broadcastMessage(
        {
          type: "check_intent",
          timestamp: new Date().toISOString(),
        },
        getRandomDelay(),
      );

      const totalDelay = CHECK_DELAY + BROADCAST_RANDOM_DELAY_MAX;

      timersRef.current.checkDelay = setTimeout(() => {
        void (async () => {
          if (!stateRef.current.isPendingCheck) return;

          await doCheck();

          scheduleNextCheck(CHECK_INTERVAL);
        })();
      }, totalDelay);
    },
  );

  const scheduleNextCheck = useCallback(
    (delay: number) => {
      clearTimer("main");
      timersRef.current.main = setTimeout(() => {
        checkAndScheduleRef.current();
      }, delay);
    },
    [clearTimer],
  );

  const performCheck = useCallback(
    (immediate = false) => {
      if (stateRef.current.isPendingCheck || stateRef.current.isChecking)
        return;

      stateRef.current.isPendingCheck = true;

      if (immediate) {
        (async () => {
          await doCheck();
          scheduleNextCheck(CHECK_INTERVAL);
        })();
        return;
      }

      broadcastMessage(
        {
          type: "check_intent",
          timestamp: new Date().toISOString(),
        },
        getRandomDelay(),
      );

      const totalDelay = CHECK_DELAY + BROADCAST_RANDOM_DELAY_MAX;

      timersRef.current.checkDelay = setTimeout(() => {
        void (async () => {
          if (!stateRef.current.isPendingCheck) return;

          await doCheck();
          scheduleNextCheck(CHECK_INTERVAL);
        })();
      }, totalDelay);
    },
    [broadcastMessage, doCheck, scheduleNextCheck],
  );

  const checkAndSchedule = useCallback(() => {
    clearTimer("main");

    try {
      const cached = getCachedCount();
      const now = Date.now();

      if (stateRef.current.isFirstCheck) {
        if (isLoadingUnreadCount()) {
          timersRef.current.main = setTimeout(() => {
            checkAndSchedule();
          }, 100);
          return;
        }

        stateRef.current.isFirstCheck = false;

        if (cached && now - cached.cachedAt < 30000) {
          const timeUntilNextCheck = CHECK_INTERVAL - (now - cached.cachedAt);
          scheduleNextCheck(timeUntilNextCheck);
          return;
        }

        performCheck(true);
        return;
      }

      if (!cached) {
        performCheck();
        return;
      }

      const timeSinceLastCheck = now - cached.cachedAt;
      const timeUntilNextCheck = Math.max(
        0,
        CHECK_INTERVAL - timeSinceLastCheck,
      );

      if (timeUntilNextCheck === 0) {
        performCheck();
      } else {
        timersRef.current.main = setTimeout(() => {
          performCheck();
        }, timeUntilNextCheck);
      }
    } catch {
      scheduleNextCheck(CHECK_INTERVAL);
    }
  }, [clearTimer, getCachedCount, performCheck, scheduleNextCheck]);

  // Sync refs
  useEffect(() => {
    checkAndScheduleRef.current = checkAndSchedule;
    performCheckRef.current = performCheck;
  }, [checkAndSchedule, performCheck]);

  const cancelPendingCheck = useCallback(() => {
    if (!stateRef.current.isPendingCheck) return;

    stateRef.current.isPendingCheck = false;
    clearTimer("checkDelay");
    clearTimer("broadcastDelay");
  }, [clearTimer]);

  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === "visible") {
      checkAndSchedule();
    } else {
      clearAllTimers();
    }
  }, [checkAndSchedule, clearAllTimers]);

  const handleStorageChange = useCallback(
    (e: StorageEvent) => {
      if (e.key === CACHE_KEY) {
        checkAndSchedule();
      }
    },
    [checkAndSchedule],
  );

  const handleBroadcastMessage = useCallback(
    (event: MessageEvent<BroadcastMessage>) => {
      const { type, tabId, count } = event.data;

      if (tabId === tabIdRef.current) return;

      if (type === "check_intent" || type === "check_started") {
        if (stateRef.current.isPendingCheck) {
          cancelPendingCheck();
        }
        clearTimer("main");
      } else if (type === "check_completed") {
        if (typeof count === "number") {
          setCachedCount(count);
        }
        checkAndSchedule();
      }
    },
    [cancelPendingCheck, checkAndSchedule, clearTimer, setCachedCount],
  );

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      try {
        broadcastChannelRef.current = new BroadcastChannel(
          BROADCAST_CHANNEL_NAME,
        );
        broadcastChannelRef.current.addEventListener(
          "message",
          handleBroadcastMessage,
        );
      } catch {
        //
      }
    }

    checkAndSchedule();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorageChange);

    return () => {
      clearAllTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorageChange);

      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.removeEventListener(
          "message",
          handleBroadcastMessage,
        );
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }
    };
  }, [
    checkAndSchedule,
    handleBroadcastMessage,
    handleStorageChange,
    handleVisibilityChange,
    clearAllTimers,
  ]);

  return null;
}
