"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  FriendLinkCheckHistoryItem,
  FriendLinkIssueType,
  FriendLinkListItem,
  FriendLinkStatus,
} from "@repo/shared-types/api/friendlink";

import { updateFriendLinkByAdmin } from "@/actions/friendlink";
import AreaChart, {
  type AreaChartDataPoint,
  type SeriesConfig,
} from "@/components/client/charts/AreaChart";
import Link from "@/components/ui/Link";
import { getFriendLinkDetail } from "@/lib/client/api/friendlink-read";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Select } from "@/ui/Select";
import { Table, type TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

interface FriendLinkEditDialogProps {
  open: boolean;
  friendLinkId: number | null;
  fallbackName?: string;
  onClose: () => void;
  onUpdated: () => Promise<void> | void;
  mode?: "view" | "edit";
}

type FriendLinkEditForm = {
  name: string;
  url: string;
  avatar: string;
  slogan: string;
  friendLinkUrl: string;
  applyNote: string;
  ownerUid: string;
  ignoreBacklink: boolean;
  group: string;
  order: string;
  status: FriendLinkStatus;
};

type CheckHistoryTableRow = {
  key: string;
  order: number;
  time: string;
  checkType: FriendLinkCheckHistoryItem["checkType"];
  ok: boolean;
  responseTime: number | null;
  statusCode: number | null | undefined;
  issueType: FriendLinkIssueType;
  hasBacklink?: boolean;
  targetUrl: string;
  note?: string;
};

const statusText: Record<FriendLinkStatus, string> = {
  PENDING: "待审核",
  PUBLISHED: "已发布",
  WHITELIST: "白名单",
  REJECTED: "已拒绝",
  DISCONNECT: "无法访问",
  NO_BACKLINK: "无回链",
  BLOCKED: "已拉黑",
};

const issueText: Record<FriendLinkIssueType, string> = {
  NONE: "正常",
  DISCONNECT: "无法访问",
  NO_BACKLINK: "无回链",
};

const issueClassName: Record<FriendLinkIssueType, string> = {
  NONE: "text-success",
  DISCONNECT: "text-error",
  NO_BACKLINK: "text-error",
};

const responseTimeSeries: SeriesConfig[] = [
  {
    key: "responseTime",
    label: "响应时间",
    color: "var(--color-primary)",
  },
];

const INITIAL_FORM: FriendLinkEditForm = {
  name: "",
  url: "",
  avatar: "",
  slogan: "",
  friendLinkUrl: "",
  applyNote: "",
  ownerUid: "",
  ignoreBacklink: false,
  group: "",
  order: "0",
  status: "PENDING",
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN");
}

function buildForm(detail: FriendLinkListItem): FriendLinkEditForm {
  return {
    name: detail.name,
    url: detail.url,
    avatar: detail.avatar || "",
    slogan: detail.slogan || "",
    friendLinkUrl: detail.friendLinkUrl || "",
    applyNote: detail.applyNote || "",
    ownerUid: detail.owner?.uid ? String(detail.owner.uid) : "",
    ignoreBacklink: detail.ignoreBacklink,
    group: detail.group || "",
    order: String(detail.order),
    status: detail.status,
  };
}

export default function FriendLinkEditDialog({
  open,
  friendLinkId,
  fallbackName,
  onClose,
  onUpdated,
  mode = "edit",
}: FriendLinkEditDialogProps) {
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<FriendLinkListItem | null>(null);
  const [form, setForm] = useState<FriendLinkEditForm>(INITIAL_FORM);

  const loadDetail = useCallback(async () => {
    if (!open || !friendLinkId) {
      setDetail(null);
      setForm(INITIAL_FORM);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await getFriendLinkDetail({ id: friendLinkId });
      if (!result.success || !result.data) {
        toast.error(result.message || "获取友链详情失败");
        setDetail(null);
        return;
      }

      setDetail(result.data);
      setForm(buildForm(result.data));
    } catch (error) {
      console.error("[FriendLinkEditDialog] 获取详情失败:", error);
      toast.error("获取友链详情失败");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [friendLinkId, open, toast]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const selectedHistory = useMemo<FriendLinkCheckHistoryItem[]>(
    () => detail?.checkHistory || [],
    [detail],
  );

  const responseChartData = useMemo<AreaChartDataPoint[]>(() => {
    return selectedHistory.map((event) => ({
      time: event.time,
      responseTime:
        typeof event.responseTime === "number" ? event.responseTime : 0,
    }));
  }, [selectedHistory]);

  const historyTableData = useMemo<CheckHistoryTableRow[]>(() => {
    return [...selectedHistory].reverse().map((event, index) => ({
      key: `${event.time}-${event.targetUrl}-${index}`,
      order: selectedHistory.length - index,
      time: event.time,
      checkType: event.checkType,
      ok: event.ok,
      responseTime: event.responseTime,
      statusCode: event.statusCode,
      issueType: event.issueType,
      hasBacklink: event.hasBacklink,
      targetUrl: event.targetUrl,
      note: event.note,
    }));
  }, [selectedHistory]);

  const historyColumns = useMemo<TableColumn<CheckHistoryTableRow>[]>(
    () => [
      {
        key: "order",
        title: "序号",
        dataIndex: "order",
        width: 72,
        mono: true,
      },
      {
        key: "time",
        title: "检查时间",
        dataIndex: "time",
        width: 180,
        mono: true,
        render: (value) =>
          formatDateTime(typeof value === "string" ? value : null),
      },
      {
        key: "checkType",
        title: "类型",
        dataIndex: "checkType",
        width: 90,
        render: (value) => (value === "backlink" ? "回链" : "站点"),
      },
      {
        key: "result",
        title: "结果",
        dataIndex: "ok",
        width: 90,
        render: (value) =>
          value ? (
            <span className="text-success">通过</span>
          ) : (
            <span className="text-error">异常</span>
          ),
      },
      {
        key: "responseTime",
        title: "响应",
        dataIndex: "responseTime",
        width: 100,
        mono: true,
        render: (value) =>
          typeof value === "number" ? `${value}ms` : <span>-</span>,
      },
      {
        key: "statusCode",
        title: "HTTP",
        dataIndex: "statusCode",
        width: 80,
        mono: true,
        render: (value) =>
          typeof value === "number" ? (
            value
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        key: "issueType",
        title: "问题",
        dataIndex: "issueType",
        width: 120,
        render: (value) => {
          const issue = (value as FriendLinkIssueType) || "NONE";
          return (
            <span className={issueClassName[issue]}>{issueText[issue]}</span>
          );
        },
      },
      {
        key: "hasBacklink",
        title: "回链",
        dataIndex: "hasBacklink",
        width: 120,
        render: (value) =>
          typeof value === "boolean" ? (
            value ? (
              "存在"
            ) : (
              "未检测到"
            )
          ) : (
            <span>-</span>
          ),
      },
      {
        key: "note",
        title: "备注",
        dataIndex: "note",
        width: 220,
        render: (value, record) => {
          if (typeof value === "string" && value) return value;
          if (record.issueType === "NO_BACKLINK")
            return "未在友链页检测到本站域名";
          if (record.issueType === "DISCONNECT") return "访问失败或返回异常";
          return <span className="text-muted-foreground">-</span>;
        },
      },
    ],
    [],
  );

  const handleSubmit = async () => {
    if (!friendLinkId) return;

    const name = form.name.trim();
    const url = form.url.trim();
    if (!name || !url) {
      toast.error("请至少填写站点名称和站点 URL");
      return;
    }

    const order = Number.parseInt(form.order, 10);
    if (!Number.isFinite(order)) {
      toast.error("排序必须是整数");
      return;
    }

    const ownerUidText = form.ownerUid.trim();
    const parsedOwnerUid = ownerUidText
      ? Number.parseInt(ownerUidText, 10)
      : Number.NaN;
    if (
      ownerUidText &&
      (!/^\d+$/.test(ownerUidText) ||
        !Number.isFinite(parsedOwnerUid) ||
        parsedOwnerUid <= 0)
    ) {
      toast.error("绑定用户 UID 必须是正整数，留空表示解绑");
      return;
    }
    const ownerUid = ownerUidText ? parsedOwnerUid : null;

    setSaving(true);
    try {
      const result = await updateFriendLinkByAdmin({
        id: friendLinkId,
        name,
        url,
        avatar: form.avatar.trim() || undefined,
        slogan: form.slogan.trim() || undefined,
        friendLinkUrl: form.friendLinkUrl.trim() || undefined,
        applyNote: form.applyNote.trim() || undefined,
        ignoreBacklink: form.ignoreBacklink,
        group: form.group.trim() || undefined,
        order,
        ownerUid,
        status: form.status,
      });

      if (!result.success || !result.data) {
        toast.error(result.message || "更新失败");
        return;
      }

      toast.success(result.message || "友链信息已更新");
      await onUpdated();
      onClose();
    } catch (error) {
      console.error("[FriendLinkEditDialog] 更新失败:", error);
      toast.error("更新失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        mode === "view"
          ? `查看友链 - ${detail?.name || fallbackName || ""}`
          : "编辑友链"
      }
      size="xl"
    >
      <AutoResizer>
        <AutoTransition>
          {loading ? (
            <div className="flex h-[32em] justify-center p-10" key="loading">
              <LoadingIndicator />
            </div>
          ) : !detail ? (
            <div
              className="px-6 py-8 text-sm text-muted-foreground"
              key="empty"
            >
              未找到友链记录
            </div>
          ) : (
            <div
              className="max-h-[80vh] space-y-6 overflow-y-auto px-6 py-6"
              key="content"
            >
              {mode === "view" && (
                <section className="space-y-4">
                  <h3 className="border-b border-foreground/10 pb-2 text-lg font-medium text-foreground">
                    当前详情
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm text-muted-foreground">
                        记录 ID
                      </label>
                      <p className="text-sm font-mono">{detail.id}</p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        状态
                      </label>
                      <p className="text-sm">{statusText[detail.status]}</p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        申请人
                      </label>
                      <p className="text-sm">
                        {detail.owner
                          ? `${detail.owner.nickname || detail.owner.username}（UID: ${detail.owner.uid}）`
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        审核人
                      </label>
                      <p className="text-sm">
                        {detail.auditor
                          ? `${detail.auditor.nickname || detail.auditor.username}（UID: ${detail.auditor.uid}）`
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        创建时间
                      </label>
                      <p className="text-sm font-mono">
                        {formatDateTime(detail.createdAt)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        更新时间
                      </label>
                      <p className="text-sm font-mono">
                        {formatDateTime(detail.updatedAt)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        发布时间
                      </label>
                      <p className="text-sm font-mono">
                        {formatDateTime(detail.publishedAt)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        最近检查
                      </label>
                      <p className="text-sm font-mono">
                        {formatDateTime(detail.lastCheckedAt)}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        成功检查
                      </label>
                      <p className="text-sm font-mono">
                        {detail.checkSuccessCount}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        失败检查
                      </label>
                      <p className="text-sm font-mono">
                        {detail.checkFailureCount}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        总成功率
                      </label>
                      <p className="text-sm font-mono">
                        {detail.checkSuccessCount + detail.checkFailureCount > 0
                          ? `${((detail.checkSuccessCount / (detail.checkSuccessCount + detail.checkFailureCount)) * 100).toFixed(1)}%`
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        最近成功率
                      </label>
                      <p className="text-sm font-mono">
                        {detail.recentSuccessRate == null
                          ? "-"
                          : `${detail.recentSuccessRate.toFixed(1)}%（${detail.recentSampleCount}次）`}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        平均响应
                      </label>
                      <p className="text-sm font-mono">
                        {typeof detail.avgResponseTime === "number"
                          ? `${detail.avgResponseTime}ms`
                          : "-"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        回链检查
                      </label>
                      <p className="text-sm">
                        {detail.ignoreBacklink ? "已忽略" : "已开启"}
                      </p>
                    </div>
                    <div className="">
                      <label className="text-sm text-muted-foreground">
                        站点 URL
                      </label>
                      <p className="mt-1 text-sm break-all">
                        <Link href={detail.url} presets={["hover-underline"]}>
                          {detail.url}
                        </Link>
                      </p>
                    </div>
                    <div className="">
                      <label className="text-sm text-muted-foreground">
                        友链页 URL
                      </label>
                      <p className="mt-1 text-sm break-all">
                        {detail.friendLinkUrl ? (
                          <Link
                            href={detail.friendLinkUrl}
                            presets={["hover-underline"]}
                          >
                            {detail.friendLinkUrl}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        分组
                      </label>
                      <p className="mt-1 text-sm break-all">
                        {detail.group ? detail.group : "未分组"}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-muted-foreground">
                        显示顺序权重
                      </label>
                      <p className="mt-1 text-sm break-all">
                        {detail.order ? detail.order : "+0"}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm text-muted-foreground">
                        站点标语
                      </label>
                      <p className="mt-1 text-sm break-all">
                        {detail.slogan ? detail.slogan : "-"}
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm text-muted-foreground">
                        申请备注
                      </label>
                      <p className="mt-1 text-sm break-all">
                        {detail.applyNote ? detail.applyNote : "-"}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {mode === "edit" && (
                <section className="space-y-4">
                  <h3 className="border-b border-foreground/10 pb-2 text-lg font-medium text-foreground">
                    编辑字段
                  </h3>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Input
                      label="站点名称"
                      value={form.name}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          name: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                    <Input
                      label="站点 URL"
                      value={form.url}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          url: event.target.value,
                        }))
                      }
                      required
                      size="sm"
                    />
                    <Input
                      label="头像 URL"
                      value={form.avatar}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          avatar: event.target.value,
                        }))
                      }
                      size="sm"
                    />
                    <Input
                      label="站点标语"
                      value={form.slogan}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          slogan: event.target.value,
                        }))
                      }
                      size="sm"
                    />
                    <Input
                      label="友链页 URL"
                      value={form.friendLinkUrl}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          friendLinkUrl: event.target.value,
                        }))
                      }
                      size="sm"
                    />
                    <Input
                      label="分组"
                      value={form.group}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          group: event.target.value,
                        }))
                      }
                      helperText="在前端 Blocks 中可筛选分组"
                      size="sm"
                    />
                    <Input
                      label="绑定用户 UID"
                      value={form.ownerUid}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          ownerUid: event.target.value,
                        }))
                      }
                      helperText="输入目标用户 UID，留空表示解绑当前用户"
                      size="sm"
                    />
                    <Input
                      label="排序"
                      type="number"
                      value={form.order}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          order: event.target.value,
                        }))
                      }
                      size="sm"
                    />
                    <div className="space-y-2">
                      <label className="block text-sm text-foreground">
                        状态
                      </label>
                      <Select
                        value={form.status}
                        onChange={(value) =>
                          setForm((prev) => ({
                            ...prev,
                            status: value as FriendLinkStatus,
                          }))
                        }
                        options={[
                          { value: "PENDING", label: "待审核" },
                          { value: "PUBLISHED", label: "已发布" },
                          { value: "WHITELIST", label: "白名单" },
                          { value: "REJECTED", label: "已拒绝" },
                          { value: "DISCONNECT", label: "无法访问" },
                          { value: "NO_BACKLINK", label: "无回链" },
                          { value: "BLOCKED", label: "已拉黑" },
                        ]}
                        size="sm"
                        className="w-full"
                      />
                    </div>
                    <div className="flex items-end pb-2">
                      <Checkbox
                        label="忽略回链检查"
                        checked={form.ignoreBacklink}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            ignoreBacklink: event.target.checked,
                          }))
                        }
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        label="备注"
                        value={form.applyNote}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            applyNote: event.target.value,
                          }))
                        }
                        rows={3}
                        size="sm"
                      />
                    </div>
                  </div>
                </section>
              )}

              {mode === "view" && (
                <section className="space-y-4">
                  <h3 className="border-b border-foreground/10 pb-2 text-lg font-medium text-foreground">
                    最近30次响应时间
                  </h3>
                  {responseChartData.length > 0 ? (
                    <div className="h-[320px] w-full">
                      <AreaChart
                        data={responseChartData}
                        series={responseTimeSeries}
                        className="h-full w-full"
                        timeGranularity="minute"
                        showYear="auto"
                        formatValue={(value) => `${value}ms`}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      暂无检查记录
                    </p>
                  )}
                </section>
              )}

              {mode === "view" && (
                <section className="space-y-4">
                  <h3 className="border-b border-foreground/10 pb-2 text-lg font-medium text-foreground">
                    最近30次检查记录
                  </h3>
                  {historyTableData.length > 0 ? (
                    <Table
                      columns={historyColumns}
                      data={historyTableData}
                      rowKey="key"
                      striped
                      hoverable={false}
                      bordered={false}
                      size="sm"
                      stickyHeader
                      emptyText="暂无检查明细"
                      className="rounded-sm border border-foreground/10"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      暂无检查明细
                    </p>
                  )}
                </section>
              )}

              <div className="flex justify-end gap-3 border-t border-foreground/10 pt-4">
                {mode === "edit" ? (
                  <>
                    <Button
                      label="取消"
                      variant="ghost"
                      size="sm"
                      onClick={onClose}
                      disabled={saving}
                    />
                    <Button
                      label="保存"
                      variant="primary"
                      size="sm"
                      onClick={() => void handleSubmit()}
                      loading={saving}
                    />
                  </>
                ) : (
                  <Button
                    label="关闭"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                  />
                )}
              </div>
            </div>
          )}
        </AutoTransition>
      </AutoResizer>
    </Dialog>
  );
}
