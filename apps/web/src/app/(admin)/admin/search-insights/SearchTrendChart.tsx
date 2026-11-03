"use client";

import React, { useEffect, useState } from "react";
import { useMemo } from "react";
import type { SearchLogStatsResult } from "@repo/shared-types/api/search";
import { AnimatePresence, motion } from "framer-motion";

import BarChart, {
  type BarChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/BarChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getSearchLogStats } from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function SearchTrendChart() {
  const [stats, setStats] = useState<SearchLogStatsResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-insight-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getSearchLogStats({ days: 365 });

      if (result.success && result.data) {
        setStats(result.data);
      } else {
        setError(new Error(result.message || "获取统计数据失败"));
      }
    } catch (err) {
      console.error("获取搜索趋势失败:", err);
      setError(new Error("获取统计数据失败"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger]);

  // 转换数据格式为柱状图需要的格式
  const { chartData, series } = useMemo(() => {
    if (!stats) {
      return { chartData: null, series: [] };
    }

    // 智能过滤
    let firstNonZeroIndex = -1;
    for (let i = 0; i < stats.dailyTrend.length; i++) {
      const item = stats.dailyTrend[i];
      if (
        item &&
        (item.searchCount > 0 ||
          item.uniqueVisitors > 0 ||
          item.zeroResultCount > 0)
      ) {
        firstNonZeroIndex = i;
        break;
      }
    }

    const startIndex =
      firstNonZeroIndex > 0 ? firstNonZeroIndex - 1 : firstNonZeroIndex;

    const filteredTrend =
      startIndex >= 0 ? stats.dailyTrend.slice(startIndex) : [];

    // 转换数据格式
    const chartData: BarChartDataPoint[] = filteredTrend.map(
      (item: {
        date: string;
        searchCount: number;
        uniqueVisitors: number;
        zeroResultCount: number;
      }) => ({
        time: item.date,
        searchCount: item.searchCount,
        uniqueVisitors: item.uniqueVisitors,
        zeroResultCount: item.zeroResultCount,
      }),
    );

    // 配置系列
    const series: SeriesConfig[] = [
      {
        key: "uniqueVisitors",
        label: "搜索人数",
        color: "var(--color-primary)",
      },
      {
        key: "searchCount",
        label: "搜索次数",
        color: "color-mix(in srgb, var(--color-primary) 40%, transparent)",
      },
      {
        key: "zeroResultCount",
        label: "无结果次数",
        color: "var(--color-warning)",
      },
    ];

    return { chartData, series };
  }, [stats]);

  return (
    <GridItem
      areas={[5, 6, 7, 8]}
      width={3}
      height={0.5}
      className="pt-10"
      fixedHeight
    >
      <AutoTransition type="slideUp" className="h-full">
        {error ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            {error.message}
          </div>
        ) : chartData && !isLoading ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={chartData.length > 0 ? chartData[0]?.time : "empty"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="h-full flex flex-col"
            >
              <div className="flex items-center justify-between mb-2 px-10">
                <div className="text-2xl">搜索趋势</div>
              </div>
              <div className="w-full h-full">
                <BarChart
                  data={chartData}
                  series={series}
                  className="w-full h-full"
                  timeGranularity="day"
                  showYear="auto"
                  fillMissingData={true}
                  overlappingBars={true}
                />
              </div>
            </motion.div>
          </AnimatePresence>
        ) : (
          <LoadingIndicator key="loading" size="md" />
        )}
      </AutoTransition>
    </GridItem>
  );
}
