"use client";

import { useCallback, useEffect, useState } from "react";
import type { RequestTrendItem } from "@repo/shared-types/api/security";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getRequestTrends } from "@/lib/client/api/security-read";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function MonthlyTrendsChart() {
  const [data, setData] = useState<RequestTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      // 获取30天 = 720小时的数据
      const res = await getRequestTrends({ hours: 720, granularity: "hour" });
      if (!res.success) {
        setError(new Error(res.message || "获取请求趋势失败"));
        return;
      }
      if (res.data) {
        setData(res.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取请求趋势失败"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "security-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  // 转换数据格式
  const chartData: AreaChartDataPoint[] = data.map((item) => ({
    time: item.time,
    requests: item.count,
    errors: item.error || 0,
  }));

  // 配置系列
  const series: SeriesConfig[] = [
    {
      key: "errors",
      label: "错误请求",
      color: "var(--color-error)",
    },
    {
      key: "requests",
      label: "总请求",
      color: "var(--color-primary)",
    },
  ];

  return (
    <GridItem
      areas={[5, 6, 7, 8]}
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
            <div className="text-2xl mb-2 px-10">请求趋势（30天）</div>
            <div className="w-full h-full" key="content">
              <AreaChart
                data={chartData}
                series={series}
                className="w-full h-full"
                timeGranularity="hour"
                showYear="auto"
              />
            </div>
          </>
        )}
      </AutoTransition>
    </GridItem>
  );
}
