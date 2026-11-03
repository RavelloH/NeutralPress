"use client";

import React, { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { SearchIndexStatsResult } from "@repo/shared-types/api/search";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
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
        个词元。
      </div>,
    );
  }

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
  }

  return elements;
}

export default function DashboardSearchIndexStats() {
  const [stats, setStats] = useState<SearchIndexStatsResult | null>(null);
  const [error, setError] = useState<Error | null>(null);

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
      console.error("获取搜索索引统计失败:", err);
      setError(new Error("获取统计数据失败"));
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <AutoTransition type="scale" className="h-full">
      {stats ? (
        <div
          className="flex flex-col justify-between p-10 h-full gap-4"
          key="content"
        >
          <div>
            <div className="text-2xl py-2">
              <Link href="/admin/search" presets={["hover-underline"]}>
                搜索索引
              </Link>
            </div>
            <div className="space-y-1">{generateDescription(stats)}</div>
          </div>
          <div>
            <div className="inline-flex items-center gap-2">
              {stats.cached ? "统计缓存于:" : "统计刷新于:"}{" "}
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
  );
}
