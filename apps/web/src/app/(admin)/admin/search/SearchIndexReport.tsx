"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { SearchIndexStatsResult } from "@repo/shared-types/api/search";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getSearchIndexStats } from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

/**
 * 格式化文件大小
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 生成自然语言描述
 */
function generateDescription(
  stats: SearchIndexStatsResult,
): React.ReactElement[] {
  const elements: React.ReactElement[] = [];

  // 1. 总体概览
  elements.push(
    <div key="overview">
      当前共有 {stats.totalPosts} 篇文章，其中 {stats.indexedPosts}{" "}
      篇已建立搜索索引 ({stats.indexRate}%)。
    </div>,
  );

  // 2. 索引状态详情
  const statusParts: string[] = [];
  if (stats.upToDatePosts > 0) {
    statusParts.push(
      `${stats.upToDatePosts} 篇索引最新 (${stats.upToDateRate}%)`,
    );
  }
  if (stats.outdatedPosts > 0) {
    statusParts.push(`${stats.outdatedPosts} 篇已过期`);
  }
  if (stats.neverIndexedPosts > 0) {
    statusParts.push(`${stats.neverIndexedPosts} 篇未索引`);
  }

  if (statusParts.length > 0) {
    elements.push(<div key="status">{statusParts.join("，")}。</div>);
  }

  // 3. 索引质量
  if (stats.indexedPosts > 0) {
    elements.push(
      <div key="quality">
        已索引文章共包含 {stats.totalTokenCount.toLocaleString()} 个词元，总体积{" "}
        {formatSize(stats.totalTokenSize)}，平均每篇文章 {stats.avgTokenCount}{" "}
        个词元，{formatSize(stats.avgTokenSize)}。
      </div>,
    );
  }

  // 4. 近期活动
  if (stats.recentIndexed7Days > 0) {
    elements.push(
      <div key="activity">
        近 7 天新建了 {stats.recentIndexed7Days} 个索引
        {stats.recentIndexed30Days > stats.recentIndexed7Days &&
          `，近 30 天共 ${stats.recentIndexed30Days} 个`}
        。
      </div>,
    );
  } else if (stats.recentIndexed30Days > 0) {
    elements.push(
      <div key="activity">
        近 30 天新建了 {stats.recentIndexed30Days} 个索引。
      </div>,
    );
  } else {
    elements.push(<div key="activity">近 30 天没有新建索引。</div>);
  }

  // 5. 自定义词典
  elements.push(
    <div key="dictionary">
      自定义词典包含 {stats.customWordCount} 个词汇
      {stats.customWordCount === 0 &&
        "，可以添加专有名词或术语来提高分词准确性"}
      。
    </div>,
  );

  // 6. 建议
  if (stats.indexRate < 50) {
    elements.push(
      <div key="suggestion" className="text-warning">
        建议：索引率较低，建议对所有文章进行索引。
      </div>,
    );
  } else if (stats.outdatedPosts > stats.upToDatePosts) {
    elements.push(
      <div key="suggestion" className="text-warning">
        建议：大部分索引已过期，建议重建索引。
      </div>,
    );
  } else if (stats.upToDateRate === 100 && stats.indexRate === 100) {
    elements.push(
      <div key="suggestion" className="text-success">
        所有索引都是最新的，搜索索引运行良好。
      </div>,
    );
  }

  return elements;
}

export default function SearchIndexReport() {
  const [stats, setStats] = useState<SearchIndexStatsResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { broadcast } = useBroadcastSender<{ type: string }>();

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-index-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchStats = useCallback(
    async (forceRefresh = false) => {
      if (forceRefresh) {
        setStats(null);
        broadcast({ type: "search-index-refresh" });
        return;
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
        console.error("获取搜索索引统计失败:", err);
        setError(new Error("获取统计数据失败"));
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger, fetchStats]);

  return (
    <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.8}>
      <AutoTransition type="scale" className="h-full">
        {stats ? (
          <div
            className="flex flex-col justify-between p-10 h-full gap-4"
            key="content"
          >
            <div className="text-2xl">搜索索引统计</div>
            <div className="flex-1 space-y-1">{generateDescription(stats)}</div>
            <div>
              <div className="inline-flex items-center gap-2">
                {stats.cached ? "统计缓存于:" : "统计刷新于:"}
                {new Date(stats.generatedAt).toLocaleString("zh-CN")}

                <Clickable onClick={() => fetchStats(true)}>
                  <RiRefreshLine size={"1em"} />
                </Clickable>
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="px-10 h-full" key="error">
            <ErrorPage reason={error} reset={() => fetchStats(true)} />
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
