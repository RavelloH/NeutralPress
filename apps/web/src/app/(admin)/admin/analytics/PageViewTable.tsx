"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiEyeLine } from "@remixicon/react";
import type { PageViewItem } from "@repo/shared-types";

import type { FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { getPageViews } from "@/lib/client/api/analytics-read";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import type { TableColumn } from "@/ui/Table";

function formatStayDuration(duration: number | null | undefined): string {
  if (typeof duration !== "number") {
    return "-";
  }
  if (duration === 0) {
    return "从此页退出";
  }
  return `${duration} 秒`;
}

type TableFilterValues = Record<
  string,
  string | string[] | { start?: string; end?: string }
>;

export interface AnalyticsTableQuery {
  search?: string;
  path?: string;
  visitorId?: string;
  country?: string;
  region?: string;
  city?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  referer?: string;
  screenSize?: string;
  language?: string;
  timestampStart?: string;
  timestampEnd?: string;
}

export type AnalyticsQuickFilterField =
  | "path"
  | "referer"
  | "browser"
  | "os"
  | "deviceType"
  | "screenSize"
  | "language"
  | "country"
  | "region"
  | "city";

export interface AnalyticsQuickFilterRequest {
  token: number;
  field: AnalyticsQuickFilterField;
  value: string;
}

export interface AnalyticsFilterSummary {
  activeCount: number;
  text: string;
}

interface PageViewTableProps {
  onQueryChange?: (query: AnalyticsTableQuery) => void;
  onFilterSummaryChange?: (summary: AnalyticsFilterSummary) => void;
  requestOpenFilterToken?: number;
  quickFilterRequest?: AnalyticsQuickFilterRequest | null;
}

function normalizeFilterText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

const FILTER_LABEL_MAP: Record<string, string> = {
  path: "访问路径",
  referer: "流量来源",
  visitorId: "访客ID",
  country: "国家",
  region: "地区",
  city: "城市",
  deviceType: "设备类型",
  browser: "浏览器",
  os: "操作系统",
  screenSize: "屏幕尺寸",
  language: "语言",
  timestamp: "访问时间",
};

function formatFilterCondition(
  key: string,
  value: string | string[] | { start?: string; end?: string },
): string | null {
  const label = FILTER_LABEL_MAP[key] || key;

  if (typeof value === "string") {
    const normalizedValue = normalizeFilterText(value);
    if (!normalizedValue) return null;
    return `${label} = ${normalizedValue}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `${label} = ${value.join("、")}`;
  }

  if (value && typeof value === "object") {
    const start = normalizeFilterText(value.start);
    const end = normalizeFilterText(value.end);
    if (start && end) {
      return `${label} = ${start} ~ ${end}`;
    }
    if (start) {
      return `${label} >= ${start}`;
    }
    if (end) {
      return `${label} <= ${end}`;
    }
  }

  return null;
}

function buildFilterSummary(
  filterValues: TableFilterValues,
): AnalyticsFilterSummary {
  const conditions: string[] = [];

  for (const [key, value] of Object.entries(filterValues)) {
    const condition = formatFilterCondition(key, value);
    if (condition) {
      conditions.push(condition);
    }
  }

  if (conditions.length === 1) {
    return {
      activeCount: 1,
      text: conditions[0]!,
    };
  }

  if (conditions.length > 1) {
    return {
      activeCount: conditions.length,
      text: `${conditions.length} 个筛选条件`,
    };
  }

  return {
    activeCount: 0,
    text: "筛选",
  };
}

function syncFilterValuesToUrl(
  filterConfig: FilterConfig[],
  filters: TableFilterValues,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const params = url.searchParams;

  // 清除旧筛选参数
  filterConfig.forEach((config) => {
    params.delete(config.key);
    if (config.type === "dateRange" && config.dateFields) {
      params.delete(config.dateFields.start);
      params.delete(config.dateFields.end);
    }
  });

  // 写入新筛选参数
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        params.set(key, value.join(","));
      }
      return;
    }

    if (typeof value === "object" && value !== null && "start" in value) {
      const config = filterConfig.find((item) => item.key === key);
      if (config?.type === "dateRange" && config.dateFields) {
        if (value.start) {
          params.set(config.dateFields.start, value.start);
        }
        if (value.end) {
          params.set(config.dateFields.end, value.end);
        }
      }
      return;
    }

    const normalized = normalizeFilterText(String(value));
    if (normalized) {
      params.set(key, normalized);
    }
  });

  window.history.pushState({}, "", url.toString());
}

function buildAnalyticsTableQuery(
  searchQuery: string,
  filterValues: TableFilterValues,
): AnalyticsTableQuery {
  const query: AnalyticsTableQuery = {};

  const search = normalizeFilterText(searchQuery);
  if (search) {
    query.search = search;
  }

  const path =
    typeof filterValues.path === "string"
      ? normalizeFilterText(filterValues.path)
      : undefined;
  if (path) {
    query.path = path;
  }

  const visitorId =
    typeof filterValues.visitorId === "string"
      ? normalizeFilterText(filterValues.visitorId)
      : undefined;
  if (visitorId) {
    query.visitorId = visitorId;
  }

  const country =
    typeof filterValues.country === "string"
      ? normalizeFilterText(filterValues.country)
      : undefined;
  if (country) {
    query.country = country;
  }

  const region =
    typeof filterValues.region === "string"
      ? normalizeFilterText(filterValues.region)
      : undefined;
  if (region) {
    query.region = region;
  }

  const city =
    typeof filterValues.city === "string"
      ? normalizeFilterText(filterValues.city)
      : undefined;
  if (city) {
    query.city = city;
  }

  const deviceType =
    typeof filterValues.deviceType === "string"
      ? normalizeFilterText(filterValues.deviceType)
      : undefined;
  if (deviceType) {
    query.deviceType = deviceType;
  }

  const browser =
    typeof filterValues.browser === "string"
      ? normalizeFilterText(filterValues.browser)
      : undefined;
  if (browser) {
    query.browser = browser;
  }

  const os =
    typeof filterValues.os === "string"
      ? normalizeFilterText(filterValues.os)
      : undefined;
  if (os) {
    query.os = os;
  }

  const referer =
    typeof filterValues.referer === "string"
      ? normalizeFilterText(filterValues.referer)
      : undefined;
  if (referer) {
    query.referer = referer;
  }

  const screenSize =
    typeof filterValues.screenSize === "string"
      ? normalizeFilterText(filterValues.screenSize)
      : undefined;
  if (screenSize) {
    query.screenSize = screenSize;
  }

  const language =
    typeof filterValues.language === "string"
      ? normalizeFilterText(filterValues.language)
      : undefined;
  if (language) {
    query.language = language;
  }

  if (filterValues.timestamp && typeof filterValues.timestamp === "object") {
    const dateRange = filterValues.timestamp as {
      start?: string;
      end?: string;
    };
    const timestampStart = normalizeFilterText(dateRange.start);
    const timestampEnd = normalizeFilterText(dateRange.end);
    if (timestampStart) {
      query.timestampStart = timestampStart;
    }
    if (timestampEnd) {
      query.timestampEnd = timestampEnd;
    }
  }

  return query;
}

export default function PageViewTable({
  onQueryChange,
  onFilterSummaryChange,
  requestOpenFilterToken,
  quickFilterRequest,
}: PageViewTableProps) {
  const [data, setData] = useState<PageViewItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<TableFilterValues>({});
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedView, setSelectedView] = useState<PageViewItem | null>(null);
  const lastQuickFilterTokenRef = useRef<number | undefined>(undefined);

  const query = useMemo(
    () => buildAnalyticsTableQuery(searchQuery, filterValues),
    [searchQuery, filterValues],
  );
  const filterSummary = useMemo(
    () => buildFilterSummary(filterValues),
    [filterValues],
  );

  useEffect(() => {
    onQueryChange?.(query);
  }, [onQueryChange, query]);

  useEffect(() => {
    onFilterSummaryChange?.(filterSummary);
  }, [onFilterSummaryChange, filterSummary]);

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  // 处理搜索变化
  const handleSearchChange = (search: string) => {
    if (search !== searchQuery) {
      setSearchQuery(search);
      setPage(1);
    }
  };

  // 处理筛选变化
  const handleFilterChange = (filters: TableFilterValues) => {
    setFilterValues(filters);
    setPage(1);
  };

  // 筛选配置
  const filterConfig: FilterConfig[] = useMemo(
    () => [
      {
        key: "path",
        label: "访问路径",
        type: "input",
        inputType: "text",
        placeholder: "例如：/posts/example",
      },
      {
        key: "visitorId",
        label: "访客ID",
        type: "input",
        inputType: "text",
        placeholder: "输入访客ID",
      },
      {
        key: "country",
        label: "国家",
        type: "input",
        inputType: "text",
        placeholder: "例如：中国",
      },
      {
        key: "region",
        label: "地区",
        type: "input",
        inputType: "text",
        placeholder: "例如：北京",
      },
      {
        key: "city",
        label: "城市",
        type: "input",
        inputType: "text",
        placeholder: "例如：北京",
      },
      {
        key: "deviceType",
        label: "设备类型",
        type: "input",
        inputType: "text",
        placeholder: "例如：mobile、desktop",
      },
      {
        key: "browser",
        label: "浏览器",
        type: "input",
        inputType: "text",
        placeholder: "例如：Chrome、Firefox",
      },
      {
        key: "os",
        label: "操作系统",
        type: "input",
        inputType: "text",
        placeholder: "例如：Windows、iOS",
      },
      {
        key: "referer",
        label: "流量来源",
        type: "input",
        inputType: "text",
        placeholder: "例如：google.com",
      },
      {
        key: "screenSize",
        label: "屏幕尺寸",
        type: "input",
        inputType: "text",
        placeholder: "例如：1920x1080",
      },
      {
        key: "language",
        label: "语言",
        type: "input",
        inputType: "text",
        placeholder: "例如：zh-CN",
      },
      {
        key: "timestamp",
        label: "访问时间",
        type: "dateRange",
        dateFields: { start: "timestampStart", end: "timestampEnd" },
      },
    ],
    [],
  );

  // 外部快速筛选（点击路径/维度）：同值二次点击会取消该筛选，并同步 URL
  useEffect(() => {
    if (!quickFilterRequest) {
      return;
    }
    if (lastQuickFilterTokenRef.current === quickFilterRequest.token) {
      return;
    }
    lastQuickFilterTokenRef.current = quickFilterRequest.token;

    const normalizedValue = normalizeFilterText(quickFilterRequest.value);
    if (!normalizedValue) {
      return;
    }

    const currentValue = filterValues[quickFilterRequest.field];
    const currentNormalized =
      typeof currentValue === "string"
        ? normalizeFilterText(currentValue)
        : undefined;

    const nextFilters: TableFilterValues = { ...filterValues };
    if (currentNormalized === normalizedValue) {
      delete nextFilters[quickFilterRequest.field];
    } else {
      nextFilters[quickFilterRequest.field] = normalizedValue;
    }

    setFilterValues(nextFilters);
    syncFilterValuesToUrl(filterConfig, nextFilters);
    setPage(1);
  }, [quickFilterRequest, filterConfig, filterValues]);

  // 打开详情对话框
  const openDetailDialog = (view: PageViewItem) => {
    setSelectedView(view);
    setDetailDialogOpen(true);
  };

  // 关闭详情对话框
  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setSelectedView(null);
  };

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const params: {
          page: number;
          pageSize: number;
          sortBy?:
            | "id"
            | "timestamp"
            | "path"
            | "visitorId"
            | "country"
            | "city";
          sortOrder?: "asc" | "desc";
        } & AnalyticsTableQuery = {
          page,
          pageSize,
          ...query,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "id"
            | "timestamp"
            | "path"
            | "visitorId"
            | "country"
            | "city";
          params.sortOrder = sortOrder;
        }

        const result = await getPageViews(params);

        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch page views:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [page, pageSize, sortKey, sortOrder, query]);

  const columns: TableColumn<PageViewItem>[] = [
    {
      key: "timestamp",
      title: "访问时间",
      dataIndex: "timestamp",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string" || value instanceof Date) {
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
      key: "path",
      title: "访问路径",
      dataIndex: "path",
      width: "45em",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          if (value.length > 60) {
            return (
              <span className="text-sm" title={value}>
                {value.substring(0, 60)}...
              </span>
            );
          }
          return <span className="text-sm">{value}</span>;
        }
        return "-";
      },
    },
    {
      key: "visitorId",
      title: "访客短 ID",
      dataIndex: "visitorId",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        if (typeof value === "string") {
          return (
            <span className="text-muted-foreground" title={value}>
              {value.split("-")[0]}
            </span>
          );
        }
        return "-";
      },
    },
    {
      key: "country",
      title: "国家",
      dataIndex: "country",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value ? (
              String(value)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        );
      },
    },
    {
      key: "region",
      title: "地区",
      dataIndex: "region",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value ? (
              String(value)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        );
      },
    },
    {
      key: "city",
      title: "城市",
      dataIndex: "city",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value ? (
              String(value)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        );
      },
    },
    {
      key: "deviceType",
      title: "设备",
      dataIndex: "deviceType",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value ? (
              String(value)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        );
      },
    },
    {
      key: "browser",
      title: "浏览器",
      dataIndex: "browser",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value ? (
              String(value)
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </span>
        );
      },
    },
    {
      key: "detail",
      title: "详情",
      dataIndex: "id",
      align: "center",
      render: (value: unknown, record: PageViewItem) => {
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
        title="访问记录"
        columns={columns as unknown as TableColumn<Record<string, unknown>>[]}
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
        onSearchChange={handleSearchChange}
        onRowClick={(record) =>
          openDetailDialog(record as unknown as PageViewItem)
        }
        searchPlaceholder="搜索路径、访客ID、国家、城市..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        externalFilterOpenToken={requestOpenFilterToken}
        externalFilterValues={filterValues}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无访问记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
      />

      {/* 详情对话框 */}
      <Dialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        title={`访问记录详情 - ID: ${selectedView?.id || ""}`}
        size="lg"
      >
        {selectedView && (
          <div className="px-6 py-6 space-y-6">
            {/* 基本信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                基本信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">ID</label>
                  <p className="text-sm font-mono">{selectedView.id}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    访问时间
                  </label>
                  <p className="text-sm font-mono">
                    {new Date(selectedView.timestamp).toLocaleString("zh-CN", {
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
                    访问路径
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedView.path}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    访客ID
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedView.visitorId}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    IP地址
                  </label>
                  <p className="text-sm font-mono">{selectedView.ipAddress}</p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    来源页面
                  </label>
                  <p className="text-sm font-mono break-all">
                    {selectedView.referer || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* 地理位置信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                地理位置
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    归属地
                  </label>
                  <p className="text-sm flex gap-2">
                    <span>{selectedView.country}</span>
                    <span>{selectedView.region}</span>
                    <span>{selectedView.city}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* 设备与浏览器信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                设备与浏览器
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">
                    设备类型
                  </label>
                  <p className="text-sm">{selectedView.deviceType || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    浏览器
                  </label>
                  <p className="text-sm">{selectedView.browser || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    浏览器版本
                  </label>
                  <p className="text-sm">
                    {selectedView.browserVersion || "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    操作系统
                  </label>
                  <p className="text-sm">{selectedView.os || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    系统版本
                  </label>
                  <p className="text-sm">{selectedView.osVersion || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    屏幕尺寸
                  </label>
                  <p className="text-sm">{selectedView.screenSize || "-"}</p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-muted-foreground">
                    完整 UA
                  </label>
                  <p className="text-sm font-mono break-all whitespace-pre-wrap">
                    {selectedView.userAgent || "-"}
                  </p>
                </div>
              </div>
            </div>

            {/* 其他信息 */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
                其他信息
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">语言</label>
                  <p className="text-sm">{selectedView.language || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">时区</label>
                  <p className="text-sm">{selectedView.timezone || "-"}</p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">
                    停留时长
                  </label>
                  <p className="text-sm">
                    {formatStayDuration(selectedView.duration)}
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
