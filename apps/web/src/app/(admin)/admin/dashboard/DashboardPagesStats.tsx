"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getPagesStats } from "@/lib/client/api/stats";
import runWithAuth from "@/lib/client/run-with-auth";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    active: number;
    suspended: number;
    system: number;
    custom: number;
  };
} | null;

export default function DashboardPagesStats() {
  const [result, setResult] = useState<StatsData>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await runWithAuth(getPagesStats, { force: forceRefresh });
    if (!res || !("data" in res) || !res.data) {
      setError(new Error("获取页面统计数据失败"));
      return;
    }
    setResult(res.data);
    setIsCache(res.data.cache);
    setRefreshTime(new Date(res.data.updatedAt));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getSummary = (result: StatsData) => {
    if (!result) return null;
    const { total, active, suspended, system, custom } = result.total;

    if (total === 0) {
      return <>暂无页面。</>;
    }

    const parts = [
      active > 0 && `${active} 个已激活`,
      suspended > 0 && `${suspended} 个已暂停`,
      system > 0 && `${system} 个系统页面`,
      custom > 0 && `${custom} 个自定义页面`,
    ].filter(Boolean);

    return (
      <>
        共 {total} 个页面{parts.length > 0 ? `，其中 ${parts.join("、")}` : ""}
        。
      </>
    );
  };

  const getTypeDistribution = (result: StatsData) => {
    if (!result || result.total.total === 0) return null;

    const { total, system, custom } = result.total;
    const systemPercentage = ((system / total) * 100).toFixed(1);
    const customPercentage = ((custom / total) * 100).toFixed(1);

    return `系统页面占比：${systemPercentage}%，自定义页面占比：${customPercentage}%`;
  };

  const getActiveStatusDescription = (result: StatsData) => {
    if (!result || result.total.total === 0) return null;

    const { total, active, suspended } = result.total;

    if (active === 0 && suspended === 0) {
      return "所有页面都处于未激活状态。";
    }

    const parts: string[] = [];

    if (active > 0) {
      const activePercentage = ((active / total) * 100).toFixed(1);
      parts.push(`${active} 个页面处于激活状态 (${activePercentage}%)`);
    }

    if (suspended > 0) {
      const suspendedPercentage = ((suspended / total) * 100).toFixed(1);
      parts.push(`${suspended} 个页面处于暂停状态 (${suspendedPercentage}%)`);
    }

    return parts.join("，") + "。";
  };

  return (
    <div className="h-full p-10">
      <AutoTransition className="h-full" type="scale">
        {result ? (
          <div key="content" className="flex flex-col justify-between h-full">
            <div>
              <div className="text-2xl py-2">
                <Link href="/admin/pages" presets={["hover-underline"]}>
                  页面管理
                </Link>
              </div>
              <div>{getSummary(result)}</div>
            </div>
            <div className="space-y-1">
              {getTypeDistribution(result) && (
                <div>{getTypeDistribution(result)}</div>
              )}
              <div>{getActiveStatusDescription(result)}</div>
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
