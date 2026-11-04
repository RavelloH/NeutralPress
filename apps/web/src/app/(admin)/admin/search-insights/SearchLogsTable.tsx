"use client";

import { useEffect, useState } from "react";
import { RiEyeLine } from "@remixicon/react";
import type { SearchLogItem } from "@repo/shared-types/api/search";

import type { FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getSearchLogs } from "@/lib/client/api/search-admin-read";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";

/**
 * 格式化地理位置信息
 */
function formatLocation(
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
  } | null,
): string {
  if (!location) return "未知";

  const parts: string[] = [];
  if (location.country) parts.push(location.country);
  if (location.region) parts.push(location.region);
  if (location.city) parts.push(location.city);

  return parts.length > 0 ? parts.join(" ") : "未知";
}

export default function SearchLogsTable() {
  const [data, setData] = useState<SearchLogItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<SearchLogItem | null>(null);

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "search-insight-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  // 打开详情对话框
  const openDetailDialog = (log: SearchLogItem) => {
    setSelectedLog(log);
    setDetailDialogOpen(true);
  };

  // 关闭详情对话框
  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedLog(null);
  };

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  // 处理筛选变化
  const handleFilterChange = (
    filters: Record<
      string,
      string | string[] | { start?: string; end?: string }
    >,
  ) => {
    setFilterValues(filters);
    setPage(1);
  };

  // 筛选配置
  const filterConfig: FilterConfig[] = [
    {
      key: "query",
      label: "搜索词",
      type: "input",
    },
    {
      key: "resultCount",
      label: "结果数范围",
      type: "range",
    },
    {
      key: "hasZeroResults",
      label: "无结果",
      type: "checkboxGroup",
      options: [{ value: "true", label: "仅显示无结果" }],
    },
    {
      key: "createdAt",
      label: "日期范围",
      type: "dateRange",
    },
  ];

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params: {
          page: number;
          pageSize: number;
          sortBy?: "id" | "createdAt" | "query" | "resultCount" | "durationMs";
          sortOrder?: "asc" | "desc";
          query?: string;
          minResultCount?: number;
          maxResultCount?: number;
          hasZeroResults?: boolean;
          dateFrom?: string;
          dateTo?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          if (
            sortKey === "id" ||
            sortKey === "createdAt" ||
            sortKey === "query" ||
            sortKey === "resultCount" ||
            sortKey === "durationMs"
          ) {
            params.sortBy = sortKey;
            params.sortOrder = sortOrder;
          }
        }

        // 添加筛选参数
        if (filterValues.query && typeof filterValues.query === "string") {
          params.query = filterValues.query;
        }

        if (filterValues.resultCount) {
          const resultRange = filterValues.resultCount as {
            start?: string;
            end?: string;
          };
          if (resultRange.start) {
            params.minResultCount = parseInt(resultRange.start);
          }
          if (resultRange.end) {
            params.maxResultCount = parseInt(resultRange.end);
          }
        }

        if (filterValues.hasZeroResults) {
          const hasZeroResultsValue = filterValues.hasZeroResults;
          if (
            Array.isArray(hasZeroResultsValue) &&
            hasZeroResultsValue.length === 1
          ) {
            params.hasZeroResults = hasZeroResultsValue[0] === "true";
          }
        }

        if (filterValues.createdAt) {
          const dateRange = filterValues.createdAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.dateFrom = dateRange.start;
          }
          if (dateRange.end) {
            params.dateTo = dateRange.end;
          }
        }

        const result = await getSearchLogs({
          ...params,
          sortBy: params.sortBy || "createdAt",
          sortOrder: params.sortOrder || "desc",
        });

        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch search logs:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [page, pageSize, sortKey, sortOrder, filterValues, refreshTrigger]);

  const columns: TableColumn<Record<string, unknown>>[] = [
    {
      key: "id",
      title: "ID",
      dataIndex: "id",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        return <span>{String(value)}</span>;
      },
    },
    {
      key: "createdAt",
      title: "搜索时间",
      dataIndex: "createdAt",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return new Date(value).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
        }
        return "-";
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
        if (typeof value === "number" && value > 0) {
          const colorClass =
            value > 1000
              ? "text-warning"
              : value > 500
                ? "text-warning"
                : "text-muted-foreground";
          return <span className={`text-xs ${colorClass}`}>{value} ms</span>;
        }
        return <span className="text-muted-foreground text-xs">-</span>;
      },
    },
    {
      key: "resultCount",
      title: "结果数",
      dataIndex: "resultCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        const count = typeof value === "number" ? value : 0;
        const colorClass =
          count === 0 ? "text-warning" : "text-muted-foreground";
        return (
          <span className={`text-sm font-medium ${colorClass}`}>{count}</span>
        );
      },
    },
    {
      key: "query",
      title: "搜索词",
      dataIndex: "query",
      width: "35em",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="font-medium font-mono text-sm">
            {String(value).slice(0, 50)}
          </span>
        );
      },
    },
    {
      key: "ip",
      title: "IP",
      dataIndex: "ip",
      render: (value) => {
        return (
          <span className="font-mono text-muted-foreground">
            {String(value || "-")}
          </span>
        );
      },
    },
    {
      key: "location",
      title: "归属地",
      dataIndex: "location",
      render: (value: unknown) => {
        return (
          <span className="font-mono text-muted-foreground">
            {String(formatLocation(value as SearchLogItem["location"])) || "-"}
          </span>
        );
      },
    },
    {
      key: "sessionId",
      title: "Session",
      dataIndex: "sessionId",
      align: "center",
      mono: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm font-mono">
            {value ? String(value).split("-")[0] : "-"}
          </span>
        );
      },
    },
    {
      key: "visitorId",
      title: "Visitor",
      dataIndex: "visitorId",
      align: "center",
      mono: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm font-mono">
            {value ? String(value).split("-")[0] : "-"}
          </span>
        );
      },
    },

    {
      key: "detail",
      title: "详情",
      dataIndex: "id",
      align: "center",
      render: (value: unknown, record: Record<string, unknown>) => {
        return (
          <Clickable
            onClick={() => openDetailDialog(record as unknown as SearchLogItem)}
            className="text-primary hover:text-primary/80 text-sm flex items-center justify-center gap-1"
          >
            <RiEyeLine size="1em" />
          </Clickable>
        );
      },
    },
  ];

  return (
    <>
      <GridTable
        title="搜索日志"
        columns={columns}
        data={data as unknown as Record<string, unknown>[]}
        loading={loading}
        rowKey="id"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        onRowClick={(record) =>
          openDetailDialog(record as unknown as SearchLogItem)
        }
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无搜索记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={false}
      />

      {/* 详情对话框 */}
      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`搜索日志详情 - ID: ${selectedLog?.id || ""}`}
        size="lg"
      >
        {selectedLog && (
          <div className="px-6 py-6 space-y-6">
            {/* 基本信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                基本信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">ID</label>
                  <p className="text-sm font-mono">{selectedLog.id}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    搜索时间
                  </label>
                  <p className="text-sm font-mono">
                    {new Date(selectedLog.createdAt).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    搜索词
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedLog.query}
                  </p>
                </div>
              </div>
            </div>

            {/* 搜索结果 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                搜索结果
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    结果数
                  </label>
                  <p className="text-sm font-semibold">
                    {selectedLog.resultCount} 个
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    搜索耗时
                  </label>
                  <p className="text-sm font-mono">
                    {selectedLog.durationMs
                      ? `${selectedLog.durationMs} ms`
                      : "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* 分词详情 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                分词结果（{selectedLog.tokens.length} 个）
              </h3>
              <div>
                {selectedLog.tokens.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedLog.tokens.map((token, i) => (
                      <span
                        key={`t-${token}-${i}`}
                        className="inline-block px-2 py-1 text-xs bg-primary/10 text-primary rounded-xs"
                      >
                        {token}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无分词结果</p>
                )}
              </div>
            </div>

            {/* 访客信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                访客信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    IP地址
                  </label>
                  <p className="text-sm font-mono">{selectedLog.ip || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    归属地
                  </label>
                  <p className="text-sm">
                    {selectedLog.location
                      ? formatLocation(selectedLog.location)
                      : "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    Session ID
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedLog.sessionId || "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    Visitor ID
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedLog.visitorId || "-"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
