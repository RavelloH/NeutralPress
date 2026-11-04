"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RiPlayCircleLine,
  RiRefreshLine,
  RiSettings4Line,
} from "@remixicon/react";
import type { CronConfig, CronHistoryItem } from "@repo/shared-types/api/cron";

import { triggerCron, updateCronConfig } from "@/actions/cron";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getCronConfig } from "@/lib/client/api/cron-config-read";
import { getCronHistory } from "@/lib/client/api/cron-history";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Select } from "@/ui/Select";
import { Switch } from "@/ui/Switch";
import { useToast } from "@/ui/Toast";

const TRIGGER_TYPE_LABELS: Record<CronHistoryItem["triggerType"], string> = {
  MANUAL: "手动触发",
  CLOUD: "云端触发",
  AUTO: "自动触发",
};

const STATUS_LABELS: Record<CronHistoryItem["status"], string> = {
  OK: "成功",
  PARTIAL: "部分成功",
  ERROR: "失败",
};

const CLEANUP_FIELD_CONFIG: Array<{
  key: keyof CronConfig["cleanup"];
  label: string;
  helperText: string;
}> = [
  {
    key: "searchLogRetentionDays",
    label: "搜索日志保留天数",
    helperText: "按 createdAt 清理",
  },
  {
    key: "healthCheckRetentionDays",
    label: "运行状况检查日志保留天数",
    helperText: "按 createdAt 清理",
  },
  {
    key: "auditLogRetentionDays",
    label: "审计日志保留天数",
    helperText: "按 timestamp 清理",
  },
  {
    key: "cronHistoryRetentionDays",
    label: "计划任务日志保留天数",
    helperText: "按 createdAt 清理",
  },
  {
    key: "cloudTriggerHistoryRetentionDays",
    label: "云触发日志保留天数",
    helperText: "按 createdAt 清理",
  },
  {
    key: "noticeRetentionDays",
    label: "通知保留天数",
    helperText: "按 createdAt 清理",
  },
  {
    key: "recycleBinRetentionDays",
    label: "回收站保留天数",
    helperText: "按 deletedAt 清理",
  },
  {
    key: "mailSubscriptionUnsubscribedRetentionDays",
    label: "已退订订阅保留天数",
    helperText: "按 unsubscribedAt 清理",
  },
  {
    key: "refreshTokenExpiredRetentionDays",
    label: "过期 RefreshToken 保留天数",
    helperText: "0 表示过期即清理",
  },
  {
    key: "passwordResetRetentionMinutes",
    label: "密码重置记录保留分钟",
    helperText: "按 createdAt 清理",
  },
  {
    key: "pushSubscriptionMarkInactiveDays",
    label: "不活跃 Web Push 标记天数",
    helperText: "按 lastUsedAt 标记",
  },
  {
    key: "pushSubscriptionDeleteInactiveDays",
    label: "不活跃 Web Push 保留天数",
    helperText: "按 lastUsedAt 删除",
  },
  {
    key: "pushSubscriptionDeleteDisabledUserDays",
    label: "被用户禁用的 Web Push 保留天数",
    helperText: "按 lastUsedAt 删除",
  },
];

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildSummary(
  config: CronConfig,
  latest: CronHistoryItem | null,
): string[] {
  const lines: string[] = [];
  lines.push(`计划任务总开关：${config.enabled ? "已开启" : "已关闭"}。`);

  if (!latest) {
    lines.push("暂无执行历史。");
    return lines;
  }

  lines.push(
    `最近执行于 ${formatDateTime(latest.createdAt)}（${TRIGGER_TYPE_LABELS[latest.triggerType]}），状态：${STATUS_LABELS[latest.status]}。`,
  );
  lines.push(
    `本次耗时 ${latest.durationMs}ms，启用 ${latest.enabledCount} 项，成功 ${latest.successCount} 项，失败 ${latest.failedCount} 项，跳过 ${latest.skippedCount} 项。`,
  );
  return lines;
}

export default function CronReport() {
  const toast = useToast();
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const [config, setConfig] = useState<CronConfig | null>(null);
  const [latestRecord, setLatestRecord] = useState<CronHistoryItem | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);

  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftDoctorEnabled, setDraftDoctorEnabled] = useState(true);
  const [draftProjectsEnabled, setDraftProjectsEnabled] = useState(true);
  const [draftFriendsEnabled, setDraftFriendsEnabled] = useState(true);
  const [draftCleanupEnabled, setDraftCleanupEnabled] = useState(true);
  const [draftAnalyticsEnabled, setDraftAnalyticsEnabled] = useState(true);
  const [draftCleanupConfig, setDraftCleanupConfig] = useState<
    CronConfig["cleanup"] | null
  >(null);
  const [draftAnalyticsReportMode, setDraftAnalyticsReportMode] =
    useState<CronConfig["analytics"]["report"]["mode"]>("NONE");
  const [
    draftAnalyticsReportDailyEnabled,
    setDraftAnalyticsReportDailyEnabled,
  ] = useState(false);
  const [
    draftAnalyticsReportWeeklyEnabled,
    setDraftAnalyticsReportWeeklyEnabled,
  ] = useState(false);
  const [
    draftAnalyticsReportMonthlyEnabled,
    setDraftAnalyticsReportMonthlyEnabled,
  ] = useState(false);
  const [
    draftAnalyticsNotifyAdminUidsText,
    setDraftAnalyticsNotifyAdminUidsText,
  ] = useState("");

  const fetchData = useCallback(
    async (forceRefresh: boolean) => {
      if (forceRefresh) {
        setConfig(null);
        setLatestRecord(null);
      }

      setError(null);
      try {
        const [configResult, historyResult] = await Promise.all([
          getCronConfig(),
          getCronHistory({
            page: 1,
            pageSize: 1,
            sortBy: "createdAt",
            sortOrder: "desc",
          }),
        ]);

        if (!configResult.success || !configResult.data) {
          setError(new Error(configResult.message || "获取计划任务配置失败"));
          return;
        }

        setConfig(configResult.data);

        if (
          historyResult.success &&
          historyResult.data &&
          historyResult.data.length > 0
        ) {
          setLatestRecord(historyResult.data[0] ?? null);
        } else {
          setLatestRecord(null);
        }

        if (forceRefresh) {
          await broadcast({ type: "cron-refresh" });
        }
      } catch (fetchError) {
        console.error("[CronReport] 获取数据失败:", fetchError);
        setError(new Error("获取计划任务数据失败"));
      }
    },
    [broadcast],
  );

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "cron-refresh") {
      void fetchData(false);
    }
  });

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const openManageDialog = useCallback(() => {
    if (!config) return;
    setDraftEnabled(config.enabled);
    setDraftDoctorEnabled(config.tasks.doctor);
    setDraftProjectsEnabled(config.tasks.projects);
    setDraftFriendsEnabled(config.tasks.friends);
    setDraftCleanupEnabled(config.tasks.cleanup);
    setDraftAnalyticsEnabled(config.tasks.analytics);
    setDraftCleanupConfig(config.cleanup);
    setDraftAnalyticsReportMode(config.analytics.report.mode);
    setDraftAnalyticsReportDailyEnabled(config.analytics.report.dailyEnabled);
    setDraftAnalyticsReportWeeklyEnabled(config.analytics.report.weeklyEnabled);
    setDraftAnalyticsReportMonthlyEnabled(
      config.analytics.report.monthlyEnabled,
    );
    setDraftAnalyticsNotifyAdminUidsText(
      config.analytics.report.notifyAdminUids.join("\n"),
    );
    setManageDialogOpen(true);
  }, [config]);

  const handleCleanupConfigChange = useCallback(
    (key: keyof CronConfig["cleanup"], value: string) => {
      const nextValue = Number.parseInt(value, 10);
      setDraftCleanupConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [key]:
            Number.isFinite(nextValue) && nextValue >= 0
              ? nextValue
              : prev[key],
        };
      });
    },
    [],
  );

  const parseUidTextToArray = useCallback((value: string): string[] => {
    const lines = value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0 && /^\d+$/.test(item));
    return Array.from(new Set(lines));
  }, []);

  const handleSaveConfig = useCallback(async () => {
    if (!draftCleanupConfig) {
      toast.error("自动清理配置尚未准备就绪");
      return;
    }

    setSavingConfig(true);
    try {
      const result = await updateCronConfig({
        enabled: draftEnabled,
        doctor: draftDoctorEnabled,
        projects: draftProjectsEnabled,
        friends: draftFriendsEnabled,
        cleanup: draftCleanupEnabled,
        analytics: draftAnalyticsEnabled,
        analyticsReportMode: draftAnalyticsReportMode,
        analyticsReportDailyEnabled: draftAnalyticsReportDailyEnabled,
        analyticsReportWeeklyEnabled: draftAnalyticsReportWeeklyEnabled,
        analyticsReportMonthlyEnabled: draftAnalyticsReportMonthlyEnabled,
        analyticsReportNotifyAdminUids: parseUidTextToArray(
          draftAnalyticsNotifyAdminUidsText,
        ),
        ...draftCleanupConfig,
      });

      if (!result.success || !result.data) {
        toast.error(result.message || "保存计划任务配置失败");
        return;
      }

      toast.success("计划任务配置已更新");
      setManageDialogOpen(false);
      await fetchData(true);
    } catch (saveError) {
      console.error("[CronReport] 保存配置失败:", saveError);
      toast.error("保存计划任务配置失败");
    } finally {
      setSavingConfig(false);
    }
  }, [
    draftAnalyticsEnabled,
    draftAnalyticsNotifyAdminUidsText,
    draftAnalyticsReportDailyEnabled,
    draftAnalyticsReportMode,
    draftAnalyticsReportMonthlyEnabled,
    draftAnalyticsReportWeeklyEnabled,
    draftDoctorEnabled,
    draftCleanupConfig,
    draftCleanupEnabled,
    draftEnabled,
    draftFriendsEnabled,
    draftProjectsEnabled,
    fetchData,
    parseUidTextToArray,
    toast,
  ]);

  const handleManualTrigger = useCallback(async () => {
    setTriggering(true);
    try {
      const result = await triggerCron({ triggerType: "MANUAL" });
      if (!result.success || !result.data) {
        toast.error(result.message || "触发计划任务失败");
        return;
      }

      const statusLabel = STATUS_LABELS[result.data.status];
      toast.success(
        `触发完成：${statusLabel}（成功 ${result.data.successCount}，失败 ${result.data.failedCount}，跳过 ${result.data.skippedCount}）`,
      );
      setManualDialogOpen(false);
      await fetchData(true);
    } catch (triggerError) {
      console.error("[CronReport] 手动触发失败:", triggerError);
      toast.error("手动触发失败，请稍后重试");
    } finally {
      setTriggering(false);
    }
  }, [fetchData, toast]);

  return (
    <>
      <GridItem areas={[1, 2, 3, 4]} width={3} height={0.5}>
        <AutoTransition type="scale" className="h-full">
          {config ? (
            <div
              className="flex h-full flex-col justify-between p-10"
              key="cron-report"
            >
              <div>
                <div className="py-2 text-2xl">计划任务</div>
                <div className="space-y-1">
                  {buildSummary(config, latestRecord).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                最近刷新于:{" "}
                {formatDateTime(
                  latestRecord?.createdAt ||
                    config.updatedAt ||
                    new Date().toISOString(),
                )}
                <Clickable onClick={() => void fetchData(true)}>
                  <RiRefreshLine size="1em" />
                </Clickable>
              </div>
            </div>
          ) : error ? (
            <div className="h-full px-10" key="error">
              <ErrorPage reason={error} reset={() => void fetchData(true)} />
            </div>
          ) : (
            <div className="h-full" key="loading">
              <LoadingIndicator />
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <GridItem areas={[5, 6]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
            onClick={openManageDialog}
          >
            <RiSettings4Line size="1.1em" />
            管理计划任务
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
            onClick={() => setManualDialogOpen(true)}
          >
            <RiPlayCircleLine size="1.1em" />
            手动触发
          </button>
        </AutoTransition>
      </GridItem>

      <AlertDialog
        open={manualDialogOpen}
        onClose={() => setManualDialogOpen(false)}
        onConfirm={() => void handleManualTrigger()}
        title="确认手动触发"
        description="将立刻触发一次计划任务执行，是否继续？"
        confirmText="立即触发"
        cancelText="取消"
        variant="info"
        loading={triggering}
      />

      <Dialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
        title="计划任务设置"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
            触发设置
          </h3>
          <Switch
            label="启用计划任务"
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={savingConfig}
          />

          <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
            任务管理
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Switch
              label="启用运行状况检查"
              checked={draftDoctorEnabled}
              onCheckedChange={setDraftDoctorEnabled}
              disabled={savingConfig}
            />
            <Switch
              label="启用 Projects 同步"
              checked={draftProjectsEnabled}
              onCheckedChange={setDraftProjectsEnabled}
              disabled={savingConfig}
            />
            <Switch
              label="启用友链检查"
              checked={draftFriendsEnabled}
              onCheckedChange={setDraftFriendsEnabled}
              disabled={savingConfig}
            />
            <Switch
              label="启用自动清理"
              checked={draftCleanupEnabled}
              onCheckedChange={setDraftCleanupEnabled}
              disabled={savingConfig}
            />
            <Switch
              label="启用访问统计整理"
              checked={draftAnalyticsEnabled}
              onCheckedChange={setDraftAnalyticsEnabled}
              disabled={savingConfig}
            />
          </div>

          <div>
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              自动清理配置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {CLEANUP_FIELD_CONFIG.map((item) => (
                <Input
                  key={item.key}
                  type="number"
                  label={item.label}
                  helperText={item.helperText}
                  min={0}
                  size="sm"
                  value={draftCleanupConfig?.[item.key] ?? 0}
                  onChange={(event) =>
                    handleCleanupConfigChange(item.key, event.target.value)
                  }
                  disabled={
                    savingConfig || !draftCleanupEnabled || !draftCleanupConfig
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              访问统计整理报告配置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="flex flex-col gap-2 col-span-2">
                <label className="text-sm text-muted-foreground">
                  报告发送方式
                </label>
                <Select
                  value={draftAnalyticsReportMode}
                  onChange={(value) =>
                    setDraftAnalyticsReportMode(
                      value as CronConfig["analytics"]["report"]["mode"],
                    )
                  }
                  options={[
                    {
                      value: "NOTICE_EMAIL",
                      label: "通知 + 邮件",
                    },
                    {
                      value: "NOTICE",
                      label: "仅通知",
                    },
                    {
                      value: "EMAIL",
                      label: "仅邮件",
                    },
                    {
                      value: "NONE",
                      label: "不发送报告",
                    },
                  ]}
                  size="sm"
                  disabled={savingConfig || !draftAnalyticsEnabled}
                />
              </div>
              <Switch
                label="每日发送昨日报告"
                checked={draftAnalyticsReportDailyEnabled}
                onCheckedChange={setDraftAnalyticsReportDailyEnabled}
                disabled={savingConfig || !draftAnalyticsEnabled}
              />
              <Switch
                label="每周一发送上周报告"
                checked={draftAnalyticsReportWeeklyEnabled}
                onCheckedChange={setDraftAnalyticsReportWeeklyEnabled}
                disabled={savingConfig || !draftAnalyticsEnabled}
              />
              <Switch
                label="每月 1 日发送上月报告"
                checked={draftAnalyticsReportMonthlyEnabled}
                onCheckedChange={setDraftAnalyticsReportMonthlyEnabled}
                disabled={savingConfig || !draftAnalyticsEnabled}
              />
              <div className="md:col-span-2">
                <Input
                  label="接收管理员 UID"
                  helperText="每行或逗号分隔一个 UID。留空则发送给所有 ADMIN/EDITOR。"
                  rows={4}
                  size="sm"
                  value={draftAnalyticsNotifyAdminUidsText}
                  onChange={(event) =>
                    setDraftAnalyticsNotifyAdminUidsText(event.target.value)
                  }
                  disabled={savingConfig || !draftAnalyticsEnabled}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              size="sm"
              disabled={savingConfig}
              onClick={() => setManageDialogOpen(false)}
            />
            <Button
              label="保存配置"
              variant="primary"
              size="sm"
              loading={savingConfig}
              disabled={!draftCleanupConfig}
              onClick={() => void handleSaveConfig()}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
