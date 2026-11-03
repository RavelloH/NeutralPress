"use client";

import { useCallback, useEffect, useState } from "react";
import type { DoctorTrendItem } from "@repo/shared-types/api/doctor";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getDoctorTrends } from "@/lib/client/api/doctor-read";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function DoctorHistoryChart() {
  const [data, setData] = useState<DoctorTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await getDoctorTrends({ days: 30, count: 30 });
      if (!res.success) {
        setError(new Error(res.message || "获取趋势数据失败"));
        return;
      }
      if (res.data) {
        setData(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取趋势数据失败"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "doctor-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  // 转换数据格式
  const chartData: AreaChartDataPoint[] = data.map((item) => ({
    time: item.time,
    info: item.data.info,
    warning: item.data.warning,
    error: item.data.error,
  }));

  // 配置系列
  const series: SeriesConfig[] = [
    {
      key: "info",
      label: "正常",
      color: "var(--color-primary)",
    },
    {
      key: "warning",
      label: "警告",
      color: "var(--color-warning)",
    },
    {
      key: "error",
      label: "错误",
      color: "var(--color-error)",
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
            <ErrorPage reason={error} reset={() => fetchData()} />
          </div>
        ) : (
          <>
            <div className="text-2xl mb-2 px-10">运行状况历史趋势</div>
            <div className="w-full h-full" key="content">
              <AreaChart
                data={chartData}
                series={series}
                className="w-full h-full"
                timeGranularity="day"
                showYear="auto"
              />
            </div>
          </>
        )}
      </AutoTransition>
    </GridItem>
  );
}
