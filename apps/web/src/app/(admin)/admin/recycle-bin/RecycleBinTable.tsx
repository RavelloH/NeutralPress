"use client";

import { useEffect, useMemo, useState } from "react";
import { RiCheckLine, RiDeleteBinLine } from "@remixicon/react";
import type {
  RecycleBinListItem,
  RecycleBinResourceType,
} from "@repo/shared-types/api/recycle-bin";

import {
  purgeRecycleBinItems,
  restoreRecycleBinItems,
} from "@/actions/recycle-bin";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getRecycleBinList } from "@/lib/client/api/recycle-bin-read";
import { AlertDialog } from "@/ui/AlertDialog";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

const REFRESH_EVENT = "recycle-bin-refresh";

const RESOURCE_TYPE_OPTIONS: Array<{
  value: RecycleBinResourceType;
  label: string;
}> = [
  { value: "PROJECT", label: "项目" },
  { value: "FRIEND_LINK", label: "友情链接" },
  { value: "POST", label: "文章" },
  { value: "PAGE", label: "页面" },
  { value: "COMMENT", label: "评论" },
  { value: "USER", label: "用户" },
  { value: "MESSAGE", label: "私信" },
];

export default function RecycleBinTable() {
  const toast = useToast();
  const [data, setData] = useState<RecycleBinListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("deletedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedRows, setSelectedRows] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [batchRestoreDialogOpen, setBatchRestoreDialogOpen] = useState(false);
  const [batchPurgeDialogOpen, setBatchPurgeDialogOpen] = useState(false);
  const [activeRecord, setActiveRecord] = useState<RecycleBinListItem | null>(
    null,
  );
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const selectedItems = useMemo(() => {
    const selectedSet = new Set(selectedRows.map((key) => String(key)));
    return data.filter((item) => selectedSet.has(item.key));
  }, [data, selectedRows]);

  const triggerRefresh = async () => {
    setRefreshTrigger((prev) => prev + 1);
    await broadcast({ type: REFRESH_EVENT });
  };

  const handleRestoreOne = async () => {
    if (!activeRecord) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await restoreRecycleBinItems({
        items: [
          { resourceType: activeRecord.resourceType, id: activeRecord.id },
        ],
      });

      if (!response.success || !response.data) {
        toast.error(response.message || "恢复失败，请稍后重试");
        return;
      }

      toast.success(`已恢复「${activeRecord.resourceName}」`);
      setRestoreDialogOpen(false);
      setActiveRecord(null);
      await triggerRefresh();
    } catch (error) {
      console.error("[RecycleBinTable] 恢复单条记录失败:", error);
      toast.error("恢复失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePurgeOne = async () => {
    if (!activeRecord) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await purgeRecycleBinItems({
        items: [
          { resourceType: activeRecord.resourceType, id: activeRecord.id },
        ],
      });

      if (!response.success || !response.data) {
        toast.error(response.message || "删除失败，请稍后重试");
        return;
      }

      toast.success(`已彻底删除「${activeRecord.resourceName}」`);
      setPurgeDialogOpen(false);
      setActiveRecord(null);
      await triggerRefresh();
    } catch (error) {
      console.error("[RecycleBinTable] 彻底删除单条记录失败:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchRestore = async () => {
    if (selectedItems.length === 0) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await restoreRecycleBinItems({
        items: selectedItems.map((item) => ({
          resourceType: item.resourceType,
          id: item.id,
        })),
      });

      if (!response.success || !response.data) {
        toast.error(response.message || "批量恢复失败，请稍后重试");
        return;
      }

      toast.success(`已恢复 ${response.data.restored} 条记录`);
      setBatchRestoreDialogOpen(false);
      setSelectedRows([]);
      await triggerRefresh();
    } catch (error) {
      console.error("[RecycleBinTable] 批量恢复失败:", error);
      toast.error("批量恢复失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchPurge = async () => {
    if (selectedItems.length === 0) {
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await purgeRecycleBinItems({
        items: selectedItems.map((item) => ({
          resourceType: item.resourceType,
          id: item.id,
        })),
      });

      if (!response.success || !response.data) {
        toast.error(response.message || "批量删除失败，请稍后重试");
        return;
      }

      toast.success(`已彻底删除 ${response.data.deleted} 条记录`);
      setBatchPurgeDialogOpen(false);
      setSelectedRows([]);
      await triggerRefresh();
    } catch (error) {
      console.error("[RecycleBinTable] 批量删除失败:", error);
      toast.error("批量删除失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  const handleSearchChange = (search: string) => {
    setSearchQuery(search);
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
      key: "resourceTypes",
      label: "资源类型",
      type: "checkboxGroup",
      options: RESOURCE_TYPE_OPTIONS,
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
    {
      key: "deletedAt",
      label: "删除时间",
      type: "dateRange",
      dateFields: { start: "deletedAtStart", end: "deletedAtEnd" },
    },
  ];

  const batchActions: ActionButton[] = [
    {
      label: "批量还原",
      onClick: () => setBatchRestoreDialogOpen(true),
      icon: <RiCheckLine size="1em" />,
      variant: "outline",
    },
    {
      label: "批量彻底删除",
      onClick: () => setBatchPurgeDialogOpen(true),
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  const rowActions = (record: RecycleBinListItem): ActionButton[] => [
    {
      label: "还原",
      onClick: () => {
        setActiveRecord(record);
        setRestoreDialogOpen(true);
      },
      icon: <RiCheckLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "彻底删除",
      onClick: () => {
        setActiveRecord(record);
        setPurgeDialogOpen(true);
      },
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === REFRESH_EVENT) {
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
          sortBy?: "deletedAt" | "createdAt" | "resourceType" | "resourceName";
          sortOrder?: "asc" | "desc";
          search?: string;
          resourceTypes?: RecycleBinResourceType[];
          createdAtStart?: string;
          createdAtEnd?: string;
          deletedAtStart?: string;
          deletedAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "deletedAt"
            | "createdAt"
            | "resourceType"
            | "resourceName";
          params.sortOrder = sortOrder;
        }

        if (searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        if (
          filterValues.resourceTypes &&
          Array.isArray(filterValues.resourceTypes) &&
          filterValues.resourceTypes.length > 0
        ) {
          const allowedTypes = new Set(
            RESOURCE_TYPE_OPTIONS.map((option) => option.value),
          );
          params.resourceTypes = filterValues.resourceTypes.filter((value) =>
            allowedTypes.has(value as RecycleBinResourceType),
          ) as RecycleBinResourceType[];
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

        if (
          filterValues.deletedAt &&
          typeof filterValues.deletedAt === "object"
        ) {
          const dateRange = filterValues.deletedAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.deletedAtStart = dateRange.start;
          }
          if (dateRange.end) {
            params.deletedAtEnd = dateRange.end;
          }
        }

        const response = await getRecycleBinList(params);

        if (response.success && response.data) {
          setData(response.data);
          setTotalRecords(response.meta?.total || 0);
          setTotalPages(response.meta?.totalPages || 1);
        } else {
          setData([]);
          setTotalRecords(0);
          setTotalPages(1);
        }
      } catch (error) {
        console.error("[RecycleBinTable] 获取回收站列表失败:", error);
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

  const columns: TableColumn<RecycleBinListItem>[] = [
    {
      key: "resourceType",
      title: "资源类型",
      dataIndex: "resourceTypeLabel",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return <span className="text-sm">{String(value)}</span>;
      },
    },
    {
      key: "resourceName",
      title: "资源名",
      dataIndex: "resourceName",
      align: "left",
      sortable: true,
      render: (value: unknown, record: RecycleBinListItem) => {
        return (
          <div className="min-w-0">
            <div className="font-medium truncate">{String(value)}</div>
            <div className="text-xs text-muted-foreground truncate">
              {record.resourceReference || "-"}
            </div>
          </div>
        );
      },
    },
    {
      key: "createdAt",
      title: "创建时间",
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
          });
        }
        return "-";
      },
    },
    {
      key: "deletedAt",
      title: "删除时间",
      dataIndex: "deletedAt",
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
          });
        }
        return "-";
      },
    },
    {
      key: "deletedByName",
      title: "操作人",
      dataIndex: "deletedByName",
      align: "left",
      render: (value: unknown, record: RecycleBinListItem) => {
        const uidText =
          typeof record.deletedByUid === "number"
            ? `UID: ${record.deletedByUid}`
            : "UID: -";
        return (
          <div className="min-w-0">
            <div className="font-medium truncate">{String(value)}</div>
            <div className="text-xs text-muted-foreground truncate">
              {uidText}
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <GridTable<RecycleBinListItem>
        title="回收站记录"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="key"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        onSearchChange={handleSearchChange}
        searchPlaceholder="搜索资源名称、Slug 或 URL..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="回收站为空"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={setSelectedRows}
      />

      <AlertDialog
        open={restoreDialogOpen}
        onClose={() => {
          setRestoreDialogOpen(false);
          setActiveRecord(null);
        }}
        onConfirm={handleRestoreOne}
        title="确认还原记录"
        description={
          activeRecord
            ? `确定要还原「${activeRecord.resourceName}」吗？`
            : "确定要还原这条记录吗？"
        }
        confirmText="还原"
        cancelText="取消"
        variant="info"
        loading={isSubmitting}
      />

      <AlertDialog
        open={purgeDialogOpen}
        onClose={() => {
          setPurgeDialogOpen(false);
          setActiveRecord(null);
        }}
        onConfirm={handlePurgeOne}
        title="确认彻底删除"
        description={
          activeRecord
            ? `确定要彻底删除「${activeRecord.resourceName}」吗？此操作不可恢复。`
            : "确定要彻底删除这条记录吗？此操作不可恢复。"
        }
        confirmText="彻底删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      <AlertDialog
        open={batchRestoreDialogOpen}
        onClose={() => setBatchRestoreDialogOpen(false)}
        onConfirm={handleBatchRestore}
        title="确认批量还原"
        description={`确定要还原选中的 ${selectedItems.length} 条记录吗？`}
        confirmText="还原"
        cancelText="取消"
        variant="info"
        loading={isSubmitting}
      />

      <AlertDialog
        open={batchPurgeDialogOpen}
        onClose={() => setBatchPurgeDialogOpen(false)}
        onConfirm={handleBatchPurge}
        title="确认批量彻底删除"
        description={`确定要彻底删除选中的 ${selectedItems.length} 条记录吗？此操作不可恢复。`}
        confirmText="彻底删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />
    </>
  );
}
