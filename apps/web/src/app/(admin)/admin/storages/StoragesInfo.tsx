"use client";

import { useCallback, useEffect, useState } from "react";
import { RiRefreshLine } from "@remixicon/react";

import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getStorageStats } from "@/lib/client/api/stats";
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
    inactive: number;
    default: number;
  };
  byType: Array<{
    type: "LOCAL" | "AWS_S3" | "GITHUB_PAGES" | "VERCEL_BLOB" | "EXTERNAL_URL";
    count: number;
    active: number;
    mediaCount: number;
  }>;
  storage: {
    totalProviders: number;
    activeProviders: number;
    totalMediaFiles: number;
    averageFileSize: number;
  };
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const getTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    LOCAL: "本地存储",
    AWS_S3: "AWS S3",
    GITHUB_PAGES: "GitHub Pages",
    VERCEL_BLOB: "Vercel Blob",
    EXTERNAL_URL: "外部URL",
  };
  return labels[type] || type;
};

const getProvidersSummary = (total: StatsData["total"]) => {
  const parts = [
    total.active > 0 && `${total.active} 个已启用`,
    total.inactive > 0 && `${total.inactive} 个停用中`,
    total.default > 0 && `${total.default} 个默认存储`,
  ].filter(Boolean);
  if (total.total === 0) return "暂无可用的存储提供者。";
  return `当前共有 ${total.total} 个存储提供者，${parts.join("，")}。`;
};

const getTypeSummary = (types: StatsData["byType"]) => {
  if (!types.length) return "暂未添加任何类型的存储提供者。";
  const summaries = types.map((item) => {
    const files =
      item.mediaCount > 0 ? `，保存了 ${item.mediaCount} 个文件` : "";
    const active =
      item.active > 0 && item.active !== item.count
        ? `，其中 ${item.active} 个启用`
        : "";
    return `${getTypeLabel(item.type)}：${item.count} 个${active}${files}`;
  });
  return summaries.join("；");
};

const getMediaSummary = (storage: StatsData["storage"]) => {
  if (storage.totalMediaFiles === 0) return "尚未上传媒体文件。";
  return `媒体库共有 ${storage.totalMediaFiles} 个文件，平均大小 ${formatFileSize(storage.averageFileSize)}。`;
};

export default function StoragesInfo() {
  const [result, setResult] = useState<StatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "storages-refresh" }>();

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);
      const res = await runWithAuth(getStorageStats, { force: forceRefresh });
      if (!res || !("data" in res) || !res.data) {
        setError(new Error("获取存储统计失败"));
        return;
      }
      const data = res.data;
      setResult(data);
      setRefreshTime(new Date(data.updatedAt));

      // 刷新成功后广播消息，通知其他组件同步
      if (forceRefresh) {
        await broadcast({ type: "storages-refresh" });
      }
    },
    [broadcast],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="text-2xl py-2">存储统计</div>
                <div>{getProvidersSummary(result.total)}</div>
              </div>
              <div>
                <div className="space-y-3 leading-relaxed">
                  <div>{getTypeSummary(result.byType)}</div>
                  <div>{getMediaSummary(result.storage)}</div>
                </div>
              </div>
              <div>
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    最近更新: {new Date(refreshTime).toLocaleString()}
                    {result?.cache && " (缓存)"}
                    <Clickable onClick={() => fetchData(true)}>
                      <RiRefreshLine size={"1em"} />
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
    </>
  );
}
