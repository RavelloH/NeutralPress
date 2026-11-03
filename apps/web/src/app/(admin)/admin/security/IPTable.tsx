"use client";

import { useEffect, useState } from "react";
import {
  RiDeleteBinLine,
  RiProhibitedLine,
  RiShieldCheckLine,
  RiShieldLine,
} from "@remixicon/react";
import type { IPInfo } from "@repo/shared-types/api/security";

import { banIP, clearRateLimit, unbanIP } from "@/actions/security";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast, useBroadcastSender } from "@/hooks/use-broadcast";
import { getIPList } from "@/lib/client/api/security-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

// 速率限制配置（与 rate-limit.ts 保持一致）
const RATE_LIMITS = {
  GUEST: 20, // 访客（未登录）
  USER: 60, // 普通用户
  EDITOR: 120, // 编辑/作者
  ADMIN: 600, // 管理员
} as const;

export default function IPTable() {
  const toast = useToast();
  const { broadcast } = useBroadcastSender<{ type: "security-refresh" }>();
  const [data, setData] = useState<IPInfo[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("realtimeCount");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedIPs, setSelectedIPs] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  // 封禁对话框状态
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banningIP, setBanningIP] = useState<string>("");
  const [banDuration, setBanDuration] = useState("3600");
  const [banReason, setBanReason] = useState("");

  // 解封确认对话框
  const [unbanDialogOpen, setUnbanDialogOpen] = useState(false);
  const [unbanningIP, setUnbanningIP] = useState<string>("");

  // 清除限制确认对话框
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingIP, setClearingIP] = useState<string>("");

  // 批量操作对话框
  const [batchBanDialogOpen, setBatchBanDialogOpen] = useState(false);
  const [batchUnbanDialogOpen, setBatchUnbanDialogOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedIPs(selectedKeys);
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
      key: "filter",
      label: "状态筛选",
      type: "checkboxGroup",
      options: [
        { label: "全部", value: "all" },
        { label: "已封禁", value: "banned" },
        { label: "接近限流", value: "rate-limited" },
        { label: "活跃", value: "active" },
      ],
    },
  ];

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "security-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  // 获取数据
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const filterValue =
          filterValues.filter && Array.isArray(filterValues.filter)
            ? (filterValues.filter[0] as
                | "all"
                | "banned"
                | "rate-limited"
                | "active")
            : "all";

        const res = await getIPList({
          page,
          pageSize,
          filter: filterValue,
          sortBy:
            (sortKey as
              | "ip"
              | "realtimeCount"
              | "last24hCount"
              | "lastRequest") || "realtimeCount",
          sortOrder: sortOrder || "desc",
          search: searchQuery || undefined,
        });

        if (res.success && res.data) {
          setData(res.data.items);
          setTotalRecords(res.data.total);
          setTotalPages(res.data.totalPages);
        }
      } catch (error) {
        console.error("获取IP列表失败:", error);
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

  // 封禁IP
  const handleBanIP = async () => {
    if (!banningIP) return;
    setIsSubmitting(true);
    try {
      const result = await banIP({
        ip: banningIP,
        duration: parseInt(banDuration, 10),
        reason: banReason || undefined,
      });

      if (result.success) {
        toast.success(`IP ${banningIP} 已封禁`);
        setBanDialogOpen(false);
        setBanningIP("");
        setBanReason("");
        setRefreshTrigger((prev) => prev + 1);
        await broadcast({ type: "security-refresh" });
      } else {
        toast.error(result.message || "封禁失败");
      }
    } catch (error) {
      console.error("封禁失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 解封IP
  const handleUnbanIP = async () => {
    if (!unbanningIP) return;
    setIsSubmitting(true);
    try {
      const result = await unbanIP({ ip: unbanningIP });

      if (result.success) {
        toast.success(`IP ${unbanningIP} 已解封`);
        setUnbanDialogOpen(false);
        setUnbanningIP("");
        setRefreshTrigger((prev) => prev + 1);
        await broadcast({ type: "security-refresh" });
      } else {
        toast.error(result.message || "解封失败");
      }
    } catch (error) {
      console.error("解封失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 清除限制
  const handleClearRateLimit = async () => {
    if (!clearingIP) return;
    setIsSubmitting(true);
    try {
      const result = await clearRateLimit({ ip: clearingIP });

      if (result.success) {
        toast.success(`IP ${clearingIP} 的限制记录已清除`);
        setClearDialogOpen(false);
        setClearingIP("");
        setRefreshTrigger((prev) => prev + 1);
        await broadcast({ type: "security-refresh" });
      } else {
        toast.error(result.message || "清除失败");
      }
    } catch (error) {
      console.error("清除失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 批量封禁
  const handleBatchBan = async () => {
    setIsSubmitting(true);
    try {
      let successCount = 0;
      for (const ip of selectedIPs) {
        const result = await banIP({
          ip: ip as string,
          duration: parseInt(banDuration, 10),
          reason: banReason || "批量封禁",
        });
        if (result.success) successCount++;
      }

      toast.success(`已封禁 ${successCount} 个IP`);
      setBatchBanDialogOpen(false);
      setSelectedIPs([]);
      setRefreshTrigger((prev) => prev + 1);
      await broadcast({ type: "security-refresh" });
    } catch (error) {
      console.error("批量封禁失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 批量解封
  const handleBatchUnban = async () => {
    setIsSubmitting(true);
    try {
      let successCount = 0;
      for (const ip of selectedIPs) {
        const result = await unbanIP({ ip: ip as string });
        if (result.success) successCount++;
      }

      toast.success(`已解封 ${successCount} 个IP`);
      setBatchUnbanDialogOpen(false);
      setSelectedIPs([]);
      setRefreshTrigger((prev) => prev + 1);
      await broadcast({ type: "security-refresh" });
    } catch (error) {
      console.error("批量解封失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 定义表格列
  const columns: TableColumn<IPInfo>[] = [
    {
      key: "ip",
      title: "IP地址",
      sortable: true,
      mono: true,
      render: (_, record) => <span className="font-mono">{record.ip}</span>,
    },
    {
      key: "country",
      title: "国家",
      render: (_, record) => (
        <span className="text-muted-foreground">{record.country || "-"}</span>
      ),
    },
    {
      key: "province",
      title: "省份",
      render: (_, record) => (
        <span className="text-muted-foreground">{record.province || "-"}</span>
      ),
    },
    {
      key: "city",
      title: "城市",
      render: (_, record) => (
        <span className="text-muted-foreground">{record.city || "-"}</span>
      ),
    },
    {
      key: "realtimeCount",
      title: "1m请求",
      sortable: true,
      render: (_, record) => {
        const count = record.realtimeCount ?? record.requestCount;
        return <span>{count}</span>;
      },
    },
    {
      key: "last24hCount",
      title: "24h请求",
      sortable: true,
      render: (_, record) => {
        const count = record.last24hCount ?? 0;
        return <span>{count.toLocaleString()}</span>;
      },
    },
    {
      key: "lastRequest",
      title: "最后请求",
      sortable: true,
      render: (_, record) =>
        record.lastRequest > 0
          ? new Date(record.lastRequest).toLocaleString("zh-CN")
          : "-",
    },
    {
      key: "isBanned",
      title: "状态",
      render: (_, record) => {
        const count = record.realtimeCount ?? record.requestCount;

        // 已封禁
        if (record.isBanned) {
          return (
            <span className="inline-flex items-center gap-1 text-error">
              <RiProhibitedLine size="1em" />
              已封禁
            </span>
          );
        }

        // 全账号受限（>=600，所有权限都会被限流）
        if (count >= RATE_LIMITS.ADMIN) {
          return (
            <span className="inline-flex items-center gap-1 text-error">
              <RiShieldLine size="1em" />
              全账号受限
            </span>
          );
        }

        // 高权限用户受限（>=120，编辑及以下会被限流）
        if (count >= RATE_LIMITS.EDITOR) {
          return (
            <span className="inline-flex items-center gap-1 text-error">
              <RiShieldLine size="1em" />
              高权限用户受限
            </span>
          );
        }

        // 用户受限（>=60，普通用户及以下会被限流）
        if (count >= RATE_LIMITS.USER) {
          return (
            <span className="inline-flex items-center gap-1 text-warning">
              <RiShieldLine size="1em" />
              用户受限
            </span>
          );
        }

        // 访客受限（>=20，只有访客会被限流）
        if (count >= RATE_LIMITS.GUEST) {
          return (
            <span className="inline-flex items-center gap-1 text-warning">
              <RiShieldLine size="1em" />
              访客受限
            </span>
          );
        }

        // 正常
        return (
          <span className="inline-flex items-center gap-1 text-success">
            <RiShieldCheckLine size="1em" />
            正常
          </span>
        );
      },
    },
    {
      key: "banReason",
      title: "封禁原因",
      render: (_, record) => record.banReason || "-",
    },
  ];

  // 行操作
  const rowActions = (record: IPInfo): ActionButton[] => {
    const actions: ActionButton[] = [];

    if (record.isBanned) {
      actions.push({
        label: "解封",
        icon: <RiShieldCheckLine size="1em" />,
        onClick: () => {
          setUnbanningIP(record.ip);
          setUnbanDialogOpen(true);
        },
      });
    } else {
      actions.push({
        label: "封禁",
        icon: <RiProhibitedLine size="1em" />,
        variant: "danger",
        onClick: () => {
          setBanningIP(record.ip);
          setBanDialogOpen(true);
        },
      });
    }

    if (record.requestCount > 0) {
      actions.push({
        label: "清除限制",
        icon: <RiDeleteBinLine size="1em" />,
        onClick: () => {
          setClearingIP(record.ip);
          setClearDialogOpen(true);
        },
      });
    }

    return actions;
  };

  // 批量操作
  const batchActions: ActionButton[] = [
    {
      label: "批量解封",
      icon: <RiShieldCheckLine size="1em" />,
      variant: "ghost",
      onClick: () => setBatchUnbanDialogOpen(true),
      disabled: selectedIPs.length === 0,
    },
    {
      label: "批量封禁",
      icon: <RiProhibitedLine size="1em" />,
      variant: "danger",
      onClick: () => setBatchBanDialogOpen(true),
      disabled: selectedIPs.length === 0,
    },
  ];

  // 封禁时长选项
  const durationOptions = [
    { label: "1小时", value: "3600" },
    { label: "6小时", value: "21600" },
    { label: "12小时", value: "43200" },
    { label: "1天", value: "86400" },
    { label: "7天", value: "604800" },
    { label: "30天", value: "2592000" },
    { label: "永久", value: "31536000" },
  ];

  return (
    <>
      <GridTable
        title="IP管理"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="ip"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        onSearchChange={setSearchQuery}
        searchPlaceholder="搜索IP地址..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        striped
        hoverable
      />

      {/* 封禁对话框 */}
      <Dialog
        open={banDialogOpen}
        onClose={() => setBanDialogOpen(false)}
        title={`封禁 IP`}
        size="md"
      >
        <div className="px-6 py-6 space-y-5 text-sm">
          <div className="space-y-1">
            <span className="text-muted-foreground">目标IP：</span>
            <span className="font-mono">{banningIP}</span>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              封禁时长
            </label>
            <Select
              size="sm"
              options={durationOptions}
              value={banDuration}
              onChange={(value) => setBanDuration(value as string)}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              封禁原因
            </label>
            <Input
              label=""
              size="sm"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="输入封禁原因（可选）"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              label="取消"
              size="sm"
              variant="ghost"
              onClick={() => setBanDialogOpen(false)}
            />
            <Button
              label="确认封禁"
              size="sm"
              variant="danger"
              onClick={handleBanIP}
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 解封确认对话框 */}
      <AlertDialog
        open={unbanDialogOpen}
        onClose={() => setUnbanDialogOpen(false)}
        onConfirm={handleUnbanIP}
        title="确认解封"
        description={`确定要解封 IP ${unbanningIP} 吗？`}
        confirmText="确认解封"
        cancelText="取消"
        loading={isSubmitting}
      />

      {/* 清除限制确认对话框 */}
      <AlertDialog
        open={clearDialogOpen}
        onClose={() => setClearDialogOpen(false)}
        onConfirm={handleClearRateLimit}
        title="确认清除"
        description={`确定要清除 IP ${clearingIP} 的速率限制记录吗？`}
        confirmText="确认清除"
        cancelText="取消"
        loading={isSubmitting}
      />

      {/* 批量封禁对话框 */}
      <Dialog
        open={batchBanDialogOpen}
        onClose={() => setBatchBanDialogOpen(false)}
        title="批量封禁"
        size="md"
      >
        <div className="px-6 py-6 space-y-5 text-sm">
          <div className="space-y-1">
            <span className="text-muted-foreground">已选择：</span>
            <span className="font-medium">{selectedIPs.length} 个IP</span>
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              封禁时长
            </label>
            <Select
              options={durationOptions}
              size="sm"
              value={banDuration}
              onChange={(value) => setBanDuration(value as string)}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              封禁原因
            </label>
            <Input
              label=""
              size="sm"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="输入封禁原因（可选）"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              label="取消"
              variant="ghost"
              size="sm"
              onClick={() => setBatchBanDialogOpen(false)}
            />
            <Button
              label="确认封禁"
              size="sm"
              variant="danger"
              onClick={handleBatchBan}
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 批量解封确认对话框 */}
      <AlertDialog
        open={batchUnbanDialogOpen}
        variant="info"
        onClose={() => setBatchUnbanDialogOpen(false)}
        onConfirm={handleBatchUnban}
        title="确认批量解封"
        description={`确定要解封选中的 ${selectedIPs.length} 个IP吗？`}
        confirmText="确认解封"
        cancelText="取消"
        loading={isSubmitting}
      />
    </>
  );
}
