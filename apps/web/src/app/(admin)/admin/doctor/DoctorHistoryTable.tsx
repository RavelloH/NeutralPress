"use client";

import { useEffect, useState } from "react";
import {
  RiAlertLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiEyeLine,
} from "@remixicon/react";
import type { DoctorHistoryItem } from "@repo/shared-types/api/doctor";

import type { FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getDoctorHistory } from "@/lib/client/api/doctor-read";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";

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

function getStatusClass(status: DoctorHistoryItem["status"]): string {
  if (status === "ERROR") return "text-error";
  if (status === "WARNING") return "text-warning";
  return "text-success";
}

function getStatusIcon(status: DoctorHistoryItem["status"]): React.ReactNode {
  if (status === "ERROR") return <RiErrorWarningLine size="1.5em" />;
  if (status === "WARNING") return <RiAlertLine size="1.5em" />;
  return <RiCheckLine size="1.5em" />;
}

function getSeverityClass(
  severity: DoctorHistoryItem["checks"][number]["severity"],
): string {
  if (severity === "error") return "text-error";
  if (severity === "warning") return "text-warning";
  return "text-foreground";
}

const TRIGGER_TYPE_LABELS: Record<DoctorHistoryItem["triggerType"], string> = {
  MANUAL: "手动触发",
  AUTO: "自动触发",
  CRON: "定时触发",
};

export default function DoctorHistoryTable() {
  const [data, setData] = useState<DoctorHistoryItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] =
    useState<DoctorHistoryItem | null>(null);

  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
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
      placeholder: "OK / WARNING / ERROR",
    },
    {
      key: "triggerType",
      label: "触发类型",
      type: "input",
      inputType: "text",
      placeholder: "MANUAL / AUTO / CRON",
    },
    {
      key: "okCount",
      label: "正常数",
      type: "input",
      inputType: "number",
      placeholder: "输入正常数",
    },
    {
      key: "warningCount",
      label: "警告数",
      type: "input",
      inputType: "number",
      placeholder: "输入警告数",
    },
    {
      key: "errorCount",
      label: "错误数",
      type: "input",
      inputType: "number",
      placeholder: "输入错误数",
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
  ];

  const openDetailDialog = (record: DoctorHistoryItem) => {
    setSelectedRecord(record);
    setDetailDialogOpen(true);
  };

  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedRecord(null);
  };

  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "doctor-refresh") {
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
          sortBy?:
            | "id"
            | "createdAt"
            | "status"
            | "okCount"
            | "warningCount"
            | "errorCount"
            | "triggerType"
            | "durationMs";
          sortOrder?: "asc" | "desc";
          id?: number;
          status?: "OK" | "WARNING" | "ERROR";
          triggerType?: "MANUAL" | "AUTO" | "CRON";
          okCount?: number;
          warningCount?: number;
          errorCount?: number;
          createdAtStart?: string;
          createdAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "id"
            | "createdAt"
            | "status"
            | "okCount"
            | "warningCount"
            | "errorCount"
            | "triggerType"
            | "durationMs";
          params.sortOrder = sortOrder;
        }

        if (filterValues.id && typeof filterValues.id === "string") {
          params.id = parseInt(filterValues.id, 10);
        }

        if (filterValues.status && typeof filterValues.status === "string") {
          const normalized = filterValues.status.trim().toUpperCase();
          if (
            normalized === "OK" ||
            normalized === "WARNING" ||
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
            normalized === "AUTO" ||
            normalized === "CRON"
          ) {
            params.triggerType = normalized;
          }
        }

        if (filterValues.okCount && typeof filterValues.okCount === "string") {
          params.okCount = parseInt(filterValues.okCount, 10);
        }

        if (
          filterValues.warningCount &&
          typeof filterValues.warningCount === "string"
        ) {
          params.warningCount = parseInt(filterValues.warningCount, 10);
        }

        if (
          filterValues.errorCount &&
          typeof filterValues.errorCount === "string"
        ) {
          params.errorCount = parseInt(filterValues.errorCount, 10);
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

        const result = await getDoctorHistory(params);
        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch doctor history:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [page, pageSize, sortKey, sortOrder, filterValues, refreshTrigger]);

  const columns: TableColumn<DoctorHistoryItem>[] = [
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
        if (value === "OK" || value === "WARNING" || value === "ERROR") {
          return (
            <span
              className={
                getStatusClass(value) +
                " flex items-center justify-center gap-1"
              }
            >
              {getStatusIcon(value)}
            </span>
          );
        }
        return "-";
      },
    },
    {
      key: "brief",
      title: "问题简报",
      width: "30%",
      dataIndex: "brief",
      align: "left",
      render: (value: unknown) => {
        if (typeof value === "string" && value.trim()) {
          return <span className="text-sm">{value}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },

    {
      key: "okCount",
      title: "正常",
      dataIndex: "okCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => (
        <span className="text-muted-foreground">{String(value ?? 0)}</span>
      ),
    },
    {
      key: "warningCount",
      title: "警告",
      dataIndex: "warningCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        value ? (
          <span className="text-warning font-semibold">
            {String(value ?? 0)}
          </span>
        ) : (
          <span className="text-muted-foreground">{String(value ?? 0)}</span>
        ),
    },
    {
      key: "errorCount",
      title: "错误",
      dataIndex: "errorCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        value ? (
          <span className="text-error font-semibold">{String(value ?? 0)}</span>
        ) : (
          <span className="text-muted-foreground">{String(value ?? 0)}</span>
        ),
    },
    {
      key: "triggerType",
      title: "触发类型",
      dataIndex: "triggerType",
      align: "left",
      sortable: true,
      mono: true,
      render(value) {
        if (typeof value === "string") {
          return TRIGGER_TYPE_LABELS[value as DoctorHistoryItem["triggerType"]];
        }
      },
    },
    {
      key: "durationMs",
      title: "耗时",
      dataIndex: "durationMs",
      align: "right",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "number") {
          return `${value}ms`;
        }
        return "-";
      },
    },
    {
      key: "startedAt",
      title: "开始时间",
      dataIndex: "startedAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return formatDateTime(value);
        }
        return "-";
      },
    },
    {
      key: "createdAt",
      title: "创建时间",
      dataIndex: "createdAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return formatDateTime(value);
        }
        return "-";
      },
    },
    {
      key: "detail",
      title: "详情",
      dataIndex: "id",
      align: "center",
      render: () => {
        return (
          <Clickable className="text-primary hover:text-primary/80 text-sm flex items-center justify-center gap-1">
            <RiEyeLine size="1em" />
          </Clickable>
        );
      },
    },
  ];

  return (
    <>
      <GridTable
        title="运行状况历史记录"
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
        emptyText="暂无历史记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
      />

      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`运行记录详情 - ID: ${selectedRecord?.id || ""}`}
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
                  <p
                    className={`text-sm ${getStatusClass(
                      selectedRecord.status,
                    )}`}
                  >
                    {selectedRecord.status}
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
                    检查开始时间
                  </label>
                  <p className="text-sm font-mono">
                    {formatDateTime(selectedRecord.startedAt)}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    检查结束时间
                  </label>
                  <p className="text-sm font-mono">
                    {formatDateTime(selectedRecord.createdAt)}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">简报</label>
                  <p className="text-sm">
                    {selectedRecord.brief || "一切正常。"}
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
                  <label className="text-sm text-muted-foreground">
                    总检查项
                  </label>
                  <p className="text-sm">
                    {selectedRecord.okCount +
                      selectedRecord.warningCount +
                      selectedRecord.errorCount}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">正常</label>
                  <p className="text-sm">{selectedRecord.okCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">警告</label>
                  <p className="text-sm">{selectedRecord.warningCount}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">错误</label>
                  <p className="text-sm">{selectedRecord.errorCount}</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                检查详情
              </h3>
              {selectedRecord.checks.length === 0 ? (
                <p className="text-sm text-muted-foreground">无检查项数据</p>
              ) : (
                <div className="space-y-3">
                  {selectedRecord.checks.map((check) => (
                    <div
                      key={check.code}
                      className="grid grid-cols-2 md:grid-cols-4 gap-3"
                    >
                      <div>
                        <label className="text-sm text-muted-foreground">
                          检查项
                        </label>
                        <p className="text-sm">{check.message}</p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          值
                        </label>
                        <p
                          className={`text-sm ${getSeverityClass(check.severity)}`}
                        >
                          {check.details || "-"}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          级别
                        </label>
                        <p
                          className={`text-sm ${getSeverityClass(check.severity)}`}
                        >
                          {check.severity.toUpperCase()}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground">
                          检查耗时
                        </label>
                        <p className="text-sm font-mono">
                          {check.durationMs}ms
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
