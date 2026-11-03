"use client";

import { useCallback, useEffect, useState } from "react";
import type { PostTrendItem } from "@repo/shared-types/api/post";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getPostsTrends } from "@/lib/client/api/post-read";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function PostsHistoryChart() {
  const [data, setData] = useState<PostTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await getPostsTrends({ days: 365, count: 30 });
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
    if (message.type === "posts-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  // 转换数据格式，智能过滤：
  // 1. 找到第一个非零点
  // 2. 保留该点之前的最后一个零点（如果存在）作为基线
  // 3. 保留从该零点开始的所有后续数据
  let firstNonZeroIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (
      item &&
      (item.data.total > 0 || item.data.new > 0 || item.data.personal > 0)
    ) {
      firstNonZeroIndex = i;
      break;
    }
  }

  // 计算起始索引：第一个非零点之前的最后一个零点
  // 如果第一个非零点是索引 0，则从 0 开始
  // 如果没有非零点，返回空数组
  const startIndex =
    firstNonZeroIndex > 0 ? firstNonZeroIndex - 1 : firstNonZeroIndex;

  const chartData: AreaChartDataPoint[] =
    startIndex >= 0
      ? data.slice(startIndex).map((item) => ({
          time: item.time,
          total: item.data.total,
          new: item.data.new,
          personal: item.data.personal,
        }))
      : [];

  const series: SeriesConfig[] = [
    {
      key: "new",
      label: "新增文章",
      color: "var(--color-success)",
    },
    {
      key: "total",
      label: "总文章数",
      color: "var(--color-primary)",
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
            <div className="text-2xl mb-2 px-10">文章增长趋势</div>
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
