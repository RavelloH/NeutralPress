"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiRefreshLine,
} from "@remixicon/react";
import type {
  FriendLinkListItem,
  FriendLinkStatus,
} from "@repo/shared-types/api/friendlink";

import {
  checkFriendLinks,
  deleteFriendLinkByAdmin,
  getFriendLinksList,
} from "@/actions/friendlink";
import FriendLinkEditDialog from "@/app/(admin)/admin/friends/FriendLinkEditDialog";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { formatDateTimeLocale } from "@/lib/shared/date-format";
import { AlertDialog } from "@/ui/AlertDialog";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

type SortKey =
  | "id"
  | "name"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "publishedAt"
  | "lastCheckedAt"
  | "avgResponseTime"
  | "checkFailureCount"
  | "checkSuccessCount";

type PendingAction = {
  type: "check";
  ids: number[];
  checkAll: boolean;
};

type PendingDelete = {
  id: number;
  name: string;
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

const statusClassName: Record<FriendLinkStatus, string> = {
  PENDING: "text-warning",
  PUBLISHED: "text-success",
  WHITELIST: "text-primary",
  REJECTED: "text-muted-foreground",
  DISCONNECT: "text-error",
  NO_BACKLINK: "text-error",
  BLOCKED: "text-error",
};

function getRateClass(rate: number): string {
  if (rate >= 90) return "text-foreground";
  if (rate >= 50) return "text-warning";
  return "text-error";
}

function formatRate(successCount: number, totalCount: number): string {
  if (totalCount <= 0) return "-";
  return `${((successCount / totalCount) * 100).toFixed(1)}%`;
}

export default function FriendsTable() {
  const toast = useToast();
  const { broadcast } = useBroadcastSender<{ type: string }>();

  const [data, setData] = useState<FriendLinkListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(
    new Set(),
  );
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("确认检查");
  const [dialogDescription, setDialogDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dialogVariant, setDialogVariant] = useState<
    "danger" | "warning" | "info"
  >("info");
  const [dialogConfirmText, setDialogConfirmText] = useState("确认");

  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [viewingName, setViewingName] = useState<string>("");

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  const selectedIds = useMemo(
    () => Array.from(selectedKeys).map((key) => Number(key)),
    [selectedKeys],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const hasIssueFilter =
        Array.isArray(filterValues.hasIssue) && filterValues.hasIssue.length > 0
          ? filterValues.hasIssue[0] === "true"
          : undefined;
      const ignoreBacklinkFilter =
        Array.isArray(filterValues.ignoreBacklink) &&
        filterValues.ignoreBacklink.length > 0
          ? filterValues.ignoreBacklink[0] === "true"
          : undefined;

      const result = await getFriendLinksList({
        page,
        pageSize,
        sortBy: sortKey,
        sortOrder,
        search: search.trim() || undefined,
        status: Array.isArray(filterValues.status)
          ? (filterValues.status as FriendLinkStatus[])
          : undefined,
        hasIssue: hasIssueFilter,
        ignoreBacklink: ignoreBacklinkFilter,
      });

      if (result.success && result.data) {
        setData(result.data);
        setTotalPages(result.meta?.totalPages || 1);
        setTotalRecords(result.meta?.total || 0);
      } else {
        toast.error(result.message || "获取友链列表失败");
      }
    } catch (error) {
      console.error("[FriendsTable] 获取列表失败:", error);
      toast.error("获取友链列表失败");
    } finally {
      setLoading(false);
    }
  }, [filterValues, page, pageSize, search, sortKey, sortOrder, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, refreshTrigger]);

  useBroadcast<{ type: string }>((message) => {
    if (message.type === "friends-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  const executeCheck = useCallback(
    async (ids: number[], checkAll: boolean) => {
      const result = await checkFriendLinks({
        ids: checkAll ? undefined : ids,
        checkAll,
      });

      if (!result.success || !result.data) {
        toast.error(result.message || "友链检查失败");
        return;
      }

      const { checked, skipped, failed, statusChanged } = result.data;
      toast.success(
        `检查完成：检查 ${checked}，跳过 ${skipped}，异常 ${failed}，状态变更 ${statusChanged}`,
      );
    },
    [toast],
  );

  const openCheckDialog = useCallback(
    (ids: number[], description: string, title = "确认检查") => {
      setDialogTitle(title);
      setDialogDescription(description);
      setDialogVariant("info");
      setDialogConfirmText("确认");
      setPendingAction({
        type: "check",
        ids,
        checkAll: false,
      });
      setPendingDelete(null);
      setDialogOpen(true);
    },
    [],
  );

  const openDeleteDialog = useCallback((item: FriendLinkListItem) => {
    setDialogTitle("确认删除友链");
    setDialogDescription(`确定要删除「${item.name}」吗？删除后不可恢复。`);
    setDialogVariant("danger");
    setDialogConfirmText("确认删除");
    setPendingAction(null);
    setPendingDelete({ id: item.id, name: item.name });
    setDialogOpen(true);
  }, []);

  const openViewDialog = useCallback((item: FriendLinkListItem) => {
    setViewingId(item.id);
    setViewingName(item.name);
    setViewDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((item: FriendLinkListItem) => {
    setEditingId(item.id);
    setEditingName(item.name);
    setEditDialogOpen(true);
  }, []);

  const handleCloseViewDialog = useCallback(() => {
    setViewDialogOpen(false);
    setViewingId(null);
    setViewingName("");
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setEditDialogOpen(false);
    setEditingId(null);
    setEditingName("");
  }, []);

  const handleRefreshAfterUpdate = useCallback(async () => {
    await fetchData();
    await broadcast({ type: "friends-refresh" });
  }, [broadcast, fetchData]);

  const batchActions: ActionButton[] = [
    {
      label: "批量检查",
      icon: <RiRefreshLine size="1em" />,
      variant: "primary",
      onClick: () =>
        openCheckDialog(
          selectedIds,
          `将对选中的 ${selectedIds.length} 条友链执行检查。`,
          "确认批量检查",
        ),
    },
  ];

  const handleConfirmAction = useCallback(async () => {
    if (!pendingAction) return;

    setSubmitting(true);
    try {
      await executeCheck(pendingAction.ids, pendingAction.checkAll);
      setSelectedKeys(new Set());
      await fetchData();
      await broadcast({ type: "friends-refresh" });
    } catch (error) {
      console.error("[FriendsTable] 执行操作失败:", error);
      toast.error("操作失败，请稍后重试");
    } finally {
      setSubmitting(false);
      setDialogOpen(false);
      setPendingAction(null);
    }
  }, [broadcast, executeCheck, fetchData, pendingAction, toast]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;

    setSubmitting(true);
    try {
      const result = await deleteFriendLinkByAdmin({ id: pendingDelete.id });
      if (!result.success || !result.data) {
        toast.error(result.message || "删除失败");
        return;
      }

      toast.success(result.message || `已删除友链「${pendingDelete.name}」`);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(pendingDelete.id);
        next.delete(String(pendingDelete.id));
        return next;
      });
      await fetchData();
      await broadcast({ type: "friends-refresh" });
      setDialogOpen(false);
      setPendingDelete(null);
    } catch (error) {
      console.error("[FriendsTable] 删除失败:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }, [broadcast, fetchData, pendingDelete, toast]);

  const rowActions = (record: Record<string, unknown>): ActionButton[] => {
    const item = record as unknown as FriendLinkListItem;
    return [
      {
        label: "查看",
        icon: <RiEyeLine size="1em" />,
        variant: "ghost",
        onClick: () => openViewDialog(item),
      },
      {
        label: "刷新",
        icon: <RiRefreshLine size="1em" />,
        variant: "ghost",
        disabled: item.status === "WHITELIST",
        onClick: () =>
          openCheckDialog(
            [item.id],
            `将对「${item.name}」执行一次检查。`,
            "确认刷新检查",
          ),
      },
      {
        label: "编辑",
        icon: <RiEditLine size="1em" />,
        variant: "ghost",
        onClick: () => openEditDialog(item),
      },
      {
        label: "删除",
        icon: <RiDeleteBinLine size="1em" />,
        variant: "danger",
        onClick: () => openDeleteDialog(item),
      },
    ];
  };

  const columns: TableColumn<Record<string, unknown>>[] = [
    {
      key: "name",
      title: "站点",
      dataIndex: "name",
      align: "left",
      sortable: true,
      render: (_, record) => {
        const item = record as unknown as FriendLinkListItem;
        return (
          <div className="space-y-1">
            <Link
              href={item.url}
              className="font-medium"
              presets={["hover-underline"]}
            >
              {item.name}
            </Link>
          </div>
        );
      },
    },
    {
      key: "owner",
      title: "申请人",
      dataIndex: "owner",
      align: "left",
      render: (_, record) => {
        const item = record as unknown as FriendLinkListItem;
        if (!item.owner)
          return <span className="text-muted-foreground">-</span>;
        return (
          <div className="text-sm">
            <div>{item.owner.nickname || item.owner.username}</div>
            <div className="text-muted-foreground text-xs">
              UID: {item.owner.uid}
            </div>
          </div>
        );
      },
    },
    {
      key: "status",
      title: "状态",
      dataIndex: "status",
      align: "center",
      sortable: true,
      render: (value) => {
        const status = String(value) as FriendLinkStatus;
        return (
          <span className={`font-medium ${statusClassName[status]}`}>
            {statusText[status]}
          </span>
        );
      },
    },

    {
      key: "checkSuccessCount",
      title: "成功检查",
      dataIndex: "checkSuccessCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value) =>
        typeof value === "number" && value > 0 ? (
          <span className="text-foreground">{value}</span>
        ) : (
          "-"
        ),
    },
    {
      key: "checkFailureCount",
      title: "失败检查",
      dataIndex: "checkFailureCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value) =>
        typeof value === "number" && value > 0 ? (
          <span className="text-warning">{value}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      key: "totalSuccessRate",
      title: "总成功率",
      dataIndex: "checkSuccessCount",
      align: "center",
      mono: true,
      render: (_, record) => {
        const item = record as unknown as FriendLinkListItem;
        const totalChecks = item.checkSuccessCount + item.checkFailureCount;
        if (totalChecks <= 0) {
          return <span className="text-muted-foreground">-</span>;
        }
        const successRate = (item.checkSuccessCount / totalChecks) * 100;
        return (
          <span className={getRateClass(successRate)}>
            {formatRate(item.checkSuccessCount, totalChecks)}
          </span>
        );
      },
    },
    {
      key: "recentSuccessRate",
      title: "最近成功率",
      dataIndex: "recentSuccessRate",
      align: "center",
      mono: true,
      render: (_, record) => {
        const item = record as unknown as FriendLinkListItem;
        if (item.recentSuccessRate == null || item.recentSampleCount <= 0) {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className={getRateClass(item.recentSuccessRate)}>
            {item.recentSuccessRate.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "ignoreBacklink",
      title: "回链检查",
      dataIndex: "ignoreBacklink",
      align: "center",
      render: (_, record) => {
        const item = record as unknown as FriendLinkListItem;
        if (!item.friendLinkUrl)
          return <span className="text-muted-foreground">无地址</span>;
        return item.ignoreBacklink ? (
          <span className="text-muted-foreground">已忽略</span>
        ) : (
          <span className="text-foreground">已开启</span>
        );
      },
    },
    {
      key: "avgResponseTime",
      title: "平均响应",
      dataIndex: "avgResponseTime",
      align: "center",
      sortable: true,
      mono: true,
      render: (value) => {
        if (typeof value !== "number") return "-";
        return `${value}ms`;
      },
    },
    {
      key: "lastCheckedAt",
      title: "最近检查",
      dataIndex: "lastCheckedAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value) =>
        formatDateTimeLocale(typeof value === "string" ? value : null),
    },
    {
      key: "createdAt",
      title: "创建于",
      dataIndex: "createdAt",
      align: "left",
      sortable: true,
      mono: true,
      render: (value) =>
        formatDateTimeLocale(typeof value === "string" ? value : null),
    },
  ];

  const filterConfig: FilterConfig[] = [
    {
      key: "status",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { value: "PENDING", label: "待审核" },
        { value: "PUBLISHED", label: "已发布" },
        { value: "WHITELIST", label: "白名单" },
        { value: "REJECTED", label: "已拒绝" },
        { value: "DISCONNECT", label: "无法访问" },
        { value: "NO_BACKLINK", label: "无回链" },
        { value: "BLOCKED", label: "已拉黑" },
      ],
    },
    {
      key: "hasIssue",
      label: "异常",
      type: "checkboxGroup",
      options: [{ value: "true", label: "仅显示异常" }],
    },
    {
      key: "ignoreBacklink",
      label: "回链设置",
      type: "checkboxGroup",
      options: [
        { value: "false", label: "启用回链检查" },
        { value: "true", label: "已忽略回链检查" },
      ],
    },
  ];

  return (
    <>
      <GridTable
        title="友情链接管理"
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
        onSortChange={(key, order) => {
          setSortKey((key as SortKey) || "updatedAt");
          setSortOrder(order || "desc");
          setPage(1);
        }}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="搜索站点名、URL、标语"
        filterConfig={filterConfig}
        onFilterChange={(filters) => {
          setFilterValues(filters);
          setPage(1);
        }}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无友链记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={(keys) => setSelectedKeys(new Set(keys))}
        controlledSelectedKeys={selectedKeys}
        onRowClick={(record) => {
          openViewDialog(record as unknown as FriendLinkListItem);
        }}
      />

      <AlertDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setPendingAction(null);
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) {
            void handleConfirmDelete();
            return;
          }
          void handleConfirmAction();
        }}
        title={dialogTitle}
        description={dialogDescription}
        confirmText={dialogConfirmText}
        cancelText="取消"
        variant={dialogVariant}
        loading={submitting}
      />

      <FriendLinkEditDialog
        open={viewDialogOpen}
        friendLinkId={viewingId}
        fallbackName={viewingName}
        mode="view"
        onClose={handleCloseViewDialog}
        onUpdated={handleRefreshAfterUpdate}
      />

      <FriendLinkEditDialog
        open={editDialogOpen}
        friendLinkId={editingId}
        fallbackName={editingName}
        mode="edit"
        onClose={handleCloseEditDialog}
        onUpdated={handleRefreshAfterUpdate}
      />
    </>
  );
}
