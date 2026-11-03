"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecycleBinStatsData } from "@repo/shared-types/api/recycle-bin";

import DimensionStatsChart, {
  type DimensionStatsItem,
} from "@/components/client/charts/DimensionStatsChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getRecycleBinStats } from "@/lib/client/api/recycle-bin-read";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

const REFRESH_EVENT = "recycle-bin-refresh";

export default function RecycleBinDistributionChart() {
  const mainColor = useMainColor().primary;
  const [stats, setStats] = useState<RecycleBinStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getRecycleBinStats();
      if (!response.success || !response.data) {
        setError(new Error(response.message || "获取回收站分布失败"));
        return;
      }
      setStats(response.data);
    } catch (error) {
      setError(
        error instanceof Error ? error : new Error("获取回收站分布失败"),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === REFRESH_EVENT) {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  const chartItems: DimensionStatsItem[] = useMemo(() => {
    if (!stats?.types) {
      return [];
    }
    return [...stats.types]
      .sort((a, b) => b.count - a.count)
      .map((item) => ({
        name: item.label,
        count: item.count,
        percentage: item.percentage,
      }));
  }, [stats]);

  const colors = useMemo(
    () =>
      generateGradient(
        mainColor,
        generateComplementary(mainColor),
        Math.max(chartItems.length, 2),
      ),
    [mainColor, chartItems.length],
  );

  return (
    <GridItem
      areas={[9, 10, 11, 12]}
      width={3}
      height={0.8}
      className="py-10"
      fixedHeight
    >
      <AutoTransition type="slideUp" className="h-full">
        {isLoading ? (
          <LoadingIndicator key="loading" />
        ) : error ? (
          <div className="px-10 h-full" key="error">
            <ErrorPage reason={error} reset={() => fetchData()} />
          </div>
        ) : (
          <div key="content" className="flex flex-col h-full px-10">
            <DimensionStatsChart
              title="回收站占比"
              items={chartItems}
              colors={colors}
            />
          </div>
        )}
      </AutoTransition>
    </GridItem>
  );
}
