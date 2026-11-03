"use client";

import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
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

export default function MediaStats() {
  const [result, setResult] = useState<StatsData | null>(null);
  const [isCache, setIsCache] = useState(true);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { broadcast } = useBroadcastSender<{ type: string }>();

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "media-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
        broadcast({ type: "media-refresh" });
        return;
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
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [refreshTrigger, fetchData]);
  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <GridItem areas={[1, 2, 3, 4]} width={3} height={0.5}>
      <AutoTransition type="scale" className="h-full">
        {result ? (
          <div
            className="flex flex-col justify-between p-10 h-full"
            key="content"
          >
            <div>
              <div className="text-2xl py-2">媒体文件统计</div>
              <div>
                当前共有 {result.totalFiles.toLocaleString()} 个媒体文件
                {result.totalFiles > 0 &&
                  (() => {
                    const parts = [
                      result.typeDistribution.length > 0 &&
                        `涵盖 ${result.typeDistribution.length} 种类型`,
                      result.totalSize > 0 &&
                        `总大小 ${formatFileSize(result.totalSize)}`,
                    ].filter(Boolean);
                    return parts.length > 0 ? `，${parts.join("、")}` : "";
                  })()}
                。
              </div>
            </div>
            <div>
              <div className="space-y-2">
                {result.recentStats.last7Days > 0 ||
                result.recentStats.last30Days > 0 ||
                result.averageDailyNew > 0 ? (
                  <div>
                    {(() => {
                      const parts: string[] = [];
                      if (result.recentStats.last7Days > 0) {
                        parts.push(
                          `最近一周新增了 ${result.recentStats.last7Days} 个文件`,
                        );
                      }
                      if (
                        result.recentStats.last30Days >
                        result.recentStats.last7Days
                      ) {
                        parts.push(
                          `本月共新增 ${result.recentStats.last30Days} 个文件`,
                        );
                      } else if (
                        result.recentStats.last30Days > 0 &&
                        result.recentStats.last7Days === 0
                      ) {
                        parts.push(
                          `本月新增了 ${result.recentStats.last30Days} 个文件`,
                        );
                      }
                      if (result.averageDailyNew > 0) {
                        parts.push(`日均新增 ${result.averageDailyNew} 个文件`);
                      }
                      return parts.length > 0
                        ? parts.join("，") + "。"
                        : "近期没有新增文件。";
                    })()}
                  </div>
                ) : (
                  <div>近期没有新增文件。</div>
                )}

                {result.typeDistribution.length > 0 && (
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
                )}

                {result.totalFiles === 0 && (
                  <div className="text-muted-foreground">
                    暂无媒体文件数据。
                  </div>
                )}
              </div>
            </div>
            <div>
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
          <div className="px-10 h-full" key="error">
            <ErrorPage reason={error} reset={() => fetchData(true)} />
          </div>
        ) : (
          <div className="h-full">
            <LoadingIndicator key="loading" />
          </div>
        )}
      </AutoTransition>
    </GridItem>
  );
}
