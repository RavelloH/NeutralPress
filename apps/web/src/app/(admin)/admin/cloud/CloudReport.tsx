"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiRefreshLine, RiSettings4Line } from "@remixicon/react";
import {
  CLOUD_RECEIVED_TIMEOUT_MS,
  type CloudConfig,
  type CloudHistoryItem,
  type CloudRemoteStatus,
} from "@repo/shared-types/api/cloud";

import {
  getCloudConfig,
  getCloudHistory,
  getCloudRemoteStatus,
  syncCloudNow,
  updateCloudConfig,
} from "@/actions/cloud";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { formatDateTimeWithSeconds } from "@/lib/shared/date-format";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Switch } from "@/ui/Switch";
import { useToast } from "@/ui/Toast";

const CLOUD_STATUS_LABELS: Record<string, string> = {
  active: "已激活",
  pending_url: "待补全 URL",
  disabled: "已停用",
};

type LocalDisplayStatus = CloudHistoryItem["status"] | "TIMEOUT";

const LOCAL_STATUS_LABELS: Record<LocalDisplayStatus, string> = {
  RECEIVED: "已接收",
  DONE: "已完成",
  ERROR: "执行失败",
  REJECTED: "已拒绝",
  TIMEOUT: "超时",
};

const VERIFY_SOURCE_LABELS: Record<
  NonNullable<CloudHistoryItem["verifySource"]>,
  string
> = {
  DOH: "DoH",
  JWKS: "JWKS",
  NONE: "NONE",
};

function formatRate(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function getLocalDisplayStatus(
  record: Pick<CloudHistoryItem, "status" | "receivedAt">,
): LocalDisplayStatus {
  if (record.status !== "RECEIVED") {
    return record.status;
  }

  const receivedAtMs = new Date(record.receivedAt).getTime();
  if (!Number.isFinite(receivedAtMs)) {
    return "RECEIVED";
  }

  return Date.now() - receivedAtMs >= CLOUD_RECEIVED_TIMEOUT_MS
    ? "TIMEOUT"
    : "RECEIVED";
}

function normalizeHhMm(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function minuteToHhMm(minuteOfDay: number): string {
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  const hourPart = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutePart = String(minute % 60).padStart(2, "0");
  return `${hourPart}:${minutePart}`;
}

function hhMmToMinute(value: string): number {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number.parseInt(hourRaw ?? "0", 10);
  const minute = Number.parseInt(minuteRaw ?? "0", 10);
  return hour * 60 + minute;
}

function utcToLocalHhMm(utcHhMm: string | null | undefined): string | null {
  const normalized = normalizeHhMm(utcHhMm);
  if (!normalized) return null;
  const utcMinute = hhMmToMinute(normalized);
  const offset = new Date().getTimezoneOffset();
  return minuteToHhMm(utcMinute - offset);
}

function localToUtcHhMm(localHhMm: string | null | undefined): string | null {
  const normalized = normalizeHhMm(localHhMm);
  if (!normalized) return null;
  const localMinute = hhMmToMinute(normalized);
  const offset = new Date().getTimezoneOffset();
  return minuteToHhMm(localMinute + offset);
}

function utcMinuteToLocalHhMm(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const utcMinute = ((Math.round(value) % 1440) + 1440) % 1440;
  const offset = new Date().getTimezoneOffset();
  return minuteToHhMm(utcMinute - offset);
}

function getLocalTimezoneLabel(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hourPart = String(Math.floor(absMinutes / 60)).padStart(2, "0");
  const minutePart = String(absMinutes % 60).padStart(2, "0");
  return `UTC${sign}${hourPart}:${minutePart}`;
}

function buildSummary(
  config: CloudConfig,
  remote: CloudRemoteStatus | null,
  latest: CloudHistoryItem | null,
): string[] {
  const timezone = getLocalTimezoneLabel();
  const localScheduleTime = utcToLocalHhMm(config.scheduleTime);
  const lines: string[] = [];
  lines.push(`云端互联总开关：${config.enabled ? "已开启" : "已关闭"}。`);
  lines.push(`实例 ID：${config.siteId || "尚未生成"}。`);
  lines.push(
    `本地计划执行时间（${timezone}）：${localScheduleTime ?? "未设置（云端随机分配）"}。`,
  );

  if (remote?.available) {
    const remoteStatus = remote.status
      ? (CLOUD_STATUS_LABELS[remote.status] ?? remote.status)
      : "未知";
    lines.push(
      `云端状态：${remoteStatus}；事件总数 ${remote.eventsTotal ?? "-"}，成功率 ${formatRate(remote.successRate)}。`,
    );
    if (remote.registeredAt) {
      lines.push(
        `注册时间：${formatDateTimeWithSeconds(remote.registeredAt)}。`,
      );
    }
    const localMinuteSlot = utcMinuteToLocalHhMm(remote.minuteOfDay);
    if (localMinuteSlot) {
      lines.push(`云端当前执行槽位（${timezone}）：${localMinuteSlot}。`);
    }
  } else if (remote?.message) {
    lines.push(`云端状态暂不可用：${remote.message}。`);
  } else {
    lines.push("云端状态暂不可用。");
  }

  if (!latest) {
    lines.push("本地尚无云触发历史记录。");
  } else {
    const latestStatus = getLocalDisplayStatus(latest);
    lines.push(
      `本地最近投递：${formatDateTimeWithSeconds(latest.receivedAt)}，状态 ${LOCAL_STATUS_LABELS[latestStatus]}，验签来源 ${latest.verifySource ? VERIFY_SOURCE_LABELS[latest.verifySource] : "无"}。`,
    );
  }
  return lines;
}

export default function CloudReport() {
  const toast = useToast();
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const [config, setConfig] = useState<CloudConfig | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<CloudRemoteStatus | null>(
    null,
  );
  const [latestRecord, setLatestRecord] = useState<CloudHistoryItem | null>(
    null,
  );
  const [error, setError] = useState<Error | null>(null);

  const [manageDialogOpen, setManageDialogOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [draftEnabled, setDraftEnabled] = useState(true);
  const [draftScheduleTime, setDraftScheduleTime] = useState("");
  const [draftCloudBaseUrl, setDraftCloudBaseUrl] = useState("");
  const [draftDohDomain, setDraftDohDomain] = useState("");
  const [draftJwksUrl, setDraftJwksUrl] = useState("");
  const [draftIssuer, setDraftIssuer] = useState("");
  const [draftAudience, setDraftAudience] = useState("");

  const fetchData = useCallback(
    async (forceRefresh: boolean) => {
      if (forceRefresh) {
        setConfig(null);
        setRemoteStatus(null);
        setLatestRecord(null);
      }

      setError(null);
      try {
        const [configResult, remoteResult, historyResult] = await Promise.all([
          getCloudConfig({}),
          getCloudRemoteStatus({}),
          getCloudHistory({
            page: 1,
            pageSize: 1,
            sortBy: "receivedAt",
            sortOrder: "desc",
          }),
        ]);

        if (!configResult.success || !configResult.data) {
          setError(new Error(configResult.message || "获取云配置失败"));
          return;
        }

        setConfig(configResult.data);
        if (remoteResult.success && remoteResult.data) {
          setRemoteStatus(remoteResult.data);
        } else {
          setRemoteStatus(null);
        }

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
          await broadcast({ type: "cloud-refresh" });
        }
      } catch (fetchError) {
        console.error("[CloudReport] 获取数据失败:", fetchError);
        setError(new Error("获取云端互联数据失败"));
      }
    },
    [broadcast],
  );

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "cloud-refresh") {
      void fetchData(false);
    }
  });

  useEffect(() => {
    void fetchData(false);
  }, [fetchData]);

  const summaryLines = useMemo(() => {
    if (!config) return [];
    return buildSummary(config, remoteStatus, latestRecord);
  }, [config, remoteStatus, latestRecord]);

  const openManageDialog = useCallback(() => {
    if (!config) return;
    setDraftEnabled(config.enabled);
    setDraftScheduleTime(utcToLocalHhMm(config.scheduleTime) ?? "");
    setDraftCloudBaseUrl(config.cloudBaseUrl);
    setDraftDohDomain(config.dohDomain);
    setDraftJwksUrl(config.jwksUrl);
    setDraftIssuer(config.issuer);
    setDraftAudience(config.audience);
    setManageDialogOpen(true);
  }, [config]);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    try {
      const scheduleTimeUtc = localToUtcHhMm(draftScheduleTime) ?? "";
      const result = await updateCloudConfig({
        enabled: draftEnabled,
        scheduleTime: scheduleTimeUtc,
        cloudBaseUrl: draftCloudBaseUrl,
        dohDomain: draftDohDomain,
        jwksUrl: draftJwksUrl,
        issuer: draftIssuer,
        audience: draftAudience,
      });

      if (!result.success || !result.data) {
        toast.error(result.message || "保存云配置失败");
        return;
      }

      const syncResult = await syncCloudNow({});
      if (!syncResult.success || !syncResult.data?.synced) {
        toast.error(
          syncResult.message ||
            syncResult.data?.message ||
            "配置已保存，但同步到云端失败",
        );
      } else {
        toast.success("云端互联配置已更新并同步");
      }

      setManageDialogOpen(false);
      await fetchData(true);
    } catch (saveError) {
      console.error("[CloudReport] 保存配置失败:", saveError);
      toast.error("保存云配置失败");
    } finally {
      setSavingConfig(false);
    }
  }, [
    draftAudience,
    draftCloudBaseUrl,
    draftDohDomain,
    draftEnabled,
    draftIssuer,
    draftJwksUrl,
    draftScheduleTime,
    fetchData,
    toast,
  ]);

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6]} width={2} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {config ? (
            <div
              className="flex h-full flex-col justify-between p-10"
              key="report"
            >
              <div>
                <div className="py-2 text-2xl">云端互联</div>
                <div className="space-y-1">
                  {summaryLines.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                最近刷新于:{" "}
                {formatDateTimeWithSeconds(
                  latestRecord?.receivedAt ||
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

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
            onClick={openManageDialog}
          >
            <RiSettings4Line size="1.1em" />
            管理云端互联
          </button>
        </AutoTransition>
      </GridItem>

      <Dialog
        open={manageDialogOpen}
        onClose={() => setManageDialogOpen(false)}
        title="云端互联设置"
        size="lg"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            云端互联允许 NeutralPress
            实例与中央服务器通信，由中央服务器定时触发实例的定时任务，以便在实例处于
            Serverless 状态时也能执行定时任务。
          </p>
          <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
            基础开关
          </h3>
          <Switch
            label="启用 NeutralPress Cloud"
            checked={draftEnabled}
            onCheckedChange={setDraftEnabled}
            disabled={savingConfig}
          />
          <Input
            size="sm"
            type="time"
            step={60}
            label={`执行时间（本地 ${getLocalTimezoneLabel()}）`}
            value={draftScheduleTime}
            onChange={(event) => setDraftScheduleTime(event.target.value)}
            disabled={savingConfig}
          />
          <p className="text-sm text-muted-foreground">
            留空则由云端随机分配执行分钟。不能保证每次都在同一时间执行，中央服务器负载较高时，可能会延后执行时间以平衡负载。
          </p>
          <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
            连接配置
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              size="sm"
              label="Cloud Base URL"
              value={draftCloudBaseUrl}
              onChange={(event) => setDraftCloudBaseUrl(event.target.value)}
              disabled={savingConfig}
            />
            <Input
              size="sm"
              label="DoH Domain"
              value={draftDohDomain}
              onChange={(event) => setDraftDohDomain(event.target.value)}
              disabled={savingConfig}
            />
            <Input
              size="sm"
              label="JWKS URL"
              value={draftJwksUrl}
              onChange={(event) => setDraftJwksUrl(event.target.value)}
              disabled={savingConfig}
            />
            <Input
              size="sm"
              label="Issuer"
              value={draftIssuer}
              onChange={(event) => setDraftIssuer(event.target.value)}
              disabled={savingConfig}
            />
            <Input
              size="sm"
              label="Audience"
              value={draftAudience}
              onChange={(event) => setDraftAudience(event.target.value)}
              disabled={savingConfig}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            云端互联功能需要我们的中央服务器来提供支持。然而，由于此功能被设计为
            0 配置、0
            打扰的开箱即用，存在被恶意使用的风险，例如注册大量虚假实例来占用定时器资源，导致正常实例的定时任务无法按时执行。
            <br />
            因此，在每次任务触发后，实例将返回
            <b> 完全匿名、不包含敏感业务数据 </b>
            的性能统计信息，例如各项任务的执行时间和成功率等。这些数据将帮助我们改善
            NeutralPress
            的性能，并优化调度算法、识别虚假实例，以便更公平合理地分配资源，确保每个实例都能获得良好的服务质量。
            <br />
            我们始终保持公开透明。每次请求返回的遥测数据均可在任务的详情页面查看。服务端完全开源，你可以自己部署中央服务器，并修改上述的连接配置，使用你自己的服务器来提供云端互联服务。
            <br />
            中央调度服务：https://github.com/NeutralPress/cloud
          </p>
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
              onClick={() => void handleSaveConfig()}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
