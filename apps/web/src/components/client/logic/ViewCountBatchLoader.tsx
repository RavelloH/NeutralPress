"use client";

import { useEffect } from "react";

import { batchGetViewCounts } from "@/lib/client/api/analytics-read";

/**
 * localStorage 缓存的 key
 */
const CACHE_KEY = "viewcount_cache";

/**
 * 缓存有效期（毫秒）：10分钟
 */
const CACHE_DURATION = 10 * 60 * 1000;

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
 * 从 localStorage 读取缓存
 */
function getCachedData(): CacheData {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) {
      return {};
    }
    return JSON.parse(cached) as CacheData;
  } catch (error) {
    console.error("读取访问量缓存失败:", error);
    return {};
  }
}

/**
 * 写入缓存到 localStorage
 */
function setCachedData(data: CacheData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("写入访问量缓存失败:", error);
  }
}

/**
 * 检查缓存是否有效（未过期）
 */
function isCacheValid(cachedAt: number): boolean {
  const now = Date.now();
  return now - cachedAt < CACHE_DURATION;
}

/**
 * 批量访问量加载器（带缓存）
 * 自动扫描页面中所有带有 data-viewcount-slug 属性的元素
 * 批量获取访问量并更新显示，优先使用 localStorage 缓存
 */
export default function ViewCountBatchLoader() {
  useEffect(() => {
    let mounted = true;

    async function loadViewCounts() {
      try {
        // 1. 查找所有带有 data-viewcount-slug 属性的元素
        const viewCountElements = document.querySelectorAll<HTMLElement>(
          "[data-viewcount-slug]",
        );

        if (viewCountElements.length === 0) {
          return;
        }

        // 2. 收集所有唯一的 slug
        const slugs = new Set<string>();
        viewCountElements.forEach((element) => {
          const slug = element.getAttribute("data-viewcount-slug");
          if (slug) {
            slugs.add(slug);
          }
        });

        if (slugs.size === 0) {
          return;
        }

        // 3. 读取缓存
        const cachedData = getCachedData();

        // 4. 分离有效缓存和需要请求的 slug
        const validCachedSlugs: string[] = [];
        const slugsToFetch: string[] = [];

        slugs.forEach((slug) => {
          const cached = cachedData[slug];
          if (cached && isCacheValid(cached.cachedAt)) {
            // 有效缓存
            validCachedSlugs.push(slug);
          } else {
            // 需要从 API 获取
            slugsToFetch.push(slug);
          }
        });

        // 5. 创建 slug -> count 的映射
        const countMap = new Map<string, number>();

        // 先填充缓存数据
        validCachedSlugs.forEach((slug) => {
          const cached = cachedData[slug];
          if (cached) {
            countMap.set(slug, cached.viewcount);
          }
        });

        // 6. 批量获取未缓存的访问量
        if (slugsToFetch.length > 0) {
          // 构建路径数组
          const paths = slugsToFetch.map((slug) => `/posts/${slug}`);

          // 批量获取（最多20个一组）
          const allResults: Array<{ path: string; count: number }> = [];

          for (let i = 0; i < paths.length; i += 20) {
            const batch = paths.slice(i, i + 20);
            const results = await batchGetViewCounts(batch);
            allResults.push(...results);
          }

          if (!mounted) return;

          // 7. 更新映射和缓存
          const now = Date.now();
          allResults.forEach((result) => {
            // 从 "/posts/slug" 提取 slug
            const slug = result.path.replace("/posts/", "");
            countMap.set(slug, result.count);

            // 写入缓存
            cachedData[slug] = {
              viewcount: result.count,
              cachedAt: now,
            };
          });

          // 保存更新后的缓存
          setCachedData(cachedData);
        }

        // 8. 更新所有访问量元素
        viewCountElements.forEach((element) => {
          const slug = element.getAttribute("data-viewcount-slug");
          if (!slug) return;

          const count = countMap.get(slug);
          if (count === undefined) return;

          // 格式化数字（添加千分位分隔符）
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

        // 9. 显示访问量分隔符
        const viewCountSeparators = document.querySelectorAll<HTMLElement>(
          "[data-viewcount-separator]",
        );

        viewCountSeparators.forEach((element) => {
          element.classList.remove("opacity-0");
          element.style.transition = "opacity 0.3s ease-in-out";
          element.style.opacity = "1";
        });
      } catch (error) {
        console.error("批量加载访问量失败:", error);
        // 静默失败，不影响页面其他功能
      }
    }

    // 延迟执行，确保 DOM 已完全渲染
    const timer = setTimeout(() => {
      loadViewCounts();
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  // 不渲染任何内容
  return null;
}
