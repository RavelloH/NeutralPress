"use client";

import React, { useEffect, useRef, useState } from "react";
import type {
  SearchIndexStatsResult,
  SearchLogStatsResult,
} from "@repo/shared-types/api/search";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import {
  getSearchIndexStats,
  getSearchLogStats,
} from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Tooltip } from "@/ui/Tooltip";

export default function SearchWordCloud() {
  const [searchStats, setSearchStats] = useState<SearchLogStatsResult | null>(
    null,
  );
  const [indexStats, setIndexStats] = useState<SearchIndexStatsResult | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const [leftGradient, setLeftGradient] = useState({
    showTop: false,
    showBottom: true,
  });
  const [rightGradient, setRightGradient] = useState({
    showTop: false,
    showBottom: true,
  });
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-insight-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchStats = async () => {
    setSearchStats(null);
    setIndexStats(null);
    setError(null);

    try {
      const [searchResult, indexResult] = await Promise.all([
        getSearchLogStats({ days: 30 }),
        getSearchIndexStats({ force: false }),
      ]);

      if (searchResult.success && searchResult.data) {
        setSearchStats(searchResult.data);
      } else {
        setError(new Error(searchResult.message || "获取搜索统计数据失败"));
      }

      if (indexResult.success && indexResult.data) {
        setIndexStats(indexResult.data);
      }
    } catch (err) {
      console.error("获取搜索词云数据失败:", err);
      setError(new Error("获取搜索词云数据失败"));
    }
  };

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger]);

  // 判断词是否在两边都出现
  const getWordType = (word: string) => {
    const inSearch = searchStats?.topTokens?.some((t) => t.token === word);
    const inIndex = indexStats?.topWords?.some((w) => w.word === word);

    if (inSearch && inIndex) return "both";
    if (inSearch) return "search-only";
    if (inIndex) return "index-only";
    return "unknown";
  };

  // 渲染词云项
  const renderWordItem = (
    word: string,
    count: number,
    maxCount: number,
    minCount: number,
    index: number,
    isLeft: boolean,
  ) => {
    const wordType = getWordType(word);
    const normalizedSize =
      minCount === maxCount ? 0.5 : (count - minCount) / (maxCount - minCount);
    const fontSize = 1;
    const opacity = 0.3 + normalizedSize * 0.7;

    // 根据词的类型设置颜色
    const colorClass =
      wordType === "both"
        ? "bg-primary/10 text-primary"
        : wordType === "search-only"
          ? "bg-warning/10 text-warning"
          : "bg-muted-foreground/10 text-muted-foreground";

    // 判断是否高亮
    const isHighlighted = hoveredWord === word;

    return (
      <Tooltip
        key={index}
        content={`出现 ${count} 次`}
        placement="top"
        delay={100}
      >
        <span
          data-word={word}
          style={{
            fontSize: `${fontSize}rem`,
            opacity: isHighlighted && wordType === "both" ? 1 : opacity,
          }}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-xs font-mono cursor-help transition-all duration-200 ${
            isHighlighted ? "" : ""
          } ${colorClass}`}
          onMouseEnter={() => handleWordHover(word, isLeft)}
          onMouseLeave={() => setHoveredWord(null)}
        >
          {word}
        </span>
      </Tooltip>
    );
  };

  // 监听滚动事件更新渐变遮罩
  const handleScroll = (e: React.UIEvent<HTMLDivElement>, isLeft: boolean) => {
    const container = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = container;

    // 顶部渐变：距离顶部超过 10px 时显示
    const showTop = scrollTop > 10;

    // 底部渐变：距离底部超过 10px 时显示
    const isNearBottom = scrollTop >= scrollHeight - clientHeight - 10;
    const showBottom = !isNearBottom;

    // 根据容器更新对应的状态
    if (isLeft) {
      setLeftGradient({ showTop, showBottom });
    } else {
      setRightGradient({ showTop, showBottom });
    }
  };

  // 处理 hover 事件，滚动对应的词到视口
  const handleWordHover = (word: string, isLeft: boolean) => {
    setHoveredWord(word);

    // 找到对应的滚动容器（如果当前是左边，就滚动右边的，反之亦然）
    const targetContainer = isLeft
      ? rightScrollRef.current
      : leftScrollRef.current;
    if (!targetContainer) return;

    // 找到对应的词元素
    const targetWord = targetContainer.querySelector(
      `[data-word="${word}"]`,
    ) as HTMLElement;
    if (targetWord) {
      targetWord.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  };

  return (
    <GridItem
      areas={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
      width={1.5}
      height={2}
    >
      <div className="flex flex-col h-full p-10 overflow-hidden">
        {/* 顶部固定高度 */}
        <div className="flex flex-col gap-2 shrink-0 pb-2">
          <div className="flex items-center justify-between">
            <div className="text-2xl">搜索热词</div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden my-2">
          <AutoTransition type="slideUp" className="h-full">
            {error ? (
              <div className="h-full overflow-auto">
                <ErrorPage reason={error} reset={fetchStats} key="error" />
              </div>
            ) : !searchStats || !indexStats ? (
              <div
                className="h-full flex items-center justify-center"
                key="loading"
              >
                <LoadingIndicator />
              </div>
            ) : (
              <div className="h-full flex gap-4 min-h-0" key="wordcloud">
                {/* 左侧：搜索热词 */}
                <div className="flex-1 relative min-h-0">
                  {/* 顶部渐变遮罩 */}
                  <div
                    className={`absolute top-0 left-0 right-2 h-6 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      leftGradient.showTop ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 底部渐变遮罩 */}
                  <div
                    className={`absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      leftGradient.showBottom ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 滚动内容 */}
                  <div
                    ref={leftScrollRef}
                    onScroll={(e) => handleScroll(e, true)}
                    className="overflow-y-auto scrollbar-hide pr-2 h-full"
                  >
                    <div className="flex flex-wrap gap-2 justify-between [&>*:last-child]:mr-auto">
                      {searchStats.topTokens &&
                      searchStats.topTokens.length > 0 ? (
                        searchStats.topTokens.map(
                          (
                            { token, count }: { token: string; count: number },
                            index: number,
                          ) => {
                            const maxCount = Math.max(
                              ...searchStats.topTokens.map((w) => w.count),
                            );
                            const minCount = Math.min(
                              ...searchStats.topTokens.map((w) => w.count),
                            );
                            return renderWordItem(
                              token,
                              count,
                              maxCount,
                              minCount,
                              index,
                              true,
                            );
                          },
                        )
                      ) : (
                        <div className="text-muted-foreground text-sm">
                          暂无搜索热词
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 右侧：全站词云 */}
                <div className="flex-1 relative min-h-0">
                  {/* 顶部渐变遮罩 */}
                  <div
                    className={`absolute top-0 left-0 right-2 h-6 bg-gradient-to-b from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      rightGradient.showTop ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 底部渐变遮罩 */}
                  <div
                    className={`absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 ${
                      rightGradient.showBottom ? "opacity-100" : "opacity-0"
                    }`}
                  />

                  {/* 滚动内容 */}
                  <div
                    ref={rightScrollRef}
                    onScroll={(e) => handleScroll(e, false)}
                    className="overflow-y-auto scrollbar-hide pr-2 h-full"
                  >
                    <div className="flex flex-wrap gap-2 justify-between [&>*:last-child]:mr-auto">
                      {indexStats.topWords && indexStats.topWords.length > 0 ? (
                        indexStats.topWords.map(
                          (
                            { word, count }: { word: string; count: number },
                            index: number,
                          ) => {
                            const maxCount = Math.max(
                              ...indexStats.topWords.map((w) => w.count),
                            );
                            const minCount = Math.min(
                              ...indexStats.topWords.map((w) => w.count),
                            );
                            return renderWordItem(
                              word,
                              count,
                              maxCount,
                              minCount,
                              index,
                              false,
                            );
                          },
                        )
                      ) : (
                        <div className="text-muted-foreground text-sm">
                          暂无全站词云
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </AutoTransition>
        </div>

        {/* 底部统计信息固定高度 */}
        <AutoTransition type="fade">
          {searchStats &&
          searchStats.topTokens &&
          searchStats.topTokens.length > 0 ? (
            <div
              className="text-xs text-muted-foreground h-6 flex items-center gap-4 shrink-0"
              key="stats"
            >
              <span>搜索热词: {searchStats.topTokens.length} 个</span>
              <span>全站词云: {indexStats?.topWords?.length || 0} 个</span>
              <span className="text-primary">
                共同词:{" "}
                {
                  searchStats.topTokens.filter((t) =>
                    indexStats?.topWords?.some((w) => w.word === t.token),
                  ).length
                }{" "}
                个
              </span>
            </div>
          ) : (
            <div
              className="text-xs text-muted-foreground h-6 opacity-0 shrink-0"
              key="placeholder"
            >
              统计信息加载中...
            </div>
          )}
        </AutoTransition>
      </div>
    </GridItem>
  );
}
