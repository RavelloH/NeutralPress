"use client";

import { useCallback, useEffect, useState } from "react";
import type { FriendLinkTrendItem } from "@repo/shared-types/api/friendlink";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getFriendLinksTrends } from "@/lib/client/api/friendlink-read";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function FriendsHistoryChart() {
  const [data, setData] = useState<FriendLinkTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await getFriendLinksTrends({ days: 365, count: 30 });
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

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "friends-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    void fetchData();
  }, [refreshTrigger, fetchData]);

  let firstNonZeroIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (
      item &&
      (item.data.total > 0 || item.data.new > 0 || item.data.published > 0)
    ) {
      firstNonZeroIndex = i;
      break;
    }
  }

  const startIndex =
    firstNonZeroIndex > 0 ? firstNonZeroIndex - 1 : firstNonZeroIndex;

  const chartData: AreaChartDataPoint[] =
    startIndex >= 0
      ? data.slice(startIndex).map((item) => ({
          time: item.time,
          total: item.data.total,
          new: item.data.new,
          published: item.data.published,
        }))
      : [];

  const series: SeriesConfig[] = [
    {
      key: "new",
      label: "新增友链",
      color: "var(--color-success)",
    },
    {
      key: "published",
      label: "累计发布",
      color: "var(--color-warning)",
    },
    {
      key: "total",
      label: "累计总数",
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
            <ErrorPage reason={error} reset={() => void fetchData()} />
          </div>
        ) : (
          <>
            <div className="text-2xl mb-2 px-10">友情链接趋势</div>
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
