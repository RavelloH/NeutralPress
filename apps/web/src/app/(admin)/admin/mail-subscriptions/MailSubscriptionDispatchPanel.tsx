"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiDeleteBinLine,
  RiRefreshLine,
  RiSendPlane2Line,
} from "@remixicon/react";

import {
  cleanupInvalidMailSubscriptions,
  dispatchLatestPostMail,
} from "@/actions/mail-subscription";
import {
  MAIL_SUBSCRIPTIONS_REFRESH_EVENT,
  type MailSubscriptionsRefreshMessage,
} from "@/app/(admin)/admin/mail-subscriptions/constants";
import DimensionStatsChart, {
  type DimensionStatsItem,
} from "@/components/client/charts/DimensionStatsChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import { useMainColor } from "@/components/client/layout/ThemeProvider";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import {
  getLatestMailDispatchOverview,
  getMailSubscriptionStatusDistribution,
} from "@/lib/client/api/mail-subscription-read";
import generateComplementary from "@/lib/shared/complementary";
import generateGradient from "@/lib/shared/gradient";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";

interface DispatchSessionStats {
  processed: number;
  sent: number;
  failed: number;
}

interface FailureItem {
  subscriptionId: number;
  email: string;
  reason: string;
}

interface DispatchStepResult {
  continue: boolean;
  hasMore: boolean;
  processed: number;
  sent: number;
  failed: number;
  remainingAfter: number;
}

type StatusDistributionItem = {
  status: "PENDING_VERIFY" | "ACTIVE" | "UNSUBSCRIBED";
  count: number;
  percentage: number;
};

export default function MailSubscriptionDispatchPanel() {
  const toast = useToast();
  const mainColor = useMainColor().primary;
  const runningRef = useRef(false);
  const cursorRef = useRef(0);
  const dispatchToastIdRef = useRef<string | null>(null);
  const [controlDialogOpen, setControlDialogOpen] = useState(false);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDistribution, setLoadingDistribution] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [cleaningInvalid, setCleaningInvalid] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [overviewUpdatedAt, setOverviewUpdatedAt] = useState<Date | null>(null);
  const [batchSizeText, setBatchSizeText] = useState("1");
  const [activePostId, setActivePostId] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState("");
  const [runtimePending, setRuntimePending] = useState<number | null>(null);
  const [sessionStats, setSessionStats] = useState<DispatchSessionStats>({
    processed: 0,
    sent: 0,
    failed: 0,
  });
  const [failures, setFailures] = useState<FailureItem[]>([]);
  const [distribution, setDistribution] = useState<StatusDistributionItem[]>(
    [],
  );
  const [distributionError, setDistributionError] = useState<Error | null>(
    null,
  );
  const [overviewError, setOverviewError] = useState<Error | null>(null);
  const [overview, setOverview] = useState<{
    latestPost: {
      id: number;
      title: string;
      slug: string;
      publishedAt: string | null;
    } | null;
    totalActive: number;
    pendingTotal: number;
  } | null>(null);
  const { broadcast } = useBroadcastSender<MailSubscriptionsRefreshMessage>();

  const parsedBatchSize = Math.max(
    1,
    Math.min(50, Number.parseInt(batchSizeText || "1", 10) || 1),
  );

  const refreshOverview = useCallback(async () => {
    setLoadingOverview(true);
    setLoadingDistribution(true);
    setOverviewError(null);
    try {
      const [overviewResult, distributionResult] = await Promise.all([
        getLatestMailDispatchOverview(),
        getMailSubscriptionStatusDistribution(),
      ]);

      if (!overviewResult.success || !overviewResult.data) {
        setOverviewError(
          new Error(overviewResult.message || "读取发送概览失败"),
        );
        toast.error(overviewResult.message || "读取发送概览失败");
      } else {
        const overviewData = overviewResult.data;
        setOverview(overviewData);
        setRuntimePending(null);
        setActivePostId(overviewData.latestPost?.id || null);
        setOverviewUpdatedAt(new Date());
      }

      if (!distributionResult.success || !distributionResult.data) {
        setDistribution([]);
        setDistributionError(
          new Error(distributionResult.message || "读取状态占比失败"),
        );
      } else {
        setDistribution(distributionResult.data as StatusDistributionItem[]);
        setDistributionError(null);
      }
    } catch (error) {
      console.error(error);
      setOverviewError(new Error("读取发送概览失败"));
      toast.error("读取发送概览失败");
      setDistribution([]);
      setDistributionError(new Error("读取状态占比失败"));
    } finally {
      setLoadingOverview(false);
      setLoadingDistribution(false);
    }
  }, [toast]);

  const broadcastRefresh = useCallback(async () => {
    await broadcast({
      type: MAIL_SUBSCRIPTIONS_REFRESH_EVENT,
      source: "dispatch-panel",
    });
  }, [broadcast]);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  useBroadcast<MailSubscriptionsRefreshMessage>((message) => {
    if (
      message.type === MAIL_SUBSCRIPTIONS_REFRESH_EVENT &&
      message.source !== "dispatch-panel"
    ) {
      void refreshOverview();
    }
  });

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (dispatchToastIdRef.current) {
        toast.dismiss(dispatchToastIdRef.current);
        dispatchToastIdRef.current = null;
      }
    };
  }, [toast]);

  const resetSession = useCallback(() => {
    cursorRef.current = 0;
    const nextStats = {
      processed: 0,
      sent: 0,
      failed: 0,
    };
    setSessionStats(nextStats);
    setFailures([]);
    setLastMessage("");
    setRuntimePending(null);
    const nextActivePostId = overview?.latestPost?.id || null;
    setActivePostId(nextActivePostId);
  }, [overview?.latestPost?.id]);

  const processOnce = useCallback(async (): Promise<DispatchStepResult> => {
    const currentCursor = cursorRef.current;

    if (!overview?.latestPost) {
      toast.error("当前没有可发送的最新文章");
      return {
        continue: false,
        hasMore: false,
        processed: 0,
        sent: 0,
        failed: 0,
        remainingAfter: 0,
      };
    }

    const result = await dispatchLatestPostMail({
      cursorId: currentCursor,
      batchSize: parsedBatchSize,
      expectedLatestPostId: activePostId || overview.latestPost.id,
    });

    if (!result.success || !result.data) {
      setLastMessage(result.message || "发送失败");
      toast.error(result.message || "发送失败");
      return {
        continue: false,
        hasMore: false,
        processed: 0,
        sent: 0,
        failed: 0,
        remainingAfter: 0,
      };
    }

    const data = result.data;
    setActivePostId(data.latestPost.id);
    cursorRef.current = data.nextCursor;
    setRuntimePending(data.remainingAfter);
    setLastMessage(result.message || "发送完成");

    setSessionStats((prev) => {
      return {
        processed: prev.processed + data.processed,
        sent: prev.sent + data.sent,
        failed: prev.failed + data.failed,
      };
    });

    if (data.failures.length > 0) {
      setFailures(
        (prev) => [...data.failures, ...prev].slice(0, 30) as FailureItem[],
      );
    }

    if (!data.hasMore) {
      cursorRef.current = 0;
    }

    return {
      continue: true,
      hasMore: data.hasMore,
      processed: data.processed,
      sent: data.sent,
      failed: data.failed,
      remainingAfter: data.remainingAfter,
    };
  }, [activePostId, overview?.latestPost, parsedBatchSize, toast]);

  const updateDispatchProgressToast = useCallback(
    (
      title: string,
      message: string,
      type?: "success" | "error" | "warning" | "info",
      progress?: number,
    ) => {
      if (!dispatchToastIdRef.current) {
        dispatchToastIdRef.current = toast.info(title, message, 0);
      }
      if (dispatchToastIdRef.current) {
        toast.update(
          dispatchToastIdRef.current,
          title,
          message,
          type,
          progress,
        );
      }
    },
    [toast],
  );

  const handleRun = useCallback(async () => {
    if (runningRef.current) {
      return;
    }

    if (!overview?.latestPost) {
      toast.error("当前没有可发送的最新文章");
      return;
    }

    runningRef.current = true;
    setIsRunning(true);
    setProcessing(true);

    let completed = false;
    let interrupted = false;
    let hasError = false;
    let processedTotal = 0;
    let totalToSend = Math.max(runtimePending ?? overview.pendingTotal, 0);

    updateDispatchProgressToast(
      "正在发送邮件",
      "请勿离开此页面",
      undefined,
      totalToSend > 0 ? 0 : undefined,
    );

    try {
      while (runningRef.current) {
        const step = await processOnce();
        if (!step.continue) {
          hasError = true;
          break;
        }

        processedTotal += step.processed;
        totalToSend = Math.max(
          totalToSend,
          processedTotal + step.remainingAfter,
        );

        const denominator = totalToSend > 0 ? totalToSend : processedTotal;
        const progress =
          denominator > 0
            ? Math.round((processedTotal / denominator) * 100)
            : undefined;

        updateDispatchProgressToast(
          "正在发送邮件",
          "请勿离开此页面",
          undefined,
          step.hasMore
            ? progress !== undefined
              ? Math.min(progress, 99)
              : undefined
            : 100,
        );

        if (!step.hasMore) {
          completed = true;
          break;
        }
      }
      if (!completed && !hasError && !runningRef.current) {
        interrupted = true;
      }
    } catch (error) {
      console.error(error);
      toast.error("连续发送中断，请稍后重试");
      hasError = true;
    } finally {
      runningRef.current = false;
      setIsRunning(false);
      setProcessing(false);

      const denominator = totalToSend > 0 ? totalToSend : processedTotal;
      const progress =
        denominator > 0 ? Math.round((processedTotal / denominator) * 100) : 0;

      if (completed) {
        updateDispatchProgressToast(
          "邮件发送完成",
          "发送任务已完成",
          "success",
          100,
        );
      } else if (interrupted) {
        updateDispatchProgressToast(
          "邮件发送已暂停",
          "你可以稍后继续",
          "warning",
          progress,
        );
      } else if (hasError) {
        updateDispatchProgressToast(
          "邮件发送中断",
          "请稍后重试",
          "error",
          progress || undefined,
        );
      }

      const currentToastId = dispatchToastIdRef.current;
      if (currentToastId) {
        setTimeout(
          () => {
            if (dispatchToastIdRef.current === currentToastId) {
              toast.dismiss(currentToastId);
              dispatchToastIdRef.current = null;
            }
          },
          completed ? 2200 : 3200,
        );
      }

      await refreshOverview();
      if (processedTotal > 0) {
        await broadcastRefresh();
      }
    }
  }, [
    broadcastRefresh,
    overview?.latestPost,
    overview?.pendingTotal,
    processOnce,
    refreshOverview,
    runtimePending,
    toast,
    updateDispatchProgressToast,
  ]);

  const handlePause = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  const handleCleanupInvalid = useCallback(async () => {
    if (isRunning || processing) {
      toast.error("正在发送中，请先暂停后再清理");
      return;
    }

    setCleaningInvalid(true);
    try {
      const result = await cleanupInvalidMailSubscriptions();
      if (!result.success || !result.data) {
        toast.error(result.message || "清理失效订阅失败");
        return;
      }
      const deletedCount = result.data.deleted || 0;
      toast.success(result.message || `已清理 ${deletedCount} 条失效订阅`);
      await refreshOverview();
      if (deletedCount > 0) {
        await broadcastRefresh();
      }
    } catch (error) {
      console.error(error);
      toast.error("清理失效订阅失败");
    } finally {
      setCleaningInvalid(false);
    }
  }, [broadcastRefresh, isRunning, processing, refreshOverview, toast]);

  const handleConfirmCleanup = useCallback(async () => {
    await handleCleanupInvalid();
    setCleanupDialogOpen(false);
  }, [handleCleanupInvalid]);

  const distributionItems: DimensionStatsItem[] = useMemo(
    () =>
      distribution.map((item) => ({
        name:
          item.status === "ACTIVE"
            ? "生效订阅"
            : item.status === "PENDING_VERIFY"
              ? "待验证"
              : "已退订",
        count: item.count,
        percentage: item.percentage,
      })),
    [distribution],
  );

  const distributionColors = useMemo(
    () =>
      generateGradient(
        mainColor,
        generateComplementary(mainColor),
        Math.max(distributionItems.length, 2),
      ),
    [distributionItems.length, mainColor],
  );

  const pendingForView = runtimePending ?? overview?.pendingTotal ?? 0;

  return (
    <>
      <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {loadingOverview && !overview ? (
            <div className="h-full" key="overview-loading">
              <LoadingIndicator />
            </div>
          ) : overviewError && !overview ? (
            <div className="h-full px-10" key="overview-error">
              <ErrorPage
                reason={overviewError}
                reset={() => {
                  void refreshOverview();
                }}
              />
            </div>
          ) : (
            <div className="flex h-full flex-col justify-between p-10">
              <div>
                <div className="py-2 text-2xl">邮件订阅分发</div>
                <AutoResizer duration={0.24}>
                  <div className="space-y-1">
                    <div>
                      {overview?.latestPost
                        ? `最新文章《${overview.latestPost.title}》(#${overview.latestPost.id})`
                        : "当前暂无可发送的已发布文章"}
                      。
                    </div>
                    <div>活跃订阅 {overview?.totalActive ?? 0} 条。</div>
                    {overviewError && (
                      <div className="text-warning text-sm">
                        最近一次刷新失败，当前展示的是上次成功数据。
                      </div>
                    )}
                  </div>
                </AutoResizer>
              </div>
              <div className="inline-flex items-center gap-2">
                {overviewUpdatedAt
                  ? `最近更新于 ${overviewUpdatedAt.toLocaleString("zh-CN")}`
                  : "等待首次加载"}
                <Clickable onClick={() => void refreshOverview()}>
                  <RiRefreshLine size="1em" />
                </Clickable>
              </div>
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <GridItem areas={[5, 6]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={() => setControlDialogOpen(true)}
            className="inline-flex h-full w-full cursor-pointer items-center justify-center gap-3 text-2xl transition-all hover:bg-primary hover:text-primary-foreground"
          >
            <RiSendPlane2Line size="1.1em" />
            <span>打开发送控制台</span>
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={() => setCleanupDialogOpen(true)}
            className="inline-flex h-full w-full cursor-pointer items-center justify-center gap-3 text-2xl transition-all hover:bg-primary hover:text-primary-foreground"
            disabled={
              loadingOverview || processing || cleaningInvalid || isRunning
            }
          >
            <RiDeleteBinLine size="1.1em" />
            <span>{cleaningInvalid ? "清理中..." : "清理失效订阅"}</span>
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem
        areas={[9, 10, 11, 12]}
        width={3}
        height={0.8}
        className="py-10"
        fixedHeight
      >
        <AutoTransition type="slideUp" className="h-full">
          {loadingDistribution ? (
            <LoadingIndicator key="loading-distribution" />
          ) : distributionError ? (
            <div key="distribution-error" className="h-full px-10">
              <ErrorPage
                reason={distributionError}
                reset={() => {
                  void refreshOverview();
                }}
              />
            </div>
          ) : (
            <div
              key="distribution-content"
              className="flex h-full flex-col px-10"
            >
              <DimensionStatsChart
                title="订阅状态占比"
                items={distributionItems}
                colors={distributionColors}
              />
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <Dialog
        open={controlDialogOpen}
        onClose={() => setControlDialogOpen(false)}
        title="邮件发送控制台"
        size="lg"
      >
        <div className="space-y-6 px-6 py-6">
          <p className="text-sm text-muted-foreground">
            将当前最新文章发送给订阅用户。发送过程中，请勿关闭此页面。
          </p>

          <div className="grid grid-cols-1 gap-4">
            <Input
              label="批次大小"
              type="number"
              size="sm"
              value={batchSizeText}
              onChange={(event) => setBatchSizeText(event.target.value)}
              helperText="1-50，建议 1-10"
            />
          </div>

          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              <Button
                label={isRunning ? "发送中..." : "开始自动发送"}
                size="sm"
                variant="primary"
                onClick={handleRun}
                disabled={isRunning || processing || !overview?.latestPost}
              />
              <Button
                label="暂停"
                size="sm"
                variant="ghost"
                onClick={handlePause}
                disabled={!isRunning}
              />
            </div>
            <div className="flex gap-2">
              <Button
                label="刷新概览"
                size="sm"
                variant="secondary"
                onClick={() => void refreshOverview()}
                disabled={loadingOverview || processing}
              />
              <Button
                label="重置会话"
                size="sm"
                variant="danger"
                onClick={resetSession}
                disabled={processing}
              />
            </div>
          </div>

          <AutoResizer duration={0.24}>
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                本次会话统计
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">处理</label>
                  <p className="text-sm font-mono">{sessionStats.processed}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">成功</label>
                  <p className="text-sm font-mono">{sessionStats.sent}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">失败</label>
                  <p className="text-sm font-mono">{sessionStats.failed}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">批次</label>
                  <p className="text-sm font-mono">{parsedBatchSize}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    待发送
                  </label>
                  <p className="text-sm font-mono">{pendingForView}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border py-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    当前目标文章
                  </label>
                  <p className="text-sm">
                    {overview?.latestPost
                      ? `${overview.latestPost.title} (#${overview.latestPost.id})`
                      : "暂无"}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    最近结果
                  </label>
                  <p className="text-sm font-mono">{lastMessage || "暂无"}</p>
                </div>
              </div>
            </div>
          </AutoResizer>

          <div className="space-y-2">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              失败记录
            </h3>
            <AutoResizer duration={0.24}>
              <AutoTransition type="fade" duration={0.2} initial={false}>
                {failures.length === 0 ? (
                  <p
                    key="failure-empty"
                    className="text-sm text-muted-foreground"
                  >
                    暂无失败记录
                  </p>
                ) : (
                  <div key="failure-list">
                    {failures.map((item, index) => (
                      <div
                        key={`${item.subscriptionId}-${index}`}
                        className="grid grid-cols-1 md:grid-cols-4 gap-3 py-2 text-sm"
                      >
                        <div>
                          <label className="text-sm text-muted-foreground">
                            订阅 ID
                          </label>
                          <p className="font-mono">#{item.subscriptionId}</p>
                        </div>
                        <div>
                          <label className="text-sm text-muted-foreground">
                            邮箱
                          </label>
                          <p className="font-mono">{item.email}</p>
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-sm text-muted-foreground">
                            失败原因
                          </label>
                          <p>{item.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </AutoTransition>
            </AutoResizer>
          </div>
        </div>
      </Dialog>

      <AlertDialog
        open={cleanupDialogOpen}
        onClose={() => setCleanupDialogOpen(false)}
        onConfirm={() => {
          void handleConfirmCleanup();
        }}
        title="确认清理失效订阅"
        description="将删除所有待验证且校验 token 缺失或已过期的订阅记录。该操作不可撤销。"
        confirmText="确认清理"
        cancelText="取消"
        variant="warning"
        loading={cleaningInvalid}
      />
    </>
  );
}
