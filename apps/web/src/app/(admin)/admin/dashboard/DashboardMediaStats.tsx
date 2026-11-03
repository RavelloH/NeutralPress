"use client";

import { useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import ErrorPage from "@/components/ui/Error";
import Link from "@/components/ui/Link";
import { getMediaStats } from "@/lib/client/api/media-read";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";

type StatsData = {
  updatedAt: string;
  cache: boolean;
  totalFiles: number;
  totalSize: number;
  averageDailyNew: number;
  typeDistribution: Array<{
    type: string;
    count: number;
    size: number;
    name: string;
  }>;
  recentStats: {
    last7Days: number;
    last30Days: number;
  };
};

export default function DashboardMediaStats() {
  const [result, setResult] = useState<StatsData | null>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async (forceRefresh: boolean = false) => {
    if (forceRefresh) {
      setResult(null);
    }
    setError(null);
    try {
      const res = await getMediaStats({ days: 30, force: forceRefresh });
      if (!res.success) {
        setError(new Error(res.message || "获取媒体统计失败"));
        return;
      }
      if (!res.data) return;

      // 获取文件类型名称
      const getFileTypeName = (type: string) => {
        switch (type) {
          case "IMAGE":
            return "图片";
          case "VIDEO":
            return "视频";
          case "AUDIO":
            return "音频";
          case "FILE":
            return "文件";
          default:
            return "其他";
        }
      };

      // 计算最近统计数据
      const last7Days = res.data.dailyStats
        .slice(0, 7)
        .reduce((sum, day) => sum + day.newFiles, 0);
      const last30Days = res.data.dailyStats.reduce(
        (sum, day) => sum + day.newFiles,
        0,
      );
      const averageDailyNew =
        res.data.dailyStats.length > 0
          ? Math.round(last30Days / res.data.dailyStats.length)
          : 0;

      const formattedData: StatsData = {
        updatedAt: res.data.updatedAt,
        cache: res.data.cache,
        totalFiles: res.data.totalFiles,
        totalSize: res.data.totalSize,
        averageDailyNew,
        typeDistribution: res.data.typeDistribution.map((type) => ({
          ...type,
          name: getFileTypeName(type.type),
        })),
        recentStats: {
          last7Days,
          last30Days,
        },
      };

      setResult(formattedData);
      setIsCache(res.data.cache);
      setRefreshTime(new Date(res.data.updatedAt));
    } catch (err) {
      setError(err instanceof Error ? err : new Error("获取统计数据失败"));
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getSummary = (result: StatsData) => {
    if (!result) return null;
    const { totalFiles, totalSize, typeDistribution } = result;

    if (totalFiles === 0) {
      return <>暂无媒体文件。</>;
    }

    const parts = [
      typeDistribution.length > 0 && `涵盖 ${typeDistribution.length} 种类型`,
      totalSize > 0 && `总大小 ${formatFileSize(totalSize)}`,
    ].filter(Boolean);

    return (
      <>
        当前共有 {totalFiles.toLocaleString()} 个媒体文件
        {parts.length > 0 ? `，${parts.join("、")}` : ""}。
      </>
    );
  };

  const getRecentDescription = (result: StatsData) => {
    if (!result) return null;
    const { last7Days, last30Days } = result.recentStats;
    const { averageDailyNew } = result;

    if (last7Days === 0 && last30Days === 0 && averageDailyNew === 0) {
      return "近期没有新增文件。";
    }

    const parts: string[] = [];
    if (last7Days > 0) {
      parts.push(`最近一周新增了 ${last7Days} 个文件`);
    }
    if (last30Days > last7Days) {
      parts.push(`本月共新增 ${last30Days} 个文件`);
    } else if (last30Days > 0 && last7Days === 0) {
      parts.push(`本月新增了 ${last30Days} 个文件`);
    }
    if (averageDailyNew > 0) {
      parts.push(`日均新增 ${averageDailyNew} 个文件`);
    }

    return parts.length > 0 ? parts.join("，") + "。" : "近期没有新增文件。";
  };

  const getTypeDistribution = (result: StatsData) => {
    if (!result || result.typeDistribution.length === 0) return null;

    return (
      <div>
        文件类型分布：
        {result.typeDistribution.map((type, index) => (
          <span key={type.type}>
            {index > 0 && "、"}
            {type.name} {type.count.toLocaleString()} 个
            {type.size > 0 && ` (${formatFileSize(type.size)})`}
          </span>
        ))}
        。
      </div>
    );
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 p-10">
        <AutoTransition className="h-full" type="scale">
          {result ? (
            <div key="content" className="flex flex-col justify-between h-full">
              <div>
                <div className="text-2xl py-2">
                  <Link href="/admin/media" presets={["hover-underline"]}>
                    媒体管理
                  </Link>
                </div>
                <div>{getSummary(result)}</div>
              </div>
              <div className="space-y-1">
                <div>{getRecentDescription(result)}</div>
                {getTypeDistribution(result)}
              </div>
              <div className="flex justify-between items-center">
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    {isCache ? "统计缓存于" : "统计刷新于"}:{" "}
                    {refreshTime.toLocaleString()}
                    <Clickable onClick={() => fetchData(true)}>
                      <RiRefreshLine size="1em" />
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
    </div>
  );
}
