"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SystemInfo } from "@repo/shared-types/api/system";

import { getSystemInfo } from "@/lib/client/api/admin-infra-read";
import { useBroadcastStore } from "@/store/broadcast-store";

// 自动刷新间隔（毫秒）
const AUTO_REFRESH_INTERVAL = 15000;
// 历史数据保留数量
const HISTORY_MAX_LENGTH = 20;

// 历史数据类型
export interface SystemInfoHistory {
  time: string;
  memoryUsage: number;
  heapUsed: number;
  cpuLoad: number;
  diskUsage: number;
  cpuUsageTotal: number;
  eventLoopLag: number;
}

// 创建一个共享的状态存储
type SystemInfoStore = {
  data: SystemInfo | null;
  history: SystemInfoHistory[];
  error: Error | null;
  listeners: Set<() => void>;
  lastFetchTime: number;
  isLoading: boolean;
  refreshTrigger: number;
};

const store: SystemInfoStore = {
  data: null,
  history: [],
  error: null,
  listeners: new Set(),
  lastFetchTime: 0,
  isLoading: false,
  refreshTrigger: 0,
};

// 共享的获取数据函数
async function fetchSystemInfo(
  isManualRefresh: boolean = false,
): Promise<void> {
  store.isLoading = true;
  store.listeners.forEach((listener) => listener());

  try {
    const res = await getSystemInfo();
    if (!res.success) {
      store.error = new Error(res.message || "获取系统信息失败");
      store.data = null;
    } else {
      store.data = res.data;
      store.error = null;

      // 添加历史记录
      const historyItem: SystemInfoHistory = {
        time: res.data.collectedAt,
        memoryUsage: res.data.memory.usagePercent,
        heapUsed: res.data.process.memoryUsage.heapUsed,
        cpuLoad: res.data.cpu.loadAvg[0] ?? 0,
        diskUsage: res.data.disk?.usagePercent ?? 0,
        cpuUsageTotal: res.data.cpu.usage?.total ?? 0,
        eventLoopLag: res.data.process.eventLoopLag ?? 0,
      };

      store.history = [...store.history, historyItem].slice(
        -HISTORY_MAX_LENGTH,
      );

      // 手动刷新时触发动画并广播
      if (isManualRefresh) {
        store.refreshTrigger += 1;
        useBroadcastStore.getState().broadcast({ type: "system-refresh" });
      }
    }
  } catch (err) {
    store.error = err instanceof Error ? err : new Error("获取系统信息失败");
    store.data = null;
  }

  store.lastFetchTime = Date.now();
  store.isLoading = false;
  // 通知所有监听器
  store.listeners.forEach((listener) => listener());
}

// 自定义 Hook 用于订阅系统信息
export function useSystemInfo() {
  const [, forceUpdate] = useState({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isFirstRender = useRef(true);

  const subscribe = useCallback(() => {
    const listener = () => forceUpdate({});
    store.listeners.add(listener);
    return () => {
      store.listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribe();

    // 初始加载（只有第一个组件触发）
    if (
      isFirstRender.current &&
      !store.data &&
      !store.error &&
      !store.isLoading
    ) {
      isFirstRender.current = false;
      fetchSystemInfo();
    }

    // 设置自动刷新（只设置一次全局定时器）
    if (store.listeners.size === 1) {
      intervalRef.current = setInterval(() => {
        fetchSystemInfo();
      }, AUTO_REFRESH_INTERVAL);
    }

    return () => {
      unsubscribe();
      // 最后一个监听器清理时，清除定时器
      if (store.listeners.size === 0 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [subscribe]);

  // 手动刷新函数（触发动画）
  const manualRefresh = useCallback(() => {
    fetchSystemInfo(true);
  }, []);

  return {
    data: store.data,
    history: store.history,
    error: store.error,
    refresh: manualRefresh,
    lastFetchTime: store.lastFetchTime,
    isLoading: store.isLoading,
    refreshTrigger: store.refreshTrigger,
  };
}
