"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SearchIndexStatsResult } from "@repo/shared-types/api/search";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getSearchIndexStats } from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Tooltip } from "@/ui/Tooltip";

export default function WordCloudPanel() {
  const [stats, setStats] = useState<SearchIndexStatsResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showTopGradient, setShowTopGradient] = useState(false);
  const [showBottomGradient, setShowBottomGradient] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-index-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchStats = async (forceRefresh = false) => {
    if (forceRefresh) {
      setStats(null);
    }
    setError(null);

    try {
      const result = await getSearchIndexStats({ force: forceRefresh });

      if (result.success && result.data) {
        setStats(result.data);
      } else {
        setError(new Error(result.message || "获取统计数据失败"));
      }
    } catch (err) {
      console.error("获取词云数据失败:", err);
      setError(new Error("获取词云数据失败"));
    }
  };

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger]);

  // 监听滚动事件更新渐变遮罩
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = container;

    // 顶部渐变：距离顶部超过 10px 时显示
    setShowTopGradient(scrollTop > 10);

    // 底部渐变：距离底部超过 10px 时显示
    const isNearBottom = scrollTop >= scrollHeight - clientHeight - 10;
    setShowBottomGradient(!isNearBottom);
  };

  return (
    <GridItem
      areas={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
      width={1}
      height={2}
    >
      <div className="flex flex-col h-full p-10 overflow-hidden">
        {/* 顶部固定高度 */}
        <div className="flex items-center justify-between h-12 shrink-0">
          <div className="text-2xl">全站词云</div>
        </div>

        {/* 中间内容区域占据剩余空间 */}
        <div className="flex-1 min-h-0 overflow-hidden my-2">
          <AutoTransition type="slideUp" className="h-full">
            {error ? (
              <div className="h-full overflow-auto">
                <ErrorPage
                  reason={error}
                  reset={() => fetchStats(true)}
                  key="error"
                />
              </div>
            ) : !stats ? (
              <div
                className="h-full flex items-center justify-center"
                key="loading"
              >
                <LoadingIndicator />
              </div>
            ) : stats.topWords && stats.topWords.length > 0 ? (
              <div className="h-full flex gap-6 min-h-0" key="wordcloud">
                <div className="flex-1 relative min-h-0">
                  {/* 顶部渐变遮罩 */}
                  <div
                    className={`absolute top-0 left-0 right-2 h-6 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      showTopGradient ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 底部渐变遮罩 */}
                  <div
                    className={`absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      showBottomGradient ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 滚动内容 */}
                  <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    className="overflow-y-auto scrollbar-hide pr-2 h-full"
                  >
                    <div className="flex flex-wrap gap-2 justify-between [&>*:last-child]:mr-auto">
                      {stats.topWords.map(({ word, count }) => {
                        // 计算归一化大小（0-1之间）
                        const maxCount = Math.max(
                          ...stats.topWords.map((w) => w.count),
                        );
                        const minCount = Math.min(
                          ...stats.topWords.map((w) => w.count),
                        );
                        const normalizedSize =
                          minCount === maxCount
                            ? 0.5
                            : (count - minCount) / (maxCount - minCount);

                        // 根据频率计算字体大小和透明度
                        const fontSize = 1;
                        const opacity = 0.3 + normalizedSize * 0.7; // 0.4 - 1.0

                        return (
                          <Tooltip
                            key={word}
                            content={`出现 ${count} 次`}
                            placement="top"
                            delay={100}
                          >
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-xs font-mono cursor-help"
                              style={{
                                fontSize: `${fontSize}rem`,
                                opacity,
                              }}
                            >
                              {word}
                            </span>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                暂无词云数据
              </div>
            )}
          </AutoTransition>
        </div>

        {/* 底部统计信息固定高度 */}
        <AutoTransition type="fade">
          {stats && stats.topWords && stats.topWords.length > 0 ? (
            <div
              className="text-xs text-muted-foreground h-6 flex items-center shrink-0"
              key="stats"
            >
              显示前 {stats.topWords.length} 个高频词 · 最高频率:{" "}
              {Math.max(...stats.topWords.map((w) => w.count))} 次
            </div>
          ) : (
            <div
              className="text-xs text-muted-foreground h-6 opacity-0 shrink-0"
              key="placeholder"
            >
              显示前 几 个高频词 · 最高频率: 很多 次
            </div>
          )}
        </AutoTransition>
      </div>
    </GridItem>
  );
}
