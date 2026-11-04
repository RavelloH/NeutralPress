"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RiRadarLine } from "@remixicon/react";
import type {
  AutoUpdateMode,
  AutoUpdateOverview,
  RepoUpdateStatus,
  RuntimeVersionInfo,
} from "@repo/shared-types/api/auto-update";

import {
  triggerAutoUpdate,
  updateAutoUpdateConfig,
} from "@/actions/auto-update";
import {
  getAutoUpdateOverview,
  getRuntimeVersionInfo,
} from "@/lib/client/api/auto-update-read";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { useToast } from "@/ui/Toast";

const REPO_STATUS_LABELS: Record<RepoUpdateStatus["status"], string> = {
  UNKNOWN: "状态未知",
  MISSING_CONFIG: "配置不完整",
  IDENTICAL: "已是最新",
  BEHIND: "可更新",
  AHEAD: "领先上游",
  DIVERGED: "已分叉",
  BLOCKED_VERSION: "已阻止",
  ERROR: "检查失败",
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeText(value: string): string {
  return value.trim();
}

function hasRuntimeVersionChanged(
  before: RuntimeVersionInfo | null,
  current: RuntimeVersionInfo,
): boolean {
  if (!before) return false;
  return (
    before.appVersion !== current.appVersion ||
    before.commit !== current.commit ||
    before.buildId !== current.buildId
  );
}

function formatRuntime(runtime: RuntimeVersionInfo | null): string {
  if (!runtime) return "-";

  const version = runtime.appVersion ? `v${runtime.appVersion}` : "v-";
  const build = runtime.buildId ? `#${runtime.buildId}` : "#-";
  const commit = runtime.commit ? runtime.commit.slice(0, 12) : "-";
  return `${version} ${build} ${commit}`;
}

function applyOverviewToDraft(
  overview: AutoUpdateOverview,
  setDraftMode: (mode: AutoUpdateMode) => void,
  setDraftRepoFullName: (value: string) => void,
  setDraftRepoBranch: (value: string) => void,
  setDraftRepoPat: (value: string) => void,
  setDraftWatchtowerBaseUrl: (value: string) => void,
): void {
  setDraftMode(overview.config.mode);
  setDraftRepoFullName(overview.config.repo.fullName);
  setDraftRepoBranch(overview.config.repo.branch);
  setDraftRepoPat(overview.config.repo.pat);
  setDraftWatchtowerBaseUrl(overview.config.container.watchtowerBaseUrl);
}

export default function AutoUpdateDialogButton() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollingMessage, setPollingMessage] = useState("");
  const [overview, setOverview] = useState<AutoUpdateOverview | null>(null);

  const [draftMode, setDraftMode] = useState<AutoUpdateMode>("REPOSITORY");
  const [draftRepoFullName, setDraftRepoFullName] = useState("");
  const [draftRepoBranch, setDraftRepoBranch] = useState("main");
  const [draftRepoPat, setDraftRepoPat] = useState("");
  const [draftWatchtowerBaseUrl, setDraftWatchtowerBaseUrl] = useState(
    "http://watchtower:8080/v1/update",
  );

  const loadOverview =
    useCallback(async (): Promise<AutoUpdateOverview | null> => {
      setLoadingOverview(true);
      try {
        const result = await getAutoUpdateOverview();
        if (!result.success || !result.data) {
          toast.error(result.message || "加载自动更新配置失败");
          return null;
        }

        setOverview(result.data);
        applyOverviewToDraft(
          result.data,
          setDraftMode,
          setDraftRepoFullName,
          setDraftRepoBranch,
          setDraftRepoPat,
          setDraftWatchtowerBaseUrl,
        );
        return result.data;
      } catch (error) {
        console.error("[AutoUpdateDialog] 加载配置失败:", error);
        toast.error("加载自动更新配置失败");
        return null;
      } finally {
        setLoadingOverview(false);
      }
    }, [toast]);

  useEffect(() => {
    if (!dialogOpen) return;
    void loadOverview();
  }, [dialogOpen, loadOverview]);

  const hasDraftChanges = useMemo(() => {
    if (!overview) return false;
    return (
      draftMode !== overview.config.mode ||
      normalizeText(draftRepoFullName) !==
        normalizeText(overview.config.repo.fullName) ||
      normalizeText(draftRepoBranch) !==
        normalizeText(overview.config.repo.branch) ||
      normalizeText(draftRepoPat) !== normalizeText(overview.config.repo.pat) ||
      normalizeText(draftWatchtowerBaseUrl) !==
        normalizeText(overview.config.container.watchtowerBaseUrl)
    );
  }, [
    draftMode,
    draftRepoBranch,
    draftRepoFullName,
    draftRepoPat,
    draftWatchtowerBaseUrl,
    overview,
  ]);

  const canTriggerRepoUpdate = useMemo(() => {
    if (draftMode !== "REPOSITORY") return true;
    if (!overview?.repoStatus) return false;
    return overview.repoStatus.available;
  }, [draftMode, overview]);

  const repoFieldsValid = useMemo(() => {
    if (draftMode !== "REPOSITORY") return true;
    return (
      normalizeText(draftRepoFullName).length > 0 &&
      normalizeText(draftRepoBranch).length > 0 &&
      normalizeText(draftRepoPat).length > 0
    );
  }, [draftMode, draftRepoBranch, draftRepoFullName, draftRepoPat]);

  const saveConfig = useCallback(async (): Promise<boolean> => {
    setSavingConfig(true);
    try {
      const result = await updateAutoUpdateConfig({
        mode: draftMode,
        repoFullName: normalizeText(draftRepoFullName),
        repoBranch: normalizeText(draftRepoBranch) || "main",
        repoPat: normalizeText(draftRepoPat),
        watchtowerBaseUrl: normalizeText(draftWatchtowerBaseUrl),
      });
      if (!result.success || !result.data) {
        toast.error(result.message || "保存自动更新配置失败");
        return false;
      }

      toast.success("自动更新配置已保存");
      const latest = await loadOverview();
      if (!latest) {
        return false;
      }
      return true;
    } catch (error) {
      console.error("[AutoUpdateDialog] 保存配置失败:", error);
      toast.error("保存自动更新配置失败");
      return false;
    } finally {
      setSavingConfig(false);
    }
  }, [
    draftMode,
    draftRepoBranch,
    draftRepoFullName,
    draftRepoPat,
    draftWatchtowerBaseUrl,
    loadOverview,
    toast,
  ]);

  const pollVersionChange = useCallback(
    async (baseline: RuntimeVersionInfo | null) => {
      setPolling(true);
      setPollingMessage("正在等待版本变化...");
      const startedAt = Date.now();

      while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        try {
          const result = await getRuntimeVersionInfo();
          if (!result.success || !result.data) {
            continue;
          }

          const current = result.data;
          setOverview((prev) =>
            prev
              ? {
                  ...prev,
                  runtime: current,
                }
              : prev,
          );

          if (hasRuntimeVersionChanged(baseline, current)) {
            setPolling(false);
            setPollingMessage("");
            toast.success(`版本已更新到 ${formatRuntime(current)}`);
            await loadOverview();
            return;
          }
        } catch (error) {
          console.warn("[AutoUpdateDialog] 轮询版本失败:", error);
        }
      }

      setPolling(false);
      setPollingMessage("");
      toast.warning("更新请求已提交，但在超时时间内未检测到版本变化");
      await loadOverview();
    },
    [loadOverview, toast],
  );

  const handleTrigger = useCallback(async () => {
    if (!repoFieldsValid) {
      toast.error("请先填写完整的仓库配置");
      return;
    }

    if (draftMode === "REPOSITORY" && !canTriggerRepoUpdate) {
      toast.warning("当前无可用更新或不允许更新");
      return;
    }

    setTriggering(true);
    try {
      if (hasDraftChanges) {
        const saved = await saveConfig();
        if (!saved) return;
      }

      const triggerResult = await triggerAutoUpdate({
        mode: draftMode,
      });
      if (!triggerResult.success || !triggerResult.data) {
        toast.error(triggerResult.message || "触发自动更新失败");
        return;
      }

      toast.info(triggerResult.data.message || "更新请求已提交");
      await pollVersionChange(
        triggerResult.data.runtimeBefore ?? overview?.runtime ?? null,
      );
    } catch (error) {
      console.error("[AutoUpdateDialog] 触发更新失败:", error);
      toast.error("触发自动更新失败");
    } finally {
      setTriggering(false);
    }
  }, [
    canTriggerRepoUpdate,
    draftMode,
    hasDraftChanges,
    overview?.runtime,
    pollVersionChange,
    repoFieldsValid,
    saveConfig,
    toast,
  ]);

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
      >
        <RiRadarLine size="1.1em" /> 自动更新
      </button>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="自动更新"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="text-sm text-muted-foreground space-y-1">
            <AutoResizer>
              <div>仅支持 Github Fork 仓库和 Docker 部署方式的更新。</div>
              <AutoTransition duration={0.2}>
                <div key={draftMode}>
                  {draftMode === "REPOSITORY"
                    ? "仓库更新模式仅在当前仓库是原仓库的 fork 时可用。除了使用下面的方式触发更新，你也可以前往你的 GitHub 仓库页面，点击“Sync fork” => “Update branch”来同步更新。"
                    : "容器更新仅在当前正确使用了 docker compose 部署了全部服务时可用。如果只部署了 NeutralPress 核心服务而未部署 Watchtower，则无法更新。"}
                </div>
              </AutoTransition>
            </AutoResizer>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground">
              更新模式
            </div>
            <SegmentedControl
              value={draftMode}
              onChange={setDraftMode}
              disabled={
                savingConfig || triggering || polling || loadingOverview
              }
              options={[
                {
                  value: "REPOSITORY",
                  label: "仓库更新",
                  description: "同步仓库分支并更新到目标版本",
                },
                {
                  value: "CONTAINER",
                  label: "容器更新",
                  description: "调用 Watchtower API 拉起容器升级",
                },
              ]}
              columns={2}
            />
          </div>

          <AutoResizer>
            <AutoTransition type="fade" duration={0.2} className="pb-10">
              {draftMode === "REPOSITORY" ? (
                <div key="repository-form" className="space-y-4">
                  <Input
                    size="sm"
                    label="仓库名（owner/repo）"
                    value={draftRepoFullName}
                    onChange={(event) =>
                      setDraftRepoFullName(event.target.value)
                    }
                    disabled={
                      savingConfig || triggering || polling || loadingOverview
                    }
                  />
                  <Input
                    size="sm"
                    label="分支名"
                    value={draftRepoBranch}
                    onChange={(event) => setDraftRepoBranch(event.target.value)}
                    disabled={
                      savingConfig || triggering || polling || loadingOverview
                    }
                  />
                  <Input
                    size="sm"
                    type="password"
                    label="GitHub PAT"
                    value={draftRepoPat}
                    onChange={(event) => setDraftRepoPat(event.target.value)}
                    disabled={
                      savingConfig || triggering || polling || loadingOverview
                    }
                  />
                </div>
              ) : (
                <div key="container-form" className="space-y-4">
                  <Input
                    size="sm"
                    label="Watchtower API URL"
                    value={draftWatchtowerBaseUrl}
                    onChange={(event) =>
                      setDraftWatchtowerBaseUrl(event.target.value)
                    }
                    disabled={
                      savingConfig || triggering || polling || loadingOverview
                    }
                  />
                </div>
              )}
            </AutoTransition>
          </AutoResizer>

          <div className="text-sm space-y-1">
            <div>
              当前运行版本：
              <span className="font-mono">
                {" "}
                {formatRuntime(overview?.runtime || null)}
              </span>
            </div>
            <AutoResizer>
              <AutoTransition type="fade" duration={0.2}>
                {draftMode === "REPOSITORY" ? (
                  <div key="repository-status" className="space-y-1">
                    <div>
                      仓库状态：
                      <span className="font-medium">
                        {" "}
                        {overview?.repoStatus
                          ? REPO_STATUS_LABELS[overview.repoStatus.status]
                          : "-"}
                      </span>
                    </div>
                    <div>
                      版本对比：当前{" "}
                      <span className="font-mono">
                        {overview?.repoStatus?.currentVersion
                          ? `v${overview.repoStatus.currentVersion}`
                          : "-"}
                      </span>
                      ，目标{" "}
                      <span className="font-mono">
                        {overview?.repoStatus?.targetVersion
                          ? `v${overview.repoStatus.targetVersion}`
                          : "-"}
                      </span>
                    </div>
                    {overview?.repoStatus?.message ? (
                      <div className="text-muted-foreground">
                        {overview.repoStatus.message}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div key="container-status" className="text-muted-foreground">
                    容器模式会调用 Watchtower API 触发容器升级。
                  </div>
                )}
              </AutoTransition>
            </AutoResizer>
            <AutoTransition type="fade" duration={0.2}>
              {pollingMessage ? (
                <div key={pollingMessage} className="text-primary">
                  {pollingMessage}
                </div>
              ) : null}
            </AutoTransition>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
            <Button
              label="保存配置"
              size="sm"
              variant="secondary"
              disabled={
                loadingOverview ||
                savingConfig ||
                triggering ||
                polling ||
                !hasDraftChanges
              }
              loading={savingConfig}
              onClick={() => void saveConfig()}
            />
            <Button
              label={polling ? "正在检查" : "立即更新"}
              size="sm"
              variant="primary"
              disabled={
                loadingOverview ||
                savingConfig ||
                triggering ||
                polling ||
                !repoFieldsValid ||
                (draftMode === "REPOSITORY" && !canTriggerRepoUpdate)
              }
              loading={triggering || polling}
              onClick={() => void handleTrigger()}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
