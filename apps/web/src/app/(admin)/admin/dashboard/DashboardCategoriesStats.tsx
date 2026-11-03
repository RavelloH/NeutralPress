"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getCategoriesStats } from "@/lib/client/api/stats";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  total: {
    total: number;
    topLevel: number;
    withPosts: number;
    withoutPosts: number;
  };
  depth: {
    maxDepth: number;
    avgDepth: number;
  };
  new: {
    last7Days: number;
    last30Days: number;
    lastYear: number;
  };
} | null;

export default function DashboardCategoriesStats() {
  const [result, setResult] = useState<StatsData>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    const res = await getCategoriesStats({ force: forceRefresh });
    if (!res.success) {
      setError(new Error(res.message || "获取分类统计数据失败"));
      return;
    }
    if (!res.data) return;
    setResult(res.data);
    setIsCache(res.data.cache);
    setRefreshTime(new Date(res.data.updatedAt));
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getSummary = (result: StatsData) => {
    if (!result) return null;
    const { total, topLevel, withPosts, withoutPosts } = result.total;

    if (total === 0) {
      return <>暂无分类。</>;
    }

    const parts = [
      topLevel > 0 && `${topLevel} 个顶级分类`,
      withPosts > 0 && `${withPosts} 个有文章`,
      withoutPosts > 0 && `${withoutPosts} 个无文章`,
    ].filter(Boolean);

    return (
      <>
        共 {total} 个分类{parts.length > 0 ? `，其中 ${parts.join("、")}` : ""}
        。
      </>
    );
  };

  const getNewCategoriesDescription = (result: StatsData) => {
    if (!result) return null;
    const { last7Days, last30Days, lastYear } = result.new;

    // 如果都是0
    if (last7Days === 0 && last30Days === 0 && lastYear === 0) {
      return "近一年没有新增分类。";
    }

    // 构建描述
    const parts: string[] = [];

    if (last7Days > 0) {
      parts.push(`最近一周新增了 ${last7Days} 个`);
    }

    if (last30Days > last7Days) {
      parts.push(`近30天共新增 ${last30Days} 个`);
    } else if (last30Days > 0 && last7Days === 0) {
      parts.push(`近30天新增了 ${last30Days} 个`);
    }

    if (lastYear > last30Days) {
      parts.push(`近一年累计新增 ${lastYear} 个`);
    } else if (lastYear > 0 && last30Days === 0) {
      parts.push(`近一年新增了 ${lastYear} 个`);
    }

    return parts.join("，") + "。";
  };

  const getDepthDescription = (result: StatsData) => {
    if (!result || result.depth.maxDepth === 0) return null;
    return `最大层级深度：${result.depth.maxDepth}，平均深度：${result.depth.avgDepth.toFixed(1)}`;
  };

  return (
    <div className="h-full p-10">
      <AutoTransition className="h-full" type="scale">
        {result ? (
          <div key="content" className="flex flex-col justify-between h-full">
            <div>
              <div className="text-2xl py-2">
                <Link href="/admin/categories" presets={["hover-underline"]}>
                  分类管理
                </Link>
              </div>
              <div>{getSummary(result)}</div>
            </div>
            <div className="space-y-1">
              {getDepthDescription(result) && (
                <div>{getDepthDescription(result)}</div>
              )}
              <div>{getNewCategoriesDescription(result)}</div>
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
