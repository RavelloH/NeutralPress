"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { RiAddLine, RiRefreshLine } from "@remixicon/react";
import type { FriendLinksStats } from "@repo/shared-types/api/friendlink";

import {
  checkFriendLinks,
  createFriendLinkByAdmin,
  parseFriendLinkByAdmin,
} from "@/actions/friendlink";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getFriendLinksStats } from "@/lib/client/api/friendlink-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Select } from "@/ui/Select";
import { useToast } from "@/ui/Toast";

type CreateFriendLinkForm = {
  name: string;
  url: string;
  avatar: string;
  slogan: string;
  friendLinkUrl: string;
  applyNote: string;
  status: "PUBLISHED" | "WHITELIST";
  ignoreBacklink: boolean;
};

type CreateDialogMode = "manual" | "parse";

const DEFAULT_CREATE_FORM: CreateFriendLinkForm = {
  name: "",
  url: "",
  avatar: "",
  slogan: "",
  friendLinkUrl: "",
  applyNote: "",
  status: "PUBLISHED",
  ignoreBacklink: false,
};

function buildSummary(stats: FriendLinksStats): string[] {
  const lines: string[] = [];
  lines.push(`当前共 ${stats.total} 条友链记录。`);
  lines.push(
    `可展示链接 ${stats.published + stats.whitelist} 条（发布 ${stats.published}，白名单 ${stats.whitelist}），绑定申请人 ${stats.withOwner} 条。`,
  );
  lines.push(
    `异常链接 ${stats.problematic} 条（无法访问 ${stats.disconnect}，无回链 ${stats.noBacklink}）。已拒绝 ${stats.rejected} 条，已拉黑 ${stats.blocked} 条`,
  );
  return lines;
}

export default function FriendsReport() {
  const toast = useToast();
  const [stats, setStats] = useState<FriendLinksStats | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [checkAllDialogOpen, setCheckAllDialogOpen] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [createDialogMode, setCreateDialogMode] =
    useState<CreateDialogMode>("manual");
  const [parseUrlInput, setParseUrlInput] = useState("");
  const [createForm, setCreateForm] =
    useState<CreateFriendLinkForm>(DEFAULT_CREATE_FORM);
  const { broadcast } = useBroadcastSender<{ type: string }>();

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "friends-refresh") {
      void fetchStats(false);
    }
  });

  const fetchStats = useCallback(
    async (forceRefresh: boolean) => {
      if (forceRefresh) {
        setStats(null);
      }

      setError(null);
      try {
        const result = await getFriendLinksStats({
          force: forceRefresh,
        });

        if (result.success && result.data) {
          setStats(result.data);
          if (forceRefresh) {
            await broadcast({ type: "friends-refresh" });
          }
          return;
        }

        setError(new Error(result.message || "获取统计失败"));
      } catch (fetchError) {
        console.error("[FriendsReport] 获取统计失败:", fetchError);
        setError(new Error("获取统计失败"));
      }
    },
    [broadcast],
  );

  useEffect(() => {
    void fetchStats(false);
  }, [fetchStats]);

  const openCreateDialog = useCallback(() => {
    setCreateForm(DEFAULT_CREATE_FORM);
    setCreateDialogMode("manual");
    setParseUrlInput("");
    setCreateDialogOpen(true);
  }, []);

  const handleCheckAll = useCallback(async () => {
    setCheckingAll(true);
    try {
      const result = await checkFriendLinks({ checkAll: true });
      if (!result.success || !result.data) {
        toast.error(result.message || "友链检查失败");
        return;
      }

      toast.success(
        `检查完成：检查 ${result.data.checked}，跳过 ${result.data.skipped}，异常 ${result.data.failed}，状态变更 ${result.data.statusChanged}`,
      );
      setCheckAllDialogOpen(false);
      await fetchStats(true);
    } catch (checkError) {
      console.error("[FriendsReport] 全量检查失败:", checkError);
      toast.error("友链检查失败，请稍后重试");
    } finally {
      setCheckingAll(false);
    }
  }, [fetchStats, toast]);

  const handleCreateFriendLink = useCallback(async () => {
    const payload = {
      name: createForm.name.trim(),
      url: createForm.url.trim(),
      avatar: createForm.avatar.trim(),
      slogan: createForm.slogan.trim(),
      friendLinkUrl: createForm.friendLinkUrl.trim(),
      applyNote: createForm.applyNote.trim(),
      status: createForm.status,
      ignoreBacklink: createForm.ignoreBacklink,
    };

    if (!payload.name || !payload.url || !payload.avatar || !payload.slogan) {
      toast.error("请完整填写必填项");
      return;
    }

    setCreating(true);
    try {
      const result = await createFriendLinkByAdmin({
        name: payload.name,
        url: payload.url,
        avatar: payload.avatar,
        slogan: payload.slogan,
        friendLinkUrl: payload.friendLinkUrl || undefined,
        applyNote: payload.applyNote || undefined,
        status: payload.status,
        ignoreBacklink: payload.ignoreBacklink,
      });

      if (!result.success || !result.data) {
        toast.error(result.message || "添加友链失败");
        return;
      }

      toast.success(`友链「${payload.name}」已添加`);
      setCreateDialogOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      await fetchStats(true);
    } catch (createError) {
      console.error("[FriendsReport] 添加友链失败:", createError);
      toast.error("添加友链失败，请稍后重试");
    } finally {
      setCreating(false);
    }
  }, [createForm, fetchStats, toast]);

  const handleParseFriendLink = useCallback(async () => {
    const sourceUrl = parseUrlInput.trim();
    if (!sourceUrl) {
      toast.error("请先输入站点 URL");
      return;
    }

    setParsing(true);
    try {
      const result = await parseFriendLinkByAdmin({
        url: sourceUrl,
      });

      const parsedData = result.data;
      if (!result.success || !parsedData) {
        toast.error(result.message || "解析失败");
        return;
      }

      setCreateForm((prev) => ({
        ...prev,
        url: parsedData.url,
        name: parsedData.name,
        avatar: parsedData.avatar,
        slogan: parsedData.slogan,
        friendLinkUrl: parsedData.friendLinkUrl || "",
      }));
      setParseUrlInput(parsedData.url);
      setCreateDialogMode("manual");
      toast.success("解析成功，已回填表单");
    } catch (parseError) {
      console.error("[FriendsReport] 解析友链失败:", parseError);
      toast.error("解析失败，请稍后重试");
    } finally {
      setParsing(false);
    }
  }, [parseUrlInput, toast]);

  return (
    <>
      <GridItem areas={[1, 2, 3, 4]} width={3} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {stats ? (
            <div
              className="flex h-full flex-col justify-between p-10"
              key="stats"
            >
              <div>
                <div className="py-2 text-2xl">友情链接统计</div>
                <div className="space-y-1">
                  {buildSummary(stats).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  {stats.pending > 0 && (
                    <div className="text-warning">
                      {stats.pending} 条友链待审核。
                    </div>
                  )}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                最近更新于: {new Date(stats.updatedAt).toLocaleString("zh-CN")}
                {stats.cache ? "（缓存）" : ""}
                <Clickable onClick={() => void fetchStats(true)}>
                  <RiRefreshLine size="1em" />
                </Clickable>
              </div>
            </div>
          ) : error ? (
            <div className="h-full px-10" key="error">
              <ErrorPage reason={error} reset={() => void fetchStats(true)} />
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
            onClick={() => setCheckAllDialogOpen(true)}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiRefreshLine size="1.1em" /> 全部检查
          </button>
        </AutoTransition>
      </GridItem>

      <GridItem areas={[7, 8]} width={6} height={0.2}>
        <AutoTransition type="scale" className="h-full">
          <button
            onClick={openCreateDialog}
            className="h-full w-full flex gap-2 items-center justify-center text-2xl hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
          >
            <RiAddLine size="1.1em" /> 添加友链
          </button>
        </AutoTransition>
      </GridItem>

      <AlertDialog
        open={checkAllDialogOpen}
        onClose={() => setCheckAllDialogOpen(false)}
        onConfirm={() => void handleCheckAll()}
        title="确认全部检查"
        description="将对全部非白名单友链执行检查，此过程可能耗时较长。"
        confirmText="开始检查"
        cancelText="取消"
        variant="info"
        loading={checkingAll}
      />

      <Dialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        title="添加友链"
        size="lg"
      >
        <div className="px-6 py-6">
          <SegmentedControl
            value={createDialogMode}
            onChange={(value) => {
              setCreateDialogMode(value);
              if (value === "parse" && !parseUrlInput.trim()) {
                setParseUrlInput(createForm.url);
              }
            }}
            disabled={creating || parsing}
            options={[
              {
                value: "manual",
                label: "手动填写",
                description: "直接编辑全部字段",
              },
              {
                value: "parse",
                label: "解析模式",
                description: "输入站点 URL 后自动提取",
              },
            ]}
            columns={2}
          />
          <AutoResizer>
            <AutoTransition>
              {createDialogMode === "parse" ? (
                <div className="space-y-3 py-6" key="parse-mode">
                  <Input
                    label="站点 URL"
                    value={parseUrlInput}
                    onChange={(event) => setParseUrlInput(event.target.value)}
                    helperText="只需输入站点地址，点击解析后会自动填充名称、头像、标语和友链页地址"
                    required
                    size="sm"
                    disabled={parsing || creating}
                  />
                </div>
              ) : (
                <div key="manual-mode" className="space-y-4 py-6">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="站点名称"
                      value={createForm.name}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                    <Input
                      label="站点 URL"
                      value={createForm.url}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          url: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="头像 URL"
                      value={createForm.avatar}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          avatar: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                    <Input
                      label="站点标语"
                      value={createForm.slogan}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          slogan: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                  </div>
                  <div className="pt-1">
                    <Input
                      label="友链页面 URL"
                      value={createForm.friendLinkUrl}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          friendLinkUrl: event.target.value,
                        }))
                      }
                      helperText="选填，不填时将仅检查站点 URL"
                      size="sm"
                    />
                  </div>

                  <div className="pt-1">
                    <Input
                      label="备注"
                      value={createForm.applyNote}
                      onChange={(event) =>
                        setCreateForm((prev) => ({
                          ...prev,
                          applyNote: event.target.value,
                        }))
                      }
                      rows={3}
                      size="sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-sm text-foreground">
                        初始状态
                      </label>
                      <Select
                        value={createForm.status}
                        onChange={(value) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            status: value as "PUBLISHED" | "WHITELIST",
                          }))
                        }
                        options={[
                          { value: "PUBLISHED", label: "已发布" },
                          { value: "WHITELIST", label: "白名单" },
                        ]}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-end pb-2">
                      <Checkbox
                        label="忽略回链检查"
                        checked={createForm.ignoreBacklink}
                        onChange={(event) =>
                          setCreateForm((prev) => ({
                            ...prev,
                            ignoreBacklink: event.target.checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </AutoTransition>
          </AutoResizer>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              size="sm"
              onClick={() => setCreateDialogOpen(false)}
              disabled={creating || parsing}
            />
            {createDialogMode === "parse" ? (
              <Button
                label="解析站点"
                variant="primary"
                size="sm"
                onClick={() => void handleParseFriendLink()}
                loading={parsing}
                disabled={creating}
              />
            ) : (
              <Button
                label="添加友链"
                variant="primary"
                size="sm"
                onClick={() => void handleCreateFriendLink()}
                loading={creating}
                disabled={parsing}
              />
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
