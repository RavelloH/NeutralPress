"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CronTrendItem } from "@repo/shared-types/api/cron";

import BarChart, {
  type BarChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/BarChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCronTrends } from "@/lib/client/api/cron-history";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function CronHistoryChart() {
  const mainColor = useMainColor().primary;
  const [data, setData] = useState<CronTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getCronTrends({ days: 30, count: 30 });
      if (!result.success) {
        setError(new Error(result.message || "获取计划任务趋势失败"));
        return;
      }
      if (result.data) {
        setData(result.data);
      }
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError
          : new Error("获取计划任务趋势失败"),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "cron-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshTrigger]);

  const chartData: BarChartDataPoint[] = data.map((item) => ({
    time: item.time,
    doctor: item.data.doctorDurationMs,
    projects: item.data.projectsDurationMs,
    friends: item.data.friendsDurationMs,
    cleanup: item.data.cleanupDurationMs,
    analytics: item.data.analyticsDurationMs,
  }));

  const colors = useMemo(() => {
    try {
      return generateGradient(mainColor, generateComplementary(mainColor), 5);
    } catch (colorError) {
      console.error("[CronHistoryChart] 生成图表配色失败:", colorError);
      return [
        "var(--color-success)",
        "var(--color-warning)",
        "var(--color-error)",
        "var(--color-info)",
        "var(--color-primary)",
      ];
    }
  }, [mainColor]);

  const series: SeriesConfig[] = [
    {
      key: "doctor",
      label: "Doctor",
      color: colors[0] || "var(--color-success)",
    },
    {
      key: "projects",
      label: "Projects",
      color: colors[1] || "var(--color-warning)",
    },
    {
      key: "friends",
      label: "Friends",
      color: colors[2] || "var(--color-error)",
    },
    {
      key: "cleanup",
      label: "Cleanup",
      color: colors[3] || "var(--color-info)",
    },
    {
      key: "analytics",
      label: "Analytics",
      color: colors[4] || "var(--color-primary)",
    },
  ];

  return (
    <GridItem
      areas={[9, 10, 11, 12]}
      width={3}
      height={0.5}
      className="py-10"
      fixedHeight
    >
      <AutoTransition type="slideUp" className="h-full">
        {isLoading ? (
          <LoadingIndicator key="loading" />
        ) : error ? (
          <div key="error" className="px-10 h-full">
            <ErrorPage reason={error} reset={() => void fetchData()} />
          </div>
        ) : (
          <>
            <div className="text-2xl mb-2 px-10">计划任务分项耗时趋势</div>
            <div className="w-full h-full" key="content">
              <BarChart
                data={chartData}
                series={series}
                className="w-full h-full"
                timeGranularity="day"
                showYear="auto"
                formatValue={(value) => `${Math.round(value)}ms`}
              />
            </div>
          </>
        )}
      </AutoTransition>
    </GridItem>
  );
}
