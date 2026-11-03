"use client";

import { useEffect, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiEyeLine,
  RiSubtractLine,
} from "@remixicon/react";
import type { CronHistoryItem } from "@repo/shared-types/api/cron";

import type { FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCronHistory } from "@/lib/client/api/cron-history";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";

type SortKey =
  | "id"
  | "createdAt"
  | "startedAt"
  | "status"
  | "triggerType"
  | "durationMs"
  | "enabledCount"
  | "successCount"
  | "failedCount"
  | "skippedCount";

const STATUS_LABELS: Record<CronHistoryItem["status"], string> = {
  OK: "成功",
  PARTIAL: "部分成功",
  ERROR: "失败",
};

const TRIGGER_TYPE_LABELS: Record<CronHistoryItem["triggerType"], string> = {
  MANUAL: "手动触发",
  CLOUD: "云端触发",
  AUTO: "自动触发",
};

const TASK_LABELS = {
  doctor: "运行状况检查",
  projects: "Projects 同步",
  friends: "友链检查",
  cleanup: "自动清理",
  analytics: "访问统计整理",
} as const;

type CronTaskKey = keyof typeof TASK_LABELS;
type CronTaskSnapshot = CronHistoryItem["snapshot"]["tasks"][CronTaskKey];

const INTERNAL_REASON_LABELS: Record<string, string> = {
  "task disabled": "任务开关关闭",
  "cron disabled": "计划任务总开关关闭",
  "invalid snapshot": "快照数据无效",
  "doctor task not found": "缺少 Doctor 任务快照",
  "projects task not found": "缺少 Projects 任务快照",
  "friends task not found": "缺少 Friends 任务快照",
  "cleanup task not found": "缺少自动清理任务快照",
  "analytics task not found": "缺少访问统计整理任务快照",
};

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

function getStatusClass(status: CronHistoryItem["status"]): string {
  if (status === "ERROR") return "text-error";
  if (status === "PARTIAL") return "text-warning";
  return "text-success";
}

function getTaskStatusClass(status: "O" | "E" | "S"): string {
  if (status === "E") return "text-error";
  if (status === "S") return "text-muted-foreground";
  return "text-success";
}

function getTaskStatusLabel(status: "O" | "E" | "S"): string {
  if (status === "E") return "失败";
  if (status === "S") return "跳过";
  return "成功";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeReason(reason: string | null | undefined): string | null {
  const normalized = readString(reason);
  if (!normalized) return null;
  return INTERNAL_REASON_LABELS[normalized] || normalized;
}

function formatTaskSummary(
  taskKey: CronTaskKey,
  task: CronTaskSnapshot,
): string {
  const reason = normalizeReason(task.m);

  if (task.s === "S") {
    if (reason) {
      return `任务已跳过：${reason}。`;
    }
    return "任务已跳过。";
  }

  if (task.s === "E") {
    if (reason) {
      return `任务执行失败：${reason}。`;
    }
    return "任务执行失败。";
  }

  if (taskKey === "doctor" && isRecord(task.v)) {
    const status = readString(task.v.status);
    const statusLabel =
      status === "OK"
        ? "正常"
        : status === "WARNING"
          ? "警告"
          : status === "ERROR"
            ? "异常"
            : null;
    const okCount = readNumber(task.v.okCount);
    const warningCount = readNumber(task.v.warningCount);
    const errorCount = readNumber(task.v.errorCount);

    if (
      statusLabel &&
      okCount !== null &&
      warningCount !== null &&
      errorCount !== null
    ) {
      return `任务执行成功：自检状态为${statusLabel}，正常 ${okCount} 项，警告 ${warningCount} 项，错误 ${errorCount} 项。`;
    }
  }

  if (taskKey === "projects" && isRecord(task.v)) {
    const synced = readNumber(task.v.synced);
    const failed = readNumber(task.v.failed);

    if (synced !== null && failed !== null) {
      return `任务执行成功：同步完成，成功 ${synced} 项，失败 ${failed} 项。`;
    }
  }

  if (taskKey === "friends" && isRecord(task.v)) {
    const total = readNumber(task.v.total);
    const checked = readNumber(task.v.checked);
    const skipped = readNumber(task.v.skipped);
    const failed = readNumber(task.v.failed);
    const statusChanged = readNumber(task.v.statusChanged);

    if (
      total !== null &&
      checked !== null &&
      skipped !== null &&
      failed !== null &&
      statusChanged !== null
    ) {
      return `任务执行成功：共 ${total} 条，已检查 ${checked} 条，跳过 ${skipped} 条，失败 ${failed} 条，状态变更 ${statusChanged} 条。`;
    }
  }

  if (taskKey === "cleanup" && isRecord(task.v)) {
    const totalDeleted = readNumber(task.v.totalDeleted);
    const totalAffected = readNumber(task.v.totalAffected);
    const searchLogDeleted = readNumber(task.v.searchLogDeleted);
    const healthCheckDeleted = readNumber(task.v.healthCheckDeleted);
    const auditLogDeleted = readNumber(task.v.auditLogDeleted);
    const recycleBinDeleted = readNumber(task.v.recycleBinDeleted);
    const cronHistoryDeleted = readNumber(task.v.cronHistoryDeleted);
    const cloudTriggerHistoryDeleted = readNumber(
      task.v.cloudTriggerHistoryDeleted,
    );
    const noticeDeleted = readNumber(task.v.noticeDeleted);
    const unsubscribedMailSubscriptionDeleted = readNumber(
      task.v.unsubscribedMailSubscriptionDeleted,
    );
    const refreshTokenDeleted = readNumber(task.v.refreshTokenDeleted);
    const passwordResetDeleted = readNumber(task.v.passwordResetDeleted);
    const pushSubscriptionsMarkedInactive = readNumber(
      task.v.pushSubscriptionsMarkedInactive,
    );
    const pushSubscriptionsDeletedInactive = readNumber(
      task.v.pushSubscriptionsDeletedInactive,
    );
    const pushSubscriptionsDeletedForDisabledUsers = readNumber(
      task.v.pushSubscriptionsDeletedForDisabledUsers,
    );

    const detailParts: string[] = [];
    if (searchLogDeleted !== null) {
      detailParts.push(`SearchLog ${searchLogDeleted} 条`);
    }
    if (healthCheckDeleted !== null) {
      detailParts.push(`HealthCheck ${healthCheckDeleted} 条`);
    }
    if (auditLogDeleted !== null) {
      detailParts.push(`AuditLog ${auditLogDeleted} 条`);
    }
    if (cronHistoryDeleted !== null) {
      detailParts.push(`CronHistory ${cronHistoryDeleted} 条`);
    }
    if (cloudTriggerHistoryDeleted !== null) {
      detailParts.push(`CloudTriggerHistory ${cloudTriggerHistoryDeleted} 条`);
    }
    if (noticeDeleted !== null) {
      detailParts.push(`Notice ${noticeDeleted} 条`);
    }
    if (recycleBinDeleted !== null) {
      detailParts.push(`回收站 ${recycleBinDeleted} 条`);
    }
    if (unsubscribedMailSubscriptionDeleted !== null) {
      detailParts.push(
        `UNSUBSCRIBED 订阅 ${unsubscribedMailSubscriptionDeleted} 条`,
      );
    }
    if (refreshTokenDeleted !== null) {
      detailParts.push(`RefreshToken ${refreshTokenDeleted} 条`);
    }
    if (passwordResetDeleted !== null) {
      detailParts.push(`PasswordReset ${passwordResetDeleted} 条`);
    }
    if (pushSubscriptionsDeletedInactive !== null) {
      detailParts.push(`Push(inactive) ${pushSubscriptionsDeletedInactive} 条`);
    }
    if (pushSubscriptionsDeletedForDisabledUsers !== null) {
      detailParts.push(
        `Push(禁用用户) ${pushSubscriptionsDeletedForDisabledUsers} 条`,
      );
    }

    if (detailParts.length > 0) {
      const deletedLabel =
        totalDeleted !== null ? `共删除 ${totalDeleted} 条` : "已完成删除清理";
      const affectedLabel =
        totalAffected !== null ? `，共影响 ${totalAffected} 条` : "";
      const markedLabel =
        pushSubscriptionsMarkedInactive !== null
          ? `；标记 Push 为 inactive ${pushSubscriptionsMarkedInactive} 条`
          : "";
      return `任务执行成功：${deletedLabel}${affectedLabel}；明细：${detailParts.join("，")}${markedLabel}。`;
    }
  }

  if (taskKey === "analytics" && isRecord(task.v)) {
    const flushSuccess = task.v.flushSuccess === true;
    const flushedCount = readNumber(task.v.flushedCount);
    const syncedViewCountRows = readNumber(task.v.syncedViewCountRows);
    const archivedDateGroups = readNumber(task.v.archivedDateGroups);
    const archivedRawPageViewDeleted = readNumber(
      task.v.archivedRawPageViewDeleted,
    );
    const expiredArchiveDeleted = readNumber(task.v.expiredArchiveDeleted);
    const reportMode = readString(task.v.reportMode);
    const reportRecipientCount = readNumber(task.v.reportRecipientCount);
    const reportCycleCount = readNumber(task.v.reportCycleCount);
    const reportNoticeSent = readNumber(task.v.reportNoticeSent);
    const reportEmailSent = readNumber(task.v.reportEmailSent);
    const reportErrorCount = readNumber(task.v.reportErrorCount);

    const flushText = [
      flushSuccess ? "刷写成功" : "刷写失败",
      flushedCount !== null ? `写入 ${flushedCount} 条` : null,
      syncedViewCountRows !== null
        ? `缓存同步 ${syncedViewCountRows} 条`
        : null,
      archivedDateGroups !== null ? `归档 ${archivedDateGroups} 组` : null,
      archivedRawPageViewDeleted !== null
        ? `归档后删除原始 ${archivedRawPageViewDeleted} 条`
        : null,
      expiredArchiveDeleted !== null
        ? `过期归档删除 ${expiredArchiveDeleted} 条`
        : null,
    ]
      .filter(Boolean)
      .join("，");

    const reportText = [
      reportMode ? `报告模式 ${reportMode}` : null,
      reportRecipientCount !== null
        ? `接收人 ${reportRecipientCount} 个`
        : null,
      reportCycleCount !== null ? `触发周期 ${reportCycleCount} 个` : null,
      reportNoticeSent !== null ? `通知发送 ${reportNoticeSent} 条` : null,
      reportEmailSent !== null ? `邮件发送 ${reportEmailSent} 封` : null,
      reportErrorCount !== null ? `报告异常 ${reportErrorCount} 项` : null,
    ]
      .filter(Boolean)
      .join("，");

    if (flushText || reportText) {
      return `任务执行成功：${flushText || "访问统计整理已执行"}${reportText ? `；${reportText}` : ""}。`;
    }
  }

  if (reason) {
    return `任务执行成功：${reason}。`;
  }

  if (
    typeof task.v === "string" ||
    typeof task.v === "number" ||
    typeof task.v === "boolean"
  ) {
    return `任务执行成功：结果为 ${String(task.v)}。`;
  }

  return "任务执行成功。";
}

export default function CronHistoryTable() {
  const [data, setData] = useState<CronHistoryItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<CronHistoryItem | null>(
    null,
  );

  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? (key as SortKey) : null);
    setSortOrder(order);
    setPage(1);
  };

  const handleFilterChange = (
    filters: Record<
      string,
      string | string[] | { start?: string; end?: string }
    >,
  ) => {
    setFilterValues(filters);
    setPage(1);
  };

  const filterConfig: FilterConfig[] = [
    {
      key: "id",
      label: "记录 ID",
      type: "input",
      inputType: "number",
      placeholder: "输入记录 ID",
    },
    {
      key: "status",
      label: "状态",
      type: "input",
      inputType: "text",
      placeholder: "OK / PARTIAL / ERROR",
    },
    {
      key: "triggerType",
      label: "触发类型",
      type: "input",
      inputType: "text",
      placeholder: "MANUAL / CLOUD / AUTO",
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
  ];

  const openDetailDialog = (record: CronHistoryItem) => {
    setSelectedRecord(record);
    setDetailDialogOpen(true);
  };

  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedRecord(null);
  };

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "cron-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params: {
          page: number;
          pageSize: number;
          sortBy?: SortKey;
          sortOrder?: "asc" | "desc";
          id?: number;
          status?: "OK" | "PARTIAL" | "ERROR";
          triggerType?: "MANUAL" | "CLOUD" | "AUTO";
          createdAtStart?: string;
          createdAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey;
          params.sortOrder = sortOrder;
        }

        if (filterValues.id && typeof filterValues.id === "string") {
          params.id = parseInt(filterValues.id, 10);
        }

        if (filterValues.status && typeof filterValues.status === "string") {
          const normalized = filterValues.status.trim().toUpperCase();
          if (
            normalized === "OK" ||
            normalized === "PARTIAL" ||
            normalized === "ERROR"
          ) {
            params.status = normalized;
          }
        }

        if (
          filterValues.triggerType &&
          typeof filterValues.triggerType === "string"
        ) {
          const normalized = filterValues.triggerType.trim().toUpperCase();
          if (
            normalized === "MANUAL" ||
            normalized === "CLOUD" ||
            normalized === "AUTO"
          ) {
            params.triggerType = normalized;
          }
        }

        if (
          filterValues.createdAt &&
          typeof filterValues.createdAt === "object"
        ) {
          const dateRange = filterValues.createdAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.createdAtStart = dateRange.start;
          }
          if (dateRange.end) {
            params.createdAtEnd = dateRange.end;
          }
        }

        const result = await getCronHistory(params);
        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (fetchError) {
        console.error("[CronHistoryTable] 获取历史失败:", fetchError);
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [filterValues, page, pageSize, refreshTrigger, sortKey, sortOrder]);

  const columns: TableColumn<CronHistoryItem>[] = [
    {
      key: "id",
      title: "ID",
      dataIndex: "id",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "status",
      title: "状态",
      dataIndex: "status",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (value === "OK" || value === "PARTIAL" || value === "ERROR") {
          return (
            <span className={getStatusClass(value)}>
              {STATUS_LABELS[value]}
            </span>
          );
        }
        return "-";
      },
    },
    {
      key: "triggerType",
      title: "触发类型",
      dataIndex: "triggerType",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (value === "MANUAL" || value === "CLOUD" || value === "AUTO") {
          return TRIGGER_TYPE_LABELS[value];
        }
        return "-";
      },
    },
    {
      key: "enabledCount",
      title: "启用",
      dataIndex: "enabledCount",
      align: "center",
      sortable: true,
      mono: true,
    },
    {
      key: "successCount",
      title: "成功",
      dataIndex: "successCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => (
        <span className="text-success">{String(value ?? 0)}</span>
      ),
    },
    {
      key: "failedCount",
      title: "失败",
      dataIndex: "failedCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        typeof value === "number" && value > 0 ? (
          <span className="text-error">{value}</span>
        ) : (
          <span className="text-muted-foreground">{String(value ?? 0)}</span>
        ),
    },
    {
      key: "skippedCount",
      title: "跳过",
      dataIndex: "skippedCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => (
        <span className="text-muted-foreground">{String(value ?? 0)}</span>
      ),
    },
    {
      key: "durationMs",
      title: "耗时",
      dataIndex: "durationMs",
      align: "right",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        typeof value === "number" ? `${value}ms` : "-",
    },
    {
      key: "startedAt",
      title: "开始时间",
      dataIndex: "startedAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        typeof value === "string" ? formatDateTime(value) : "-",
    },
    {
      key: "createdAt",
      title: "结束时间",
      dataIndex: "createdAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        typeof value === "string" ? formatDateTime(value) : "-",
    },
    {
      key: "detail",
      title: "详情",
      dataIndex: "id",
      align: "center",
      render: () => (
        <Clickable className="text-primary hover:text-primary/80 text-sm flex items-center justify-center gap-1">
          <RiEyeLine size="1em" />
        </Clickable>
      ),
    },
  ];

  return (
    <>
      <GridTable
        title="计划任务执行历史"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="id"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        onRowClick={(record) => openDetailDialog(record)}
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无执行历史"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
      />

      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`执行记录详情 - ID: ${selectedRecord?.id || ""}`}
        size="lg"
      >
        {selectedRecord && (
          <div className="px-6 py-6 space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                基本信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">ID</label>
                  <p className="text-sm font-mono">{selectedRecord.id}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">状态</label>
                  <p className={`text-sm`}>
                    {STATUS_LABELS[selectedRecord.status]}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    触发类型
                  </label>
                  <p className="text-sm font-mono">
                    {TRIGGER_TYPE_LABELS[selectedRecord.triggerType]}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    总耗时
                  </label>
                  <p className="text-sm font-mono">
                    {selectedRecord.durationMs}ms
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    开始时间
                  </label>
                  <p className="text-sm font-mono">
                    {formatDateTime(selectedRecord.startedAt)}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    结束时间
                  </label>
                  <p className="text-sm font-mono">
                    {formatDateTime(selectedRecord.createdAt)}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                统计信息
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">启用</label>
                  <p className="text-sm">{selectedRecord.enabledCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">成功</label>
                  <p className="text-sm">{selectedRecord.successCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">失败</label>
                  <p className="text-sm">{selectedRecord.failedCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">跳过</label>
                  <p className="text-sm">{selectedRecord.skippedCount}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                任务详情
              </h3>
              <div className="space-y-4">
                {(Object.keys(TASK_LABELS) as CronTaskKey[]).map((key) => {
                  const task = selectedRecord.snapshot.tasks[key];
                  return (
                    <div
                      key={key}
                      className="grid grid-cols-2 md:grid-cols-4 gap-3"
                    >
                      <div>
                        <label className="text-sm text-muted-foreground">
                          任务
                        </label>
                        <p className="text-sm">{TASK_LABELS[key]}</p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          开关
                        </label>
                        <p className="text-sm">
                          {task.e ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <RiCheckLine size="1em" />
                              开启
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <RiCloseLine size="1em" />
                              关闭
                            </span>
                          )}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          执行状态
                        </label>
                        <p className={`text-sm ${getTaskStatusClass(task.s)}`}>
                          {task.s === "S" ? (
                            <span className="inline-flex items-center gap-1">
                              <RiSubtractLine size="1em" />
                              {getTaskStatusLabel(task.s)}
                            </span>
                          ) : (
                            getTaskStatusLabel(task.s)
                          )}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          任务耗时
                        </label>
                        <p className="text-sm font-mono">{task.d}ms</p>
                      </div>
                      <div className="md:col-span-6">
                        <label className="text-sm text-muted-foreground">
                          结果说明
                        </label>
                        <p className="text-sm break-all">
                          {formatTaskSummary(key, task)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
