"use client";

import { useCallback, useEffect, useState } from "react";
import type { CommentHistoryPoint } from "@repo/shared-types/api/comment";

import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import StackedBarChart, {
  type SeriesConfig as StackedSeriesConfig,
  type StackedBarChartDataPoint,
} from "@/components/client/charts/StackedBarChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCommentHistory } from "@/lib/client/api/comment-read";
import runWithAuth from "@/lib/client/run-with-auth";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AutoTransition } from "@/ui/AutoTransition";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

export default function CommentsHistoryChart() {
  const mainColor = useMainColor().primary;
  const [data, setData] = useState<CommentHistoryPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await runWithAuth(getCommentHistory, { days: 365 } as never);
      if (!res || !("data" in res) || !res.data) {
        throw new Error("获取评论趋势失败");
      }
      setData(res.data as CommentHistoryPoint[]);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取评论趋势失败"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "comments-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);

  let firstNonZeroIndex = -1;
  for (let i = 0; i < data.length; i++) {
    const point = data[i];
    if (point && (point.total > 0 || point.approved > 0 || point.pending > 0)) {
      firstNonZeroIndex = i;
      break;
    }
  }

  const startIndex =
    firstNonZeroIndex > 0 ? firstNonZeroIndex - 1 : firstNonZeroIndex;

  const chartData: AreaChartDataPoint[] =
    startIndex >= 0
      ? data.slice(startIndex).map((item) => ({
          time: item.date,
          total: item.total,
          approved: item.approved,
          pending: item.pending,
        }))
      : [];

  const series: SeriesConfig[] = [
    { key: "total", label: "总评论数", color: "var(--color-primary)" },
    { key: "approved", label: "通过", color: "var(--color-success)" },
    { key: "pending", label: "待审核", color: "var(--color-warning)" },
  ];

  const { stackedData, stackedSeries } = (() => {
    type PostEntry =
      CommentHistoryPoint["posts"] extends Array<infer T>
        ? T
        : { slug: string; title: string | null; count: number };

    const effectiveData: CommentHistoryPoint[] =
      startIndex >= 0 ? data.slice(startIndex) : data;
    const normalizedData: CommentHistoryPoint[] = effectiveData.map(
      (item): CommentHistoryPoint => ({
        ...item,
        posts: item.posts ?? [],
      }),
    );

    const allSlugs = new Set<string>();
    normalizedData.forEach((item) =>
      item.posts
        .filter((p: PostEntry) => p.slug && p.count > 0)
        .forEach((p: PostEntry) => {
          allSlugs.add(p.slug);
        }),
    );

    const barData: StackedBarChartDataPoint[] = normalizedData
      .map((item) => {
        const entry: StackedBarChartDataPoint = { time: item.date };
        item.posts
          .filter((p: PostEntry) => p.slug && p.count > 0)
          .forEach((p: PostEntry) => {
            entry[p.slug] = p.count;
          });
        return entry;
      })
      .filter((entry) => Object.keys(entry).length > 1); // 仅保留有数据的日期

    let colors = generateGradient(
      mainColor,
      generateComplementary(mainColor),
      10,
    );
    colors = colors.flatMap((_, i, arr) =>
      i < arr.length / 2 ? [arr[i], arr[i + arr.length / 2]] : [],
    ) as string[];

    const series: StackedSeriesConfig[] = Array.from(allSlugs).map(
      (slug, index) => {
        const title =
          normalizedData
            .find((item) => item.posts?.some((p: PostEntry) => p.slug === slug))
            ?.posts?.find((p: PostEntry) => p.slug === slug)?.title || slug;
        return {
          key: slug,
          label: title || slug,
          color: colors[index % colors.length] || "var(--color-primary)",
        };
      },
    );

    return { stackedData: barData, stackedSeries: series };
  })();

  return (
    <>
      <GridItem
        areas={[5, 6, 7, 8]}
        width={3}
        height={0.5}
        className="py-10"
        fixedHeight
      >
        <AutoTransition type="slideUp" className="h-full">
          {isLoading ? (
            <LoadingIndicator key="loading-bar" />
          ) : error ? (
            <div className="px-10 h-full" key="error-bar">
              <ErrorPage reason={error} reset={fetchData} />
            </div>
          ) : (
            <>
              <div className="text-2xl mb-2 px-10">按文章分布</div>
              <div className="w-full h-full" key="stacked">
                <StackedBarChart
                  data={stackedData}
                  series={stackedSeries}
                  className="w-full h-full"
                  timeGranularity="day"
                  showYear="auto"
                />
              </div>
            </>
          )}
        </AutoTransition>
      </GridItem>
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
            <div className="px-10 h-full" key="error">
              <ErrorPage reason={error} reset={fetchData} />
            </div>
          ) : (
            <>
              <div className="text-2xl mb-2 px-10">评论趋势</div>
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
    </>
  );
}
