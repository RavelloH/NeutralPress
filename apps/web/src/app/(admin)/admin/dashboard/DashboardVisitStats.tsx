"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";
import type { GetVisitStatsSuccessResponse } from "@repo/shared-types/api/stats";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getVisitStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type stats = GetVisitStatsSuccessResponse["data"] | null;

export default function DashboardVisitStats() {
  const [result, setResult] = useState<stats>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await getVisitStats({ force: forceRefresh });
    if (!res.success) {
      setError(new Error(res.message || "获取访问统计数据失败"));
      return;
    }
    setResult(res.data);
    setIsCache(res.data.cache);
    setRefreshTime(new Date(res.data.updatedAt));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  const getSummary = (result: stats) => {
    if (!result) return null;
    const { last24Hours, totalViews, totalVisitors } = result;

    return (
      <>
        <div className="mb-2">
          最近 24 小时共有 {last24Hours.visitors} 名访客访问 {last24Hours.views}{" "}
          次，平均停留 {formatDuration(last24Hours.averageDuration)}，跳出率{" "}
          {last24Hours.bounceRate}%。
        </div>
        <div className="mb-2">
          总访问量：{totalViews.total.toLocaleString()}，最近 7 天：
          {totalViews.last7Days.toLocaleString()}，最近 30 天：
          {totalViews.last30Days.toLocaleString()}。平均每天：
          {totalViews.averagePerDay.toLocaleString()}。
        </div>
        <div>
          总独立访客：{totalVisitors.total.toLocaleString()}，最近 7 天：
          {totalVisitors.last7Days.toLocaleString()}，最近 30 天：
          {totalVisitors.last30Days.toLocaleString()}。平均每天：
          {totalVisitors.averagePerDay.toLocaleString()}。
        </div>
      </>
    );
  };

  return (
    <div className="p-10 h-full">
      <AutoTransition className="h-full" type="scale">
        {result ? (
          <div key="content" className="flex flex-col justify-between h-full">
            <div>
              <div className="text-2xl py-2">
                <Link href="/admin/analytics" presets={["hover-underline"]}>
                  访问统计
                </Link>
              </div>
              <div>{getSummary(result)}</div>
            </div>
            <div className="flex justify-between items-center">
              {refreshTime && (
                <div className="inline-flex items-center gap-2">
                  {isCache ? "统计缓存于" : "统计刷新于"}:{" "}
                  {new Date(refreshTime).toLocaleString()}
                  <Clickable onClick={() => fetchData(true)}>
                    <RiRefreshLine size={"1em"} />
                  </Clickable>
                </div>
              )}
            </div>
          </div>
        ) : error ? (
          <ErrorPage reason={error} reset={() => fetchData(true)} />
        ) : (
          <LoadingIndicator key="loading" size="md" />
        )}
      </AutoTransition>
    </div>
  );
}
