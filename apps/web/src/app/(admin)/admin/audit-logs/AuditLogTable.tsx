"use client";

import { useEffect, useState } from "react";
import { RiEyeLine } from "@remixicon/react";
import type { AuditLogItem } from "@repo/shared-types/api/audit";
import { codeToHtml } from "shiki";

import type { FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getAuditLogs } from "@/lib/client/api/audit";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";

/**
 * 检查值是否为空（null、空对象、空字符串）
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

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

/**
 * JSON 代码高亮组件
 */
function JSONHighlight({ json }: { json: unknown }) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    const highlightCode = async () => {
      try {
        const jsonString = JSON.stringify(json, null, 2);
        const highlighted = await codeToHtml(jsonString, {
          lang: "json",
          themes: {
            light: "dark-plus",
            dark: "dark-plus",
          },
        });
        setHtml(highlighted);
      } catch (err) {
        console.error("Shiki 高亮错误:", err);
        const jsonString = JSON.stringify(json, null, 2);
        setHtml(`${jsonString.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`);
      }
    };
    highlightCode();
  }, [json]);

  return (
    <div className="text-xs overflow-auto max-h-64 rounded-lg ">
      <pre className="shiki bg-[#1E1E1E] p-4 rounded-lg overflow-x-auto">
        <code dangerouslySetInnerHTML={{ __html: html }}></code>
      </pre>
    </div>
  );
}

export default function AuditLogTable() {
  const [data, setData] = useState<AuditLogItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1); // 排序变化时重置到第一页
  };

  // 处理搜索变化
  const handleSearchChange = (search: string) => {
    // 只有当搜索内容真正变化时才更新状态和重置页码
    if (search !== searchQuery) {
      setSearchQuery(search);
      setPage(1); // 搜索变化时重置到第一页
    }
  };

  // 处理筛选变化
  const handleFilterChange = (
    filters: Record<
      string,
      string | string[] | { start?: string; end?: string }
    >,
  ) => {
    setFilterValues(filters);
    setPage(1); // 筛选变化时重置到第一页
  };

  // 筛选配置
  const filterConfig: FilterConfig[] = [
    {
      key: "id",
      label: "日志 ID",
      type: "input",
      inputType: "number",
      placeholder: "输入日志 ID",
    },
    {
      key: "action",
      label: "操作类型",
      type: "input",
      inputType: "text",
      placeholder: "例如：CREATE、UPDATE、DELETE",
    },
    {
      key: "resource",
      label: "资源类型",
      type: "input",
      inputType: "text",
      placeholder: "例如：POST、USER、COMMENT",
    },
    {
      key: "userUid",
      label: "操作者 UID",
      type: "input",
      inputType: "number",
      placeholder: "输入用户 UID",
    },
    {
      key: "timestamp",
      label: "操作时间",
      type: "dateRange",
      dateFields: { start: "timestampStart", end: "timestampEnd" },
    },
  ];

  // 打开详情对话框
  const openDetailDialog = (log: AuditLogItem) => {
    setSelectedLog(log);
    setDetailDialogOpen(true);
  };

  // 关闭详情对话框
  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedLog(null);
  };

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "audit-refresh") {
      setRefreshTrigger((prev) => prev + 1); // 触发刷新
    }
  });

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // 构建请求参数
        const params: {
          page: number;
          pageSize: number;
          sortBy?: "id" | "timestamp" | "action" | "resource" | "userUid";
          sortOrder?: "asc" | "desc";
          search?: string;
          id?: number;
          action?: string;
          resource?: string;
          userUid?: number;
          timestampStart?: string;
          timestampEnd?: string;
        } = {
          page,
          pageSize,
        };

        // 只在有有效的排序参数时才添加
        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "id"
            | "timestamp"
            | "action"
            | "resource"
            | "userUid";
          params.sortOrder = sortOrder;
        }

        // 添加搜索参数（全局搜索）
        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        if (filterValues.id && typeof filterValues.id === "string") {
          params.id = parseInt(filterValues.id, 10);
        }

        if (filterValues.action && typeof filterValues.action === "string") {
          params.action = filterValues.action.trim();
        }

        if (
          filterValues.resource &&
          typeof filterValues.resource === "string"
        ) {
          params.resource = filterValues.resource.trim();
        }

        if (filterValues.userUid && typeof filterValues.userUid === "string") {
          params.userUid = parseInt(filterValues.userUid, 10);
        }

        if (
          filterValues.timestamp &&
          typeof filterValues.timestamp === "object"
        ) {
          const dateRange = filterValues.timestamp as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.timestampStart = dateRange.start;
          }
          if (dateRange.end) {
            params.timestampEnd = dateRange.end;
          }
        }

        const result = await getAuditLogs(params);

        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch audit logs:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [
    page,
    pageSize,
    sortKey,
    sortOrder,
    searchQuery,
    filterValues,
    refreshTrigger,
  ]);

  const columns: TableColumn<AuditLogItem>[] = [
    {
      key: "id",
      title: "ID",
      dataIndex: "id",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "timestamp",
      title: "操作时间",
      dataIndex: "timestamp",
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
      key: "action",
      title: "操作类型",
      dataIndex: "action",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return <span className="font-semibold">{value}</span>;
        }
        return "-";
      },
    },
    {
      key: "resource",
      title: "资源类型",
      dataIndex: "resource",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "resourceId",
      title: "资源ID",
      dataIndex: "resourceId",
      align: "left",
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string" && value.length > 20) {
          return (
            <span className="text-sm text-muted-foreground" title={value}>
              {value.substring(0, 20)}...
            </span>
          );
        }
        return (
          <span className="text-sm text-muted-foreground">{String(value)}</span>
        );
      },
    },
    {
      key: "user",
      title: "操作者",
      dataIndex: "user",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        if (value && typeof value === "object" && "username" in value) {
          const user = value as { username: string; nickname?: string | null };
          return (
            <span className="text-sm">
              {user.nickname || user.username}
              <span className="text-muted-foreground ml-1">
                (@{user.username})
              </span>
            </span>
          );
        }
        return <span className="text-muted-foreground">系统</span>;
      },
    },
    {
      key: "ipAddress",
      title: "IP地址",
      dataIndex: "ipAddress",
      align: "left",
      mono: true,
    },
    {
      key: "location",
      title: "归属地",
      dataIndex: "location",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="text-sm text-muted-foreground">
            {String(formatLocation(value as AuditLogItem["location"]) || "-")}
          </span>
        );
      },
    },
    {
      key: "description",
      title: "描述",
      dataIndex: "description",
      align: "left",
      render: (value: unknown) => {
        if (typeof value === "string" && value) {
          return <span className="text-sm">{value}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: "detail",
      title: "详情",
      dataIndex: "id",
      align: "center",
      render: (value: unknown, record: AuditLogItem) => {
        return (
          <Clickable
            onClick={() => openDetailDialog(record)}
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
        title="审计日志"
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
        onSearchChange={handleSearchChange}
        onRowClick={(record) => openDetailDialog(record)}
        searchPlaceholder="搜索..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无审计日志"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
      />

      {/* 详情对话框 */}
      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`审计日志详情 - ID: ${selectedLog?.id || ""}`}
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
                    操作时间
                  </label>
                  <p className="text-sm font-mono">
                    {new Date(selectedLog.timestamp).toLocaleString("zh-CN", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    操作类型
                  </label>
                  <p className="text-sm font-semibold">{selectedLog.action}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    资源类型
                  </label>
                  <p className="text-sm">{selectedLog.resource}</p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    资源ID
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedLog.resourceId}
                  </p>
                </div>
              </div>
            </div>

            {/* 操作者信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                操作者信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">用户</label>
                  <p className="text-sm">
                    {selectedLog.user ? (
                      <>
                        {selectedLog.user.nickname || selectedLog.user.username}
                        <span className="text-muted-foreground ml-1">
                          (@{selectedLog.user.username}, UID:{" "}
                          {selectedLog.user.uid})
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">系统操作</span>
                    )}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    IP地址
                  </label>
                  <p className="text-sm font-mono">
                    {selectedLog.ipAddress}
                    {selectedLog.location ? (
                      <span className="text-muted-foreground ml-2">
                        ({formatLocation(selectedLog.location)})
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    User Agent
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedLog.userAgent || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* 操作描述 */}
            {selectedLog.description && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                  操作描述
                </h3>
                <p className="text-sm">{selectedLog.description}</p>
              </div>
            )}

            {/* Metadata 元数据 */}
            {selectedLog.metadata && !isEmpty(selectedLog.metadata) && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                  元数据 (Metadata)
                </h3>
                <JSONHighlight json={selectedLog.metadata} />
              </div>
            )}

            {/* 数据变更 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                数据变更
              </h3>
              {(() => {
                // 解析 oldData 和 newData
                let oldData: unknown = selectedLog.oldData;
                let newData: unknown = selectedLog.newData;

                // 如果是字符串，尝试解析为 JSON
                if (typeof oldData === "string") {
                  try {
                    oldData = JSON.parse(oldData);
                  } catch {
                    // 解析失败，保持原字符串
                  }
                }
                if (typeof newData === "string") {
                  try {
                    newData = JSON.parse(newData);
                  } catch {
                    // 解析失败，保持原字符串
                  }
                }

                const oldIsEmpty = isEmpty(oldData);
                const newIsEmpty = isEmpty(newData);

                // 如果两者都为空，显示提示信息
                if (oldIsEmpty && newIsEmpty) {
                  return (
                    <p className="text-sm text-muted-foreground">无数据变更</p>
                  );
                }

                // 如果其中一个为空，让另一个占据全部宽度
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {!oldIsEmpty && (
                      <div className={newIsEmpty ? "md:col-span-2" : ""}>
                        <label className="text-sm text-muted-foreground mb-2 block h-6">
                          变更前 (Old Data)
                        </label>
                        <JSONHighlight json={oldData} />
                      </div>
                    )}
                    {!newIsEmpty && (
                      <div className={oldIsEmpty ? "md:col-span-2" : ""}>
                        <label className="text-sm text-muted-foreground mb-2 block h-6">
                          变更后 (New Data)
                        </label>
                        <JSONHighlight json={newData} />
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
