"use client";

import { useEffect, useMemo, useState } from "react";
import { RiCheckLine, RiCloseLine, RiRefreshLine } from "@remixicon/react";

import {
  resetMailSubscriptionLastSentByAdmin,
  updateMailSubscriptionStatusByAdmin,
} from "@/actions/mail-subscription";
import {
  MAIL_SUBSCRIPTIONS_REFRESH_EVENT,
  type MailSubscriptionsRefreshMessage,
} from "@/app/(admin)/admin/mail-subscriptions/constants";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getMailSubscriptionList } from "@/lib/client/api/mail-subscription-read";
import { AlertDialog } from "@/ui/AlertDialog";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

type MailSubscriptionStatus = "PENDING_VERIFY" | "ACTIVE" | "UNSUBSCRIBED";

interface MailSubscriptionRecord {
  [key: string]: unknown;
  id: number;
  email: string;
  userUid: number | null;
  username: string | null;
  nickname: string | null;
  status: MailSubscriptionStatus;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
  lastSentPostId: number | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
  isPendingForLatest: boolean;
}

const SORTABLE_FIELDS = ["id", "createdAt", "updatedAt", "lastSentAt"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MailSubscriptionTable() {
  const toast = useToast();
  const { broadcast } = useBroadcastSender<MailSubscriptionsRefreshMessage>();
  const [data, setData] = useState<MailSubscriptionRecord[]>([]);
  const [latestPostId, setLatestPostId] = useState<number | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedRows, setSelectedRows] = useState<(string | number)[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string | number>>(
    new Set(),
  );
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [targetStatus, setTargetStatus] = useState<"ACTIVE" | "UNSUBSCRIBED">(
    "ACTIVE",
  );

  useBroadcast<MailSubscriptionsRefreshMessage>((message) => {
    if (
      message.type === MAIL_SUBSCRIPTIONS_REFRESH_EVENT &&
      message.source !== "table"
    ) {
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
          search?: string;
          status?: MailSubscriptionStatus[];
          boundUser?: boolean[];
          pendingOnly?: boolean;
          sortBy?: SortableField;
          sortOrder?: "asc" | "desc";
        } = {
          page,
          pageSize,
        };

        if (
          sortKey &&
          sortOrder &&
          SORTABLE_FIELDS.includes(sortKey as SortableField)
        ) {
          params.sortBy = sortKey as SortableField;
          params.sortOrder = sortOrder;
        }

        if (searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        if (
          Array.isArray(filterValues.status) &&
          filterValues.status.length > 0
        ) {
          params.status = filterValues.status as MailSubscriptionStatus[];
        }

        if (
          Array.isArray(filterValues.boundUser) &&
          filterValues.boundUser.length > 0
        ) {
          params.boundUser = filterValues.boundUser.map(
            (item) => item === "true",
          );
        }

        if (Array.isArray(filterValues.pendingOnly)) {
          params.pendingOnly = filterValues.pendingOnly.includes("true");
        }

        const result = await getMailSubscriptionList(params);
        if (!result.success || !result.data) {
          toast.error(result.message || "获取订阅列表失败");
          return;
        }

        setData(result.data.items as MailSubscriptionRecord[]);
        setLatestPostId(result.data.latestPostId);
        setTotalRecords(result.meta?.total || 0);
        setTotalPages(result.meta?.totalPages || 1);
      } catch (error) {
        console.error("[MailSubscriptionTable] 获取订阅列表失败:", error);
        toast.error("获取订阅列表失败");
      } finally {
        setLoading(false);
      }
    }

    void fetchData();
  }, [
    filterValues,
    page,
    pageSize,
    refreshTrigger,
    searchQuery,
    sortKey,
    sortOrder,
    toast,
  ]);

  const openStatusDialog = (
    ids: number[],
    status: "ACTIVE" | "UNSUBSCRIBED",
  ) => {
    setTargetIds(ids);
    setTargetStatus(status);
    setStatusDialogOpen(true);
  };

  const openResetDialog = (ids: number[]) => {
    setTargetIds(ids);
    setResetDialogOpen(true);
  };

  const handleConfirmStatus = async () => {
    if (targetIds.length === 0) return;

    setIsSubmitting(true);
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const id of targetIds) {
        const result = await updateMailSubscriptionStatusByAdmin({
          id,
          status: targetStatus,
        });
        if (result.success) {
          successCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (successCount > 0) {
        toast.success(
          `状态更新完成：成功 ${successCount} 条，失败 ${failedCount} 条`,
        );
        setRefreshTrigger((prev) => prev + 1);
        await broadcast({
          type: MAIL_SUBSCRIPTIONS_REFRESH_EVENT,
          source: "table",
        });
      } else {
        toast.error("状态更新失败");
      }
      setStatusDialogOpen(false);
      setSelectedRows([]);
      setSelectedRowKeys(new Set());
    } catch (error) {
      console.error("[MailSubscriptionTable] 更新状态失败:", error);
      toast.error("状态更新失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReset = async () => {
    if (targetIds.length === 0) return;

    setIsSubmitting(true);
    try {
      let successCount = 0;
      let failedCount = 0;

      for (const id of targetIds) {
        const result = await resetMailSubscriptionLastSentByAdmin({ id });
        if (result.success) {
          successCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (successCount > 0) {
        toast.success(
          `重置完成：成功 ${successCount} 条，失败 ${failedCount} 条`,
        );
        setRefreshTrigger((prev) => prev + 1);
        await broadcast({
          type: MAIL_SUBSCRIPTIONS_REFRESH_EVENT,
          source: "table",
        });
      } else {
        toast.error("重置发送标记失败");
      }
      setResetDialogOpen(false);
      setSelectedRows([]);
      setSelectedRowKeys(new Set());
    } catch (error) {
      console.error("[MailSubscriptionTable] 重置发送标记失败:", error);
      toast.error("重置发送标记失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const rowActions = (record: MailSubscriptionRecord): ActionButton[] => [
    {
      label: record.status === "ACTIVE" ? "设为退订" : "设为生效",
      onClick: () =>
        openStatusDialog(
          [record.id],
          record.status === "ACTIVE" ? "UNSUBSCRIBED" : "ACTIVE",
        ),
      icon:
        record.status === "ACTIVE" ? (
          <RiCloseLine size="1em" />
        ) : (
          <RiCheckLine size="1em" />
        ),
      variant: record.status === "ACTIVE" ? "danger" : "ghost",
    },
    {
      label: "重置发送标记",
      onClick: () => openResetDialog([record.id]),
      icon: <RiRefreshLine size="1em" />,
      variant: "ghost",
    },
  ];

  const batchActions: ActionButton[] = useMemo(
    () => [
      {
        label: "批量设为生效",
        onClick: () =>
          openStatusDialog(
            selectedRows.map((item) => Number(item)),
            "ACTIVE",
          ),
        icon: <RiCheckLine size="1em" />,
        variant: "ghost",
      },
      {
        label: "批量设为退订",
        onClick: () =>
          openStatusDialog(
            selectedRows.map((item) => Number(item)),
            "UNSUBSCRIBED",
          ),
        icon: <RiCloseLine size="1em" />,
        variant: "danger",
      },
      {
        label: "批量重置发送标记",
        onClick: () =>
          openResetDialog(selectedRows.map((item) => Number(item))),
        icon: <RiRefreshLine size="1em" />,
        variant: "ghost",
      },
    ],
    [selectedRows],
  );

  const filterConfig: FilterConfig[] = [
    {
      key: "status",
      label: "订阅状态",
      type: "checkboxGroup",
      options: [
        { value: "PENDING_VERIFY", label: "待验证" },
        { value: "ACTIVE", label: "生效中" },
        { value: "UNSUBSCRIBED", label: "已退订" },
      ],
    },
    {
      key: "boundUser",
      label: "账号关联",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "已关联账号" },
        { value: "false", label: "匿名订阅" },
      ],
    },
    {
      key: "pendingOnly",
      label: "发送状态",
      type: "checkboxGroup",
      options: [{ value: "true", label: "仅显示待发送最新文章" }],
    },
  ];

  const columns: TableColumn<MailSubscriptionRecord>[] = [
    {
      key: "id",
      title: "ID",
      dataIndex: "id",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "email",
      title: "邮箱",
      dataIndex: "email",
      align: "left",
      mono: true,
    },
    {
      key: "userUid",
      title: "关联用户",
      dataIndex: "userUid",
      align: "left",
      render: (_, record) => {
        if (!record.userUid) return <span className="text-sm">匿名</span>;
        const userLabel =
          record.nickname || record.username || `UID ${record.userUid}`;
        return (
          <Link
            href={`/admin/users?uid=${record.userUid}`}
            presets={["hover-underline"]}
          >
            {userLabel}
          </Link>
        );
      },
    },
    {
      key: "status",
      title: "状态",
      dataIndex: "status",
      align: "center",
      render: (value: unknown) => {
        const status = String(value);
        const map: Record<
          MailSubscriptionStatus,
          { text: string; className: string }
        > = {
          ACTIVE: {
            text: "生效中",
            className: "bg-success/20 text-success",
          },
          PENDING_VERIFY: {
            text: "待验证",
            className: "bg-warning/20 text-warning",
          },
          UNSUBSCRIBED: {
            text: "已退订",
            className: "bg-muted text-muted-foreground",
          },
        };
        const fallback = map.PENDING_VERIFY;
        const current = map[status as MailSubscriptionStatus] || fallback;
        return (
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${current.className}`}
          >
            {current.text}
          </span>
        );
      },
    },
    {
      key: "lastSentPostId",
      title: "发送进度",
      dataIndex: "lastSentPostId",
      align: "center",
      render: (_, record) => {
        if (!latestPostId) {
          return <span className="text-sm">暂无最新文章</span>;
        }
        if (record.lastSentPostId === latestPostId) {
          return (
            <span className="text-success">已发送最新（#{latestPostId}）</span>
          );
        }
        if (record.lastSentPostId === null) {
          return <span className="text-warning">从未发送</span>;
        }
        return (
          <span className="text-warning">
            停留在 #{record.lastSentPostId}（最新 #{latestPostId}）
          </span>
        );
      },
    },
    {
      key: "lastSentAt",
      title: "最近发送时间",
      dataIndex: "lastSentAt",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        formatDateTime(typeof value === "string" ? value : null),
    },
    {
      key: "verifiedAt",
      title: "验证时间",
      dataIndex: "verifiedAt",
      mono: true,
      render: (value: unknown) =>
        formatDateTime(typeof value === "string" ? value : null),
    },
    {
      key: "updatedAt",
      title: "更新时间",
      dataIndex: "updatedAt",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        formatDateTime(typeof value === "string" ? value : null),
    },
    {
      key: "createdAt",
      title: "创建时间",
      dataIndex: "createdAt",
      sortable: true,
      mono: true,
      render: (value: unknown) =>
        formatDateTime(typeof value === "string" ? value : null),
    },
  ];

  return (
    <>
      <GridTable<MailSubscriptionRecord>
        title="邮件订阅管理"
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
        onSortChange={(key, order) => {
          setSortKey(order ? key : null);
          setSortOrder(order);
          setPage(1);
        }}
        onSearchChange={(search) => {
          setSearchQuery(search);
          setPage(1);
        }}
        searchPlaceholder="搜索邮箱、用户名或昵称..."
        filterConfig={filterConfig}
        onFilterChange={(filters) => {
          setFilterValues(filters);
          setPage(1);
        }}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无订阅记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        controlledSelectedKeys={selectedRowKeys}
        onSelectionChange={(keys) => {
          setSelectedRows(keys);
          setSelectedRowKeys(new Set(keys));
        }}
      />

      <AlertDialog
        open={statusDialogOpen}
        onClose={() => setStatusDialogOpen(false)}
        onConfirm={handleConfirmStatus}
        title={targetStatus === "ACTIVE" ? "确认设为生效" : "确认设为退订"}
        description={`将对 ${targetIds.length} 条订阅记录执行状态更新。`}
        confirmText="确认"
        cancelText="取消"
        variant={targetStatus === "ACTIVE" ? "info" : "danger"}
        loading={isSubmitting}
      />

      <AlertDialog
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onConfirm={handleConfirmReset}
        title="确认重置发送标记"
        description={`将清空 ${targetIds.length} 条订阅记录的 lastSentPostId 和 lastSentAt。`}
        confirmText="确认重置"
        cancelText="取消"
        variant="info"
        loading={isSubmitting}
      />
    </>
  );
}
