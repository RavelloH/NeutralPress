"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { trackPageView } from "@/lib/client/api/analytics-read";

const VISITOR_ID_KEY = "visitor_id";
const CACHE_KEY = "viewcount_cache";

/**
 * 缓存项接口
 */
interface CacheItem {
  viewcount: number;
  cachedAt: number;
}

/**
 * 缓存数据结构
 */
interface CacheData {
  [slug: string]: CacheItem;
}

/**
 * 更新访问量缓存，立即 +1
 * 只对已存在的缓存进行更新，避免覆盖真实的历史数据
 */
function incrementViewCountCache(pathname: string): void {
  // 只处理文章路径
  const match = pathname.match(/^\/posts\/([^/]+)$/);
  if (!match) return;

  const slug = match[1];
  if (!slug) return;

  try {
    // 读取现有缓存
    const cached = localStorage.getItem(CACHE_KEY);
    const cacheData: CacheData = cached ? JSON.parse(cached) : {};

    // 只更新已存在的缓存项（说明已经从 API 加载过真实数据）
    if (cacheData[slug]) {
      // 已存在，访问量 +1
      cacheData[slug].viewcount += 1;
      cacheData[slug].cachedAt = Date.now();

      // 写回 localStorage
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));

      // 立即更新页面显示
      updateViewCountDisplay(slug, cacheData[slug].viewcount);
    }
    // 如果缓存不存在，不做任何操作，等待 ViewCountBatchLoader 从 API 加载真实数据
  } catch (error) {
    console.debug("更新访问量缓存失败:", error);
  }
}

/**
 * 立即更新页面上的访问量显示
 */
function updateViewCountDisplay(slug: string, count: number): void {
  try {
    const elements = document.querySelectorAll<HTMLElement>(
      `[data-viewcount-slug="${slug}"]`,
    );

    elements.forEach((element) => {
      const formattedCount = count.toLocaleString("zh-CN");

      // 查找内部的 span 元素并更新内容
      const countSpan = element.querySelector("span:last-child");
      if (countSpan) {
        countSpan.textContent = formattedCount;
      }

      // 移除 opacity-0 类，使其可见
      element.classList.remove("opacity-0");

      // 添加淡入动画
      element.style.transition = "opacity 0.3s ease-in-out";
      element.style.opacity = "1";
    });

    // 同时显示分隔符
    const separators = document.querySelectorAll<HTMLElement>(
      "[data-viewcount-separator]",
    );

    separators.forEach((element) => {
      element.classList.remove("opacity-0");
      element.style.transition = "opacity 0.3s ease-in-out";
      element.style.opacity = "1";
    });
  } catch (error) {
    console.debug("更新访问量显示失败:", error);
  }
}

/**
 * 生成访客 ID
 */
function generateVisitorId(): string {
  // 优先使用 crypto.randomUUID()，不可用时回退到自定义实现
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // 回退方案：生成符合 UUID v4 格式的字符串
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 获取或生成访客 ID
 */
function getVisitorId(): string {
  if (typeof window === "undefined") return "";

  try {
    let visitorId = localStorage.getItem(VISITOR_ID_KEY);
    if (!visitorId) {
      visitorId = generateVisitorId();
      localStorage.setItem(VISITOR_ID_KEY, visitorId);
    }
    return visitorId;
  } catch {
    // localStorage 不可用时，使用临时 ID
    return generateVisitorId();
  }
}

/**
 * 收集客户端信息
 */
function collectClientInfo() {
  if (typeof window === "undefined") {
    return {
      screenSize: null,
      language: null,
      timezone: null,
    };
  }

  const screenSize = `${window.screen.width}x${window.screen.height}`;
  const language = navigator.language || null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

  return {
    screenSize,
    language,
    timezone,
  };
}

/**
 * Analytics 追踪组件
 */
export function AnalyticsTracker() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    // 忽略 hash 变化（pathname 不包含 hash）
    if (lastPathRef.current === pathname) return;

    lastPathRef.current = pathname;

    // 管理后台页面不进行统计上报
    if (pathname.startsWith("/admin")) return;

    const visitorId = getVisitorId();
    if (!visitorId) return;

    const { screenSize, language, timezone } = collectClientInfo();

    const referer =
      typeof document !== "undefined" ? document.referrer || null : null;

    // 先立即更新本地缓存（用户立即看到访问量增加）
    incrementViewCountCache(pathname);

    // 使用独立 JSON POST 追踪访问，不阻塞其它客户端 Action 请求
    trackPageView({
      path: pathname,
      referer,
      visitorId,
      screenSize,
      language,
      timezone,
    }).catch((error) => {
      // 静默失败，不影响用户体验
      console.debug("Analytics tracking failed:", error);
    });
  }, [pathname]);

  return null;
}
