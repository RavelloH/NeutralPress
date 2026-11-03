"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { SearchLogStatsResult } from "@repo/shared-types/api/search";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getSearchLogStats } from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

/**
 * 生成自然语言描述
 */
function generateDescription(
  stats: SearchLogStatsResult,
  days: number,
): React.ReactElement[] {
  const elements: React.ReactElement[] = [];

  // 1. 总体概览
  elements.push(
    <div key="overview">
      过去 {days} 天共处理了 {stats.totalSearches} 次搜索，其中包含{" "}
      {stats.uniqueQueries} 个不同的搜索词。
    </div>,
  );

  // 2. 搜索效果
  elements.push(
    <div key="effectiveness">
      平均每次搜索返回 {stats.avgResultCount} 个结果
      {stats.zeroResultRate > 0 && (
        <>， {stats.zeroResultRate.toFixed(1)}% 的搜索没有找到任何结果</>
      )}
      。
    </div>,
  );

  // 3. 搜索性能
  if (stats.avgDuration > 0) {
    elements.push(
      <div key="performance">
        平均搜索耗时为 {stats.avgDuration} 毫秒
        {stats.avgDuration > 500 && "，建议优化搜索性能"}。
      </div>,
    );
  }

  // 4. 热门分词
  if (stats.topTokens && stats.topTokens.length > 0) {
    elements.push(
      <div key="topTokens">
        最热门的分词是 &ldquo;{stats.topTokens[0]?.token}&rdquo;，共出现了{" "}
        {stats.topTokens[0]?.count} 次。
      </div>,
    );
  }
  return elements;
}

export default function SearchInsightReport() {
  const [stats, setStats] = useState<SearchLogStatsResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [days, setDays] = useState<number>(30);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { broadcast } = useBroadcastSender<{ type: string }>();

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-insight-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchStats = useCallback(
    async (daysParam = 30, forceRefresh = false) => {
      if (forceRefresh) {
        setStats(null);
        broadcast({ type: "search-insight-refresh" });
        return;
      }
      setError(null);
      setDays(daysParam);

      try {
        const result = await getSearchLogStats({
          days: daysParam,
          force: forceRefresh,
        });

        if (result.success && result.data) {
          setStats(result.data);
        } else {
          setError(new Error(result.message || "获取统计数据失败"));
        }
      } catch (err) {
        console.error("获取搜索日志统计失败:", err);
        setError(new Error("获取统计数据失败"));
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchStats(days);
  }, [refreshTrigger, days, fetchStats]);

  return (
    <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
      <AutoTransition type="scale" className="h-full">
        {stats ? (
          <div
            className="flex flex-col justify-between p-10 h-full gap-4"
            key="content"
          >
            <div className="text-2xl">搜索洞察报告</div>
            <div className="flex-1 space-y-1">
              {generateDescription(stats, days)}
            </div>
            <div>
              <div className="inline-flex items-center gap-2">
                {stats.cached ? "统计缓存于:" : "统计刷新于:"}
                {new Date(stats.generatedAt).toLocaleString("zh-CN")}
                <Clickable onClick={() => fetchStats(days, true)}>
                  <RiRefreshLine size={"1em"} />
                </Clickable>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="px-10 h-full" key="error">
            <ErrorPage reason={error} reset={() => fetchStats(days)} />
          </div>
        ) : (
          <div className="h-full" key="loading">
            <LoadingIndicator />
          </div>
        )}
      </AutoTransition>
    </GridItem>
  );
}
