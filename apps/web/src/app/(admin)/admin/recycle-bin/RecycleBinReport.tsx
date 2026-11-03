"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiCheckDoubleLine,
  RiDeleteBinLine,
  RiRefreshLine,
} from "@remixicon/react";
import type { RecycleBinStatsData } from "@repo/shared-types/api/recycle-bin";

import {
  clearRecycleBin,
  restoreAllProjectsFromRecycleBin,
} from "@/actions/recycle-bin";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getRecycleBinStats } from "@/lib/client/api/recycle-bin-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

const REFRESH_EVENT = "recycle-bin-refresh";

export default function RecycleBinReport() {
  const toast = useToast();
  const [result, setResult] = useState<RecycleBinStatsData | null>(null);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isRestoringAllProjects, setIsRestoringAllProjects] = useState(false);
  const [isClearingRecycleBin, setIsClearingRecycleBin] = useState(false);
  const [restoreAllDialogOpen, setRestoreAllDialogOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const fetchData = useCallback(
    async (forceRefresh: boolean = false) => {
      if (forceRefresh) {
        setResult(null);
      }
      setError(null);

      const response = await getRecycleBinStats({ force: forceRefresh });
      if (!response.success || !response.data) {
        setError(new Error(response.message || "获取回收站统计失败"));
        return;
      }

      setResult(response.data);
      setRefreshTime(new Date(response.data.updatedAt));

      if (forceRefresh) {
        await broadcast({ type: REFRESH_EVENT });
      }
    },
    [broadcast],
  );

  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === REFRESH_EVENT) {
      await fetchData();
    }
  });

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const typeSummary = useMemo(() => {
    if (!result?.types || result.types.length === 0) {
      return "";
    }
    return [...result.types]
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((item) => `${item.label} ${item.count} 条`)
      .join("、");
  }, [result]);

  const handleRestoreAllProjects = async () => {
    setIsRestoringAllProjects(true);

    try {
      const response = await restoreAllProjectsFromRecycleBin();
      if (!response.success || !response.data) {
        toast.error(response.message || "还原失败，请稍后重试");
        return;
      }

      toast.success(`已还原 ${response.data.restored} 个项目`);
      setRestoreAllDialogOpen(false);
      await fetchData(true);
    } catch (error) {
      console.error("[RecycleBinReport] 恢复全部项目失败:", error);
      toast.error("还原失败，请稍后重试");
    } finally {
      setIsRestoringAllProjects(false);
    }
  };

  const handleClearRecycleBin = async () => {
    setIsClearingRecycleBin(true);

    try {
      const response = await clearRecycleBin();
      if (!response.success || !response.data) {
        toast.error(response.message || "清空失败，请稍后重试");
        return;
      }

      toast.success(`已清空回收站，共删除 ${response.data.deleted} 条记录`);
      setClearDialogOpen(false);
      await fetchData(true);
    } catch (error) {
      console.error("[RecycleBinReport] 清空回收站失败:", error);
      toast.error("清空失败，请稍后重试");
    } finally {
      setIsClearingRecycleBin(false);
    }
  };

  return (
    <>
      <GridItem areas={[1, 2, 3, 4]} width={3} height={0.5}>
        <AutoTransition type="scale" className="h-full">
          {result ? (
            <div className="flex h-full flex-col justify-between p-10">
              <div>
                <div className="py-2 text-2xl">回收站统计</div>
                <div>
                  {typeSummary
                    ? `当前共有 ${result.total} 条已删除记录，类型分布：${typeSummary}。`
                    : "当前无删除记录"}
                </div>
              </div>

              <div className="space-y-2">
                <div>最近 7 天新增删除 {result.recent.last7Days} 条。</div>
                <div>最近 30 天新增删除 {result.recent.last30Days} 条。</div>
              </div>

              {refreshTime && (
                <div className="inline-flex items-center gap-2">
                  最近更新于: {new Date(refreshTime).toLocaleString("zh-CN")}
                  <Clickable onClick={() => fetchData(true)}>
                    <RiRefreshLine size="1em" />
                  </Clickable>
                </div>
              )}
            </div>
          ) : error ? (
            <div className="px-10 h-full">
              <ErrorPage reason={error} reset={() => fetchData(true)} />
            </div>
          ) : (
            <div className="h-full">
              <LoadingIndicator />
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <GridItem areas={[5, 6]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={() => setRestoreAllDialogOpen(true)}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRestoringAllProjects}
          >
            <RiCheckDoubleLine size="1.1em" /> 还原所有项目
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={() => setClearDialogOpen(true)}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isClearingRecycleBin}
          >
            <RiDeleteBinLine size="1.1em" /> 清空回收站
          </button>
        </AutoTransition>
      </GridItem>

      <AlertDialog
        open={restoreAllDialogOpen}
        onClose={() => setRestoreAllDialogOpen(false)}
        onConfirm={handleRestoreAllProjects}
        title="确认还原所有项目"
        description="将恢复当前权限范围内的全部已删除项目。"
        confirmText="还原"
        cancelText="取消"
        variant="info"
        loading={isRestoringAllProjects}
      />

      <AlertDialog
        open={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClearRecycleBin}
        title="确认清空回收站"
        description="此操作会彻底删除当前权限范围内的所有回收站记录，删除后无法恢复。"
        confirmText="清空"
        cancelText="取消"
        variant="danger"
        loading={isClearingRecycleBin}
      />
    </>
  );
}
