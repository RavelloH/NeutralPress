"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { RiEyeLine, RiRefreshLine } from "@remixicon/react";
import type {
  DoctorCheckDetail,
  DoctorHistoryItem,
} from "@repo/shared-types/api/doctor";

import { doctor } from "@/actions/doctor";
import AreaChart, {
  type AreaChartDataPoint,
} from "@/components/client/charts/AreaChart";
import { GridItem } from "@/components/client/layout/RowGrid";
import ErrorPage from "@/components/ui/Error";
import { useBroadcastSender } from "@/hooks/use-broadcast";
import { getDoctorHistory } from "@/lib/client/api/doctor-read";
import { AutoTransition } from "@/ui/AutoTransition";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import type { TableColumn } from "@/ui/Table";
import { Table } from "@/ui/Table";

type IssueItem = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  details?: string;
};

type DetailHistoryRow = {
  id: number;
  createdAt: string;
  severity: "info" | "warning" | "error";
  resultText: string;
  durationMs: number;
};

function parseChartValue(
  code: string,
  value: DoctorCheckDetail["value"],
): number | null {
  if (typeof value !== "number") {
    return null;
  }

  if (code === "DB_SIZE" || code === "REDIS_MEMORY") {
    return value / (1024 * 1024);
  }
  return value;
}

function formatChartValue(code: string, value: number): string {
  switch (code) {
    case "DB_SIZE":
    case "REDIS_MEMORY":
      return `${value.toFixed(2)} MB`;
    case "REDIS_FRAGMENTATION":
      return value.toFixed(2);
    case "ANALYTICS_FLUSH_SUCCESS_COUNT":
      return `写入 ${Math.round(value)} 条`;
    case "DB_CONNECTIONS":
      return `${value.toFixed(2)}%`;
    case "REDIS_KEYS":
      return `${Math.round(value)}`;
    default:
      return `${Math.round(value)}ms`;
  }
}

function formatResultText(
  code: string,
  details: string | undefined,
  value: DoctorCheckDetail["value"] | undefined,
): string {
  const normalizedDetails = details?.trim();
  if (normalizedDetails) {
    return normalizedDetails;
  }

  const parsed = parseChartValue(code, value ?? null);
  if (parsed !== null) {
    return formatChartValue(code, parsed);
  }

  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "-";
}

function getSeverityClass(severity: DetailHistoryRow["severity"]): string {
  if (severity === "error") return "text-error";
  if (severity === "warning") return "text-warning";
  return "text-foreground";
}

export default function DoctorReport() {
  const [result, setResult] = useState<IssueItem[]>([]);
  const [historyData, setHistoryData] = useState<DoctorHistoryItem[]>([]);
  const [refreshTime, setRefreshTime] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<IssueItem | null>(null);
  const { broadcast } = useBroadcastSender<{ type: "doctor-refresh" }>();

  // 统计不同严重级别的问题数量
  const errorCount = result.filter((item) => item.severity === "error").length;
  const warningCount = result.filter(
    (item) => item.severity === "warning",
  ).length;

  // 生成问题描述
  const getIssueDescription = () => {
    if (errorCount === 0 && warningCount === 0) {
      return "未发现问题。";
    }
    const parts = [];
    if (errorCount > 0) {
      parts.push(`${errorCount}项错误`);
    }
    if (warningCount > 0) {
      parts.push(`${warningCount}项警告`);
    }
    return parts.join("、") + "。";
  };

  const fetchData = useCallback(
    async (manualRefresh: boolean = false) => {
      if (manualRefresh) {
        setResult([]);
        setHistoryData([]);
      }
      setError(null);
      setHistoryError(null);
      try {
        const [doctorRes, historyRes] = await Promise.all([
          doctor({ force: manualRefresh }),
          getDoctorHistory({
            page: 1,
            pageSize: 50,
            sortBy: "createdAt",
            sortOrder: "desc",
          }),
        ]);

        if (!doctorRes.success || !doctorRes.data) {
          setError(new Error(doctorRes.message || "获取运行状况失败"));
          return;
        }

        setResult(doctorRes.data.issues || []);
        setRefreshTime(new Date(doctorRes.data.createdAt));

        if (historyRes.success && historyRes.data) {
          setHistoryData(historyRes.data);
        } else {
          setHistoryError(historyRes.message || "获取历史趋势失败");
        }

        if (manualRefresh) {
          await broadcast({ type: "doctor-refresh" });
        }
      } catch (fetchError) {
        console.error("Failed to fetch doctor report:", fetchError);
        setError(new Error("获取运行状况失败"));
      }
    },
    [broadcast],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openDetailDialog = useCallback((issue: IssueItem) => {
    setSelectedIssue(issue);
    setDetailDialogOpen(true);
  }, []);

  const closeDetailDialog = useCallback(() => {
    setDetailDialogOpen(false);
    setSelectedIssue(null);
  }, []);

  const selectedCheck = useMemo(() => {
    if (!selectedIssue) return null;
    for (const record of historyData) {
      const check = record.checks.find(
        (item) => item.code === selectedIssue.code,
      );
      if (check) return check;
    }
    return null;
  }, [historyData, selectedIssue]);

  const selectedChartData = useMemo<AreaChartDataPoint[]>(() => {
    if (!selectedIssue || historyData.length === 0) {
      return [];
    }

    const sorted = [...historyData].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() -
        new Date(right.createdAt).getTime(),
    );

    return sorted.flatMap((record) => {
      const check = record.checks.find(
        (item) => item.code === selectedIssue.code,
      );
      if (!check) {
        return [];
      }
      const numericValue = parseChartValue(selectedIssue.code, check.value);
      if (numericValue === null) {
        return [];
      }
      return [
        {
          time: record.createdAt,
          value: numericValue,
        },
      ];
    });
  }, [historyData, selectedIssue]);

  const selectedHistoryRows = useMemo<DetailHistoryRow[]>(() => {
    if (!selectedIssue || historyData.length === 0) {
      return [];
    }

    return historyData.flatMap((record) => {
      const check = record.checks.find(
        (item) => item.code === selectedIssue.code,
      );
      if (!check) {
        return [];
      }

      return [
        {
          id: record.id,
          createdAt: record.createdAt,
          severity: check.severity,
          resultText: formatResultText(check.code, check.details, check.value),
          durationMs: check.durationMs,
        },
      ];
    });
  }, [historyData, selectedIssue]);

  const historyColumns: TableColumn<DetailHistoryRow>[] = [
    {
      key: "createdAt",
      title: "检查时间",
      dataIndex: "createdAt",
      align: "left",
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return new Date(value).toLocaleString("zh-CN");
        }
        return "-";
      },
    },
    {
      key: "severity",
      title: "级别",
      dataIndex: "severity",
      align: "center",
      mono: true,
      render: (value: unknown) => {
        if (value === "info" || value === "warning" || value === "error") {
          return (
            <span className={getSeverityClass(value)}>
              {value.toUpperCase()}
            </span>
          );
        }
        return "-";
      },
    },
    {
      key: "resultText",
      title: "结果",
      dataIndex: "resultText",
      align: "left",
      render: (value: unknown) => String(value ?? "-"),
    },
    {
      key: "durationMs",
      title: "耗时",
      dataIndex: "durationMs",
      align: "right",
      mono: true,
      render: (value: unknown) =>
        typeof value === "number" ? `${value}ms` : "-",
    },
  ];

  return (
    <>
      <GridItem areas={[1, 2, 3, 4, 5, 6, 7, 8]} width={1.5} height={0.8}>
        <AutoTransition type="scale" className="h-full">
          {result.length > 0 ? (
            <div
              className="flex flex-col justify-between p-10 h-full"
              key="content"
            >
              <div>
                <div className="text-2xl py-2">运行状况检查</div>
                <div>
                  共检查 {result.length} 项，{getIssueDescription()}
                </div>
              </div>
              <div>
                <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-4 gap-y-1 w-full">
                  {result.map((issue) => {
                    const colorClass =
                      issue.severity === "error"
                        ? "text-error"
                        : issue.severity === "warning"
                          ? "text-warning"
                          : "";
                    const details = issue.details?.trim();
                    return (
                      <Fragment key={issue.code}>
                        <span className={`text-right ${colorClass}`}>
                          {issue.severity.toUpperCase()}:
                        </span>
                        <span className={colorClass}>
                          {details ? `${issue.message}：` : issue.message}
                        </span>
                        <span className={colorClass}>{details ?? ""}</span>
                        <span>
                          <Clickable
                            className={`${colorClass} inline-flex items-center text-primary transition-colors`}
                            onClick={() => openDetailDialog(issue)}
                          >
                            <RiEyeLine size="1em" />
                          </Clickable>
                        </span>
                      </Fragment>
                    );
                  })}
                </div>
              </div>
              <div>
                {refreshTime && (
                  <div className="inline-flex items-center gap-2">
                    最近检查于: {new Date(refreshTime).toLocaleString()}
                    <Clickable onClick={() => void fetchData(true)}>
                      <RiRefreshLine size={"1em"} />
                    </Clickable>
                  </div>
                )}
              </div>
            </div>
          ) : error ? (
            <div className="px-10 h-full" key="error">
              <ErrorPage reason={error} reset={() => void fetchData(true)} />
            </div>
          ) : (
            <div className="h-full">
              <LoadingIndicator key="loading" />
            </div>
          )}
        </AutoTransition>
      </GridItem>

      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`检查详情 - ${selectedIssue?.message || ""}`}
        size="lg"
      >
        {selectedIssue && (
          <div className="px-6 py-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">检查项</label>
                <p className="text-sm">{selectedIssue.message}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">编码</label>
                <p className="text-sm font-mono">{selectedIssue.code}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">级别</label>
                <p className="text-sm">
                  {selectedIssue.severity.toUpperCase()}
                </p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">
                  本次结果
                </label>
                <p className="text-sm">
                  {formatResultText(
                    selectedIssue.code,
                    selectedIssue.details,
                    selectedCheck?.value,
                  )}
                </p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">
                  检查耗时
                </label>
                <p className="text-sm">
                  {selectedCheck ? `${selectedCheck.durationMs}ms` : "-"}
                </p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">
                  最近检查时间
                </label>
                <p className="text-sm">
                  {refreshTime
                    ? new Date(refreshTime).toLocaleString("zh-CN")
                    : "-"}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                趋势图
              </h3>
              {historyError ? (
                <p className="text-sm text-warning">{historyError}</p>
              ) : (
                <div className="h-[320px]">
                  <AreaChart
                    data={selectedChartData}
                    series={[
                      {
                        key: "value",
                        label: selectedIssue.message,
                        color: "var(--color-primary)",
                      },
                    ]}
                    className="w-full h-full"
                    timeGranularity="minute"
                    showYear="auto"
                    formatValue={(value) =>
                      formatChartValue(selectedIssue.code, value)
                    }
                  />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                历史记录
              </h3>
              <Table<DetailHistoryRow>
                columns={historyColumns}
                data={selectedHistoryRows}
                rowKey="id"
                size="sm"
                striped
                hoverable
                bordered={false}
                stickyHeader
                padding={1.5}
                emptyText="暂无该检查项历史记录"
              />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
