"use client";

import React, { useEffect, useState } from "react";
import { useMemo } from "react";
import type { SearchLogStatsResult } from "@repo/shared-types/api/search";
import { AnimatePresence, motion } from "framer-motion";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getSearchLogStats } from "@/lib/client/api/search-stats";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function SearchPerformanceChart() {
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
      console.error("获取搜索性能失败:", err);
      setError(new Error("获取统计数据失败"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [refreshTrigger]);

  // 转换数据格式为面积图需要的格式
  const { chartData, series } = useMemo(() => {
    if (!stats) {
      return { chartData: null, series: [] };
    }

    // 智能过滤
    let firstNonZeroIndex = -1;
    for (let i = 0; i < stats.dailyTrend.length; i++) {
      const item = stats.dailyTrend[i];
      if (item && item.avgDuration > 0) {
        firstNonZeroIndex = i;
        break;
      }
    }

    const startIndex =
      firstNonZeroIndex > 0 ? firstNonZeroIndex - 1 : firstNonZeroIndex;

    const filteredTrend =
      startIndex >= 0 ? stats.dailyTrend.slice(startIndex) : [];

    // 转换数据格式
    const chartData: AreaChartDataPoint[] = filteredTrend.map(
      (item: { date: string; avgDuration: number }) => ({
        time: item.date,
        avgDuration: item.avgDuration,
      }),
    );

    // 配置系列
    const series: SeriesConfig[] = [
      {
        key: "avgDuration",
        label: "平均耗时",
        color: "var(--color-primary)",
      },
    ];

    return { chartData, series };
  }, [stats]);

  // 格式化数值
  const formatValue = (value: number, key: string) => {
    if (key === "avgDuration") {
      return `${Math.round(value)} ms`;
    }
    return Math.round(value).toString();
  };

  return (
    <GridItem
      areas={[9, 10, 11, 12]}
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
                <div className="text-2xl">搜索性能</div>
              </div>
              <div className="w-full h-full">
                <AreaChart
                  data={chartData}
                  series={series}
                  className="w-full h-full"
                  formatValue={formatValue}
                  timeGranularity="day"
                  showYear="auto"
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
