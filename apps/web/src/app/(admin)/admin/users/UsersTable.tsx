"use client";

import { useEffect, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiShieldUserLine,
  RiUserSettingsLine,
} from "@remixicon/react";
import type { UserListItem } from "@repo/shared-types/api/user";

import { deleteUsers, disable2FA, updateUsers } from "@/actions/user";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import UserAvatar from "@/components/ui/UserAvatar";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getUsersList } from "@/lib/client/api/user-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { SelectOption } from "@/ui/Select";
import { Select } from "@/ui/Select";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

export default function UsersTable() {
  const toast = useToast();
  const [data, setData] = useState<UserListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedUsers, setSelectedUsers] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchStatusDialogOpen, setBatchStatusDialogOpen] = useState(false);
  const [batchRoleDialogOpen, setBatchRoleDialogOpen] = useState(false);
  const [disable2FADialogOpen, setDisable2FADialogOpen] = useState(false);
  const [disable2FAUser, setDisable2FAUser] = useState<UserListItem | null>(
    null,
  );
  const [batchNewStatus, setBatchNewStatus] = useState("ACTIVE");
  const [batchNewRole, setBatchNewRole] = useState("USER");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 编辑用户状态
  const [formData, setFormData] = useState({
    username: "",
    nickname: "",
    email: "",
    avatar: "",
    emailVerified: false,
    role: "USER",
    status: "ACTIVE",
    website: "",
    bio: "",
    emailNotice: false,
  });

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedUsers(selectedKeys);
    console.log("选中的用户 UID:", selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (user: UserListItem) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      nickname: user.nickname || "",
      email: user.email,
      avatar: user.avatar || "",
      emailVerified: user.emailVerified,
      role: user.role,
      status: user.status,
      website: user.website || "",
      bio: user.bio || "",
      emailNotice: user.emailNotice,
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingUser(null);
  };

  // 处理表单字段变化
  const handleFieldChange = (field: string, value: string | boolean) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 保存用户编辑
  const handleSaveUser = async () => {
    if (!editingUser) return;

    setIsSubmitting(true);
    try {
      // 构建只包含修改字段的更新数据
      const updateData: {
        uids: number[];
        username?: string;
        nickname?: string;
        email?: string;
        avatar?: string;
        website?: string;
        bio?: string;
        emailVerified?: boolean;
        emailNotice?: boolean;
        role?: "USER" | "ADMIN" | "EDITOR" | "AUTHOR";
        status?: "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE";
      } = {
        uids: [editingUser.uid],
      };

      // 只添加修改过的字段
      if (formData.username !== editingUser.username) {
        updateData.username = formData.username;
      }
      if (formData.nickname !== (editingUser.nickname || "")) {
        updateData.nickname = formData.nickname;
      }
      if (formData.email !== editingUser.email) {
        updateData.email = formData.email;
      }
      if (formData.avatar !== (editingUser.avatar || "")) {
        updateData.avatar = formData.avatar;
      }
      if (formData.website !== (editingUser.website || "")) {
        updateData.website = formData.website;
      }
      if (formData.bio !== (editingUser.bio || "")) {
        updateData.bio = formData.bio;
      }
      if (formData.emailVerified !== editingUser.emailVerified) {
        updateData.emailVerified = formData.emailVerified;
      }
      if (formData.emailNotice !== editingUser.emailNotice) {
        updateData.emailNotice = formData.emailNotice;
      }
      if (formData.role !== editingUser.role) {
        updateData.role = formData.role as
          | "USER"
          | "ADMIN"
          | "EDITOR"
          | "AUTHOR";
      }
      if (formData.status !== editingUser.status) {
        updateData.status = formData.status as
          | "ACTIVE"
          | "SUSPENDED"
          | "NEEDS_UPDATE";
      }

      // 检查是否有字段被修改
      if (Object.keys(updateData).length === 1) {
        // 只有 uids，没有其他字段
        toast.info("没有字段被修改");
        setIsSubmitting(false);
        return;
      }

      const result = await updateUsers(updateData);

      if (result.success) {
        toast.success(`用户 "${editingUser.username}" 已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("更新用户失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个用户对话框
  const openDeleteDialog = (user: UserListItem) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingUser(null);
  };

  // 确认删除单个用户
  const handleConfirmDelete = async () => {
    if (!deletingUser) return;

    setIsSubmitting(true);
    try {
      const result = await deleteUsers({
        uids: [deletingUser.uid],
      });

      if (result.success) {
        toast.success(`用户 "${deletingUser.username}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("删除用户失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量删除对话框
  const openBatchDeleteDialog = () => {
    setBatchDeleteDialogOpen(true);
  };

  // 关闭批量删除对话框
  const closeBatchDeleteDialog = () => {
    setBatchDeleteDialogOpen(false);
  };

  // 确认批量删除
  const handleConfirmBatchDelete = async () => {
    setIsSubmitting(true);
    try {
      const result = await deleteUsers({
        uids: selectedUsers.map((uid) => Number(uid)),
      });

      if (result.success) {
        toast.success(`已删除 ${result.data?.deleted || 0} 个用户`);
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedUsers([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量删除失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量更改状态对话框
  const openBatchStatusDialog = () => {
    setBatchStatusDialogOpen(true);
  };

  // 关闭批量更改状态对话框
  const closeBatchStatusDialog = () => {
    setBatchStatusDialogOpen(false);
  };

  // 确认批量更改状态
  const handleConfirmBatchStatus = async () => {
    setIsSubmitting(true);
    try {
      const result = await updateUsers({
        uids: selectedUsers.map((uid) => Number(uid)),
        status: batchNewStatus as "ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE",
      });

      if (result.success) {
        toast.success(`已更新 ${result.data?.updated || 0} 个用户的状态`);
        closeBatchStatusDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedUsers([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量更改状态失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量更改角色对话框
  const openBatchRoleDialog = () => {
    setBatchRoleDialogOpen(true);
  };

  // 关闭批量更改角色对话框
  const closeBatchRoleDialog = () => {
    setBatchRoleDialogOpen(false);
  };

  // 确认批量更改角色
  const handleConfirmBatchRole = async () => {
    setIsSubmitting(true);
    try {
      const result = await updateUsers({
        uids: selectedUsers.map((uid) => Number(uid)),
        role: batchNewRole as "USER" | "ADMIN" | "EDITOR" | "AUTHOR",
      });

      if (result.success) {
        toast.success(`已更新 ${result.data?.updated || 0} 个用户的角色`);
        closeBatchRoleDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedUsers([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量更改角色失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开关闭2FA对话框
  const openDisable2FADialog = (user: UserListItem) => {
    setDisable2FAUser(user);
    setDisable2FADialogOpen(true);
  };

  // 关闭关闭2FA对话框
  const closeDisable2FADialog = () => {
    setDisable2FADialogOpen(false);
    setDisable2FAUser(null);
  };

  // 确认关闭2FA
  const handleConfirmDisable2FA = async () => {
    if (!disable2FAUser) return;

    setIsSubmitting(true);
    try {
      const result = await disable2FA({
        uid: disable2FAUser.uid,
      });

      if (result.success) {
        toast.success(`已关闭用户 "${disable2FAUser.username}" 的两步验证`);
        closeDisable2FADialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("关闭2FA失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 批量操作按钮
  const batchActions: ActionButton[] = [
    {
      label: "更改状态",
      onClick: () => {
        openBatchStatusDialog();
      },
      icon: <RiUserSettingsLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "更改角色",
      onClick: () => {
        openBatchRoleDialog();
      },
      icon: <RiShieldUserLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "删除",
      onClick: () => {
        openBatchDeleteDialog();
      },
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 行操作按钮
  const rowActions = (record: UserListItem): ActionButton[] => [
    {
      label: "编辑",
      onClick: () => {
        openEditDialog(record);
      },
      icon: <RiEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "删除",
      onClick: () => {
        openDeleteDialog(record);
      },
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1); // 排序变化时重置到第一页
  };

  // 处理搜索变化
  const handleSearchChange = (search: string) => {
    setSearchQuery(search);
    setPage(1); // 搜索变化时重置到第一页
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
      key: "uid",
      label: "用户 ID",
      type: "input",
      inputType: "number",
      placeholder: "输入用户 ID",
    },
    {
      key: "role",
      label: "角色",
      type: "checkboxGroup",
      options: [
        { value: "USER", label: "用户" },
        { value: "AUTHOR", label: "作者" },
        { value: "EDITOR", label: "编辑" },
        { value: "ADMIN", label: "管理员" },
      ],
    },
    {
      key: "status",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { value: "ACTIVE", label: "正常" },
        { value: "SUSPENDED", label: "已封禁" },
        { value: "NEEDS_UPDATE", label: "需更新" },
      ],
    },
    {
      key: "emailVerified",
      label: "邮箱验证状态",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "已验证" },
        { value: "false", label: "未验证" },
      ],
    },
    {
      key: "emailNotice",
      label: "邮件通知",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "已启用" },
        { value: "false", label: "已禁用" },
      ],
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
    {
      key: "lastUseAt",
      label: "最后活跃时间",
      type: "dateRange",
      dateFields: { start: "lastUseAtStart", end: "lastUseAtEnd" },
    },
  ];

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "users-refresh") {
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
          sortBy?: "uid" | "username" | "createdAt" | "lastUseAt";
          sortOrder?: "asc" | "desc";
          search?: string;
          uid?: number;
          role?: ("USER" | "ADMIN" | "EDITOR" | "AUTHOR")[];
          status?: ("ACTIVE" | "SUSPENDED" | "NEEDS_UPDATE")[];
          emailVerified?: boolean[];
          emailNotice?: boolean[];
          createdAtStart?: string;
          createdAtEnd?: string;
          lastUseAtStart?: string;
          lastUseAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        // 只在有有效的排序参数时才添加
        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "uid"
            | "username"
            | "createdAt"
            | "lastUseAt";
          params.sortOrder = sortOrder;
        }

        // 添加搜索参数
        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        if (filterValues.uid && typeof filterValues.uid === "string") {
          params.uid = parseInt(filterValues.uid, 10);
        }

        if (filterValues.role && Array.isArray(filterValues.role)) {
          params.role = filterValues.role as (
            | "USER"
            | "ADMIN"
            | "EDITOR"
            | "AUTHOR"
          )[];
        }

        if (filterValues.status && Array.isArray(filterValues.status)) {
          params.status = filterValues.status as (
            | "ACTIVE"
            | "SUSPENDED"
            | "NEEDS_UPDATE"
          )[];
        }

        if (
          filterValues.emailVerified &&
          Array.isArray(filterValues.emailVerified)
        ) {
          params.emailVerified = filterValues.emailVerified.map(
            (v) => v === "true",
          );
        }

        if (
          filterValues.emailNotice &&
          Array.isArray(filterValues.emailNotice)
        ) {
          params.emailNotice = filterValues.emailNotice.map(
            (v) => v === "true",
          );
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
          filterValues.lastUseAt &&
          typeof filterValues.lastUseAt === "object"
        ) {
          const dateRange = filterValues.lastUseAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.lastUseAtStart = dateRange.start;
          }
          if (dateRange.end) {
            params.lastUseAtEnd = dateRange.end;
          }
        }

        const result = await getUsersList({
          ...params,
          sortBy: params.sortBy || "uid",
          sortOrder: params.sortOrder || "asc",
        });

        if (result.success && result.data) {
          setData(result.data);
          setTotalRecords(result.meta?.total || 0);
          if (result.meta) {
            setTotalPages(result.meta.totalPages);
          }
        }
      } catch (error) {
        console.error("Failed to fetch users list:", error);
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

  const columns: TableColumn<UserListItem>[] = [
    {
      key: "uid",
      title: "ID",
      dataIndex: "uid",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "avatar",
      title: "头像",
      dataIndex: "avatar",
      align: "left",
      render: (value: unknown, record: UserListItem) => {
        const username = record.username;
        return (
          <div className="flex items-center justify-center">
            <UserAvatar
              username={username}
              email={record.email}
              avatarUrl={
                typeof value === "string" ? value || undefined : undefined
              }
              size={32}
              shape="circle"
            />
          </div>
        );
      },
    },
    {
      key: "username",
      title: "用户名",
      dataIndex: "username",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "nickname",
      title: "昵称",
      dataIndex: "nickname",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {value && typeof value === "string" ? value : "-"}
          </span>
        );
      },
    },
    {
      key: "email",
      title: "邮箱",
      dataIndex: "email",
      align: "left",
      mono: true,
      render: (value: unknown, record: UserListItem) => {
        return (
          <div className="flex items-center gap-2">
            {record.emailVerified ? (
              <span className="text-xs text-success">
                <RiCheckLine size="1.5em" />
              </span>
            ) : (
              <span className="text-xs text-error">
                <RiCloseLine size="1.5em" />
              </span>
            )}
            <span className="text-sm">{String(value)}</span>
          </div>
        );
      },
    },
    {
      key: "role",
      title: "角色",
      dataIndex: "role",
      align: "center",
      render: (value: unknown) => {
        const role = String(value);
        const colorClass =
          role === "ADMIN"
            ? "bg-error/20 text-error"
            : role === "EDITOR"
              ? "bg-warning/20 text-warning"
              : role === "AUTHOR"
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground";
        return (
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${colorClass}`}
          >
            {role}
          </span>
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
        const colorClass =
          status === "ACTIVE"
            ? "bg-success/20 text-success"
            : status === "SUSPENDED"
              ? "bg-error/20 text-error"
              : "bg-warning/20 text-warning";
        const statusText =
          status === "ACTIVE"
            ? "正常"
            : status === "SUSPENDED"
              ? "已封禁"
              : "需更新";
        return (
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${colorClass}`}
          >
            {statusText}
          </span>
        );
      },
    },
    {
      key: "emailNotice",
      title: "邮件通知",
      dataIndex: "emailNotice",
      align: "center",
      render: (value: unknown) => {
        return value === true ? (
          <span className="flex justify-center">
            <RiCheckLine size="1.5em" />
          </span>
        ) : (
          <span className="flex justify-center">
            <RiCloseLine size="1.5em" className="text-muted-foreground" />
          </span>
        );
      },
    },
    {
      key: "postsCount",
      title: "文章数",
      dataIndex: "postsCount",
      align: "center",
      render: (value: unknown, record: UserListItem) => {
        const count = typeof value === "number" ? value : 0;
        return (
          <Link
            href={`/admin/posts?authorUid=${record.uid}`}
            className="text-primary"
            presets={["hover-underline"]}
          >
            {count}
          </Link>
        );
      },
    },
    {
      key: "commentsCount",
      title: "评论数",
      dataIndex: "commentsCount",
      align: "center",
      render: (value: unknown, record: UserListItem) => {
        const count = typeof value === "number" ? value : 0;
        return (
          <Link
            href={`/admin/comments?uid=${record.uid}`}
            className="text-primary"
            presets={["hover-underline"]}
          >
            {count}
          </Link>
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
            second: "2-digit",
          });
        }
        return "-";
      },
    },
    {
      key: "lastUseAt",
      title: "最后活跃",
      dataIndex: "lastUseAt",
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
  ];

  // 角色选项
  const roleOptions: SelectOption[] = [
    { value: "USER", label: "用户" },
    { value: "AUTHOR", label: "作者" },
    { value: "EDITOR", label: "编辑" },
    { value: "ADMIN", label: "管理员" },
  ];

  // 状态选项
  const statusOptions: SelectOption[] = [
    { value: "ACTIVE", label: "正常" },
    { value: "SUSPENDED", label: "已封禁" },
    { value: "NEEDS_UPDATE", label: "需更新" },
  ];

  return (
    <>
      <GridTable
        title="用户列表"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="uid"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        onSearchChange={handleSearchChange}
        searchPlaceholder="搜索用户名、昵称或邮箱..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无用户记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        // 启用操作模式
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        // 行点击事件
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑用户对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`编辑用户 - ${editingUser?.username || ""}`}
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              基本信息
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input
                label="用户名"
                value={formData.username}
                onChange={(e) => handleFieldChange("username", e.target.value)}
                required
                size="sm"
              />
              <Input
                label="昵称"
                value={formData.nickname}
                onChange={(e) => handleFieldChange("nickname", e.target.value)}
                size="sm"
              />
              <Input
                label="邮箱"
                type="email"
                value={formData.email}
                onChange={(e) => handleFieldChange("email", e.target.value)}
                required
                size="sm"
              />
              <Input
                label="头像 URL"
                value={formData.avatar}
                onChange={(e) => handleFieldChange("avatar", e.target.value)}
                size="sm"
              />
            </div>
          </div>

          {/* 权限设置 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              权限设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-foreground mb-2">
                  角色
                </label>
                <Select
                  value={formData.role}
                  onChange={(value) =>
                    handleFieldChange("role", value as string)
                  }
                  options={roleOptions}
                  size="sm"
                />
                <p className="text-sm text-muted-foreground py-2">
                  用户：正常访客权限 <br />
                  作者：可创建和管理自己的内容 <br />
                  编辑：可管理所有用户的内容 <br />
                  管理员：拥有全部权限，可更改系统设置
                </p>
              </div>
              <div>
                <label className="block text-sm text-foreground mb-2">
                  状态
                </label>
                <Select
                  value={formData.status}
                  onChange={(value) =>
                    handleFieldChange("status", value as string)
                  }
                  options={statusOptions}
                  size="sm"
                />
                <p className="text-sm text-muted-foreground py-2">
                  正常：用户可以正常使用账号 <br />
                  已封禁：用户将无法登录和使用账号 <br />
                  需更新：用户需重置密码后方可继续使用
                </p>
              </div>
            </div>
          </div>

          {/* 其他信息 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              其他信息
            </h3>
            <div className="space-y-4">
              <Input
                label="个人网站"
                type="url"
                value={formData.website}
                onChange={(e) => handleFieldChange("website", e.target.value)}
                size="sm"
              />
              <Input
                label="个人简介"
                value={formData.bio}
                onChange={(e) => handleFieldChange("bio", e.target.value)}
                rows={4}
                size="sm"
              />
            </div>
          </div>

          {/* 设置选项 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              设置选项
            </h3>
            <div className="space-y-3 flex flex-col">
              <Checkbox
                label="邮箱已验证"
                checked={formData.emailVerified}
                onChange={(e) =>
                  handleFieldChange("emailVerified", e.target.checked)
                }
              />
              <Checkbox
                label="接收邮件通知"
                checked={formData.emailNotice}
                onChange={(e) =>
                  handleFieldChange("emailNotice", e.target.checked)
                }
              />
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between gap-4 pt-4 border-t border-foreground/10">
            {/* 左侧：关闭2FA按钮 */}
            <div>
              {editingUser?.hasTwoFactor && (
                <Button
                  label="关闭两步验证"
                  variant="danger"
                  onClick={() => {
                    closeEditDialog();
                    openDisable2FADialog(editingUser);
                  }}
                  size="sm"
                  disabled={isSubmitting}
                />
              )}
            </div>
            {/* 右侧：取消和保存按钮 */}
            <div className="flex gap-4">
              <Button
                label="取消"
                variant="ghost"
                onClick={closeEditDialog}
                size="sm"
                disabled={isSubmitting}
              />
              <Button
                label="保存"
                variant="primary"
                onClick={handleSaveUser}
                size="sm"
                loading={isSubmitting}
              />
            </div>
          </div>
        </div>
      </Dialog>

      {/* 批量更改状态对话框 */}
      <Dialog
        open={batchStatusDialogOpen}
        onClose={closeBatchStatusDialog}
        title="批量更改状态"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedUsers.length} 个用户更改状态
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">新状态</label>
            <Select
              value={batchNewStatus}
              onChange={(value) => setBatchNewStatus(value as string)}
              options={statusOptions}
              size="sm"
              direcation="down"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            正常：用户可以正常使用账号 <br />
            已封禁：用户将无法登录和使用账号 <br />
            需更新：用户需重置密码后方可继续使用
          </p>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchStatusDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchStatus}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 批量更改角色对话框 */}
      <Dialog
        open={batchRoleDialogOpen}
        onClose={closeBatchRoleDialog}
        title="批量更改角色"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedUsers.length} 个用户更改角色
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">新角色</label>
            <Select
              value={batchNewRole}
              onChange={(value) => setBatchNewRole(value as string)}
              options={roleOptions}
              size="sm"
              direcation="down"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            用户：正常访客权限 <br />
            作者：可创建和管理自己的内容 <br />
            编辑：可管理所有用户的内容 <br />
            管理员：拥有全部权限，可更改系统设置
          </p>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchRoleDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchRole}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除单个用户确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除用户"
        description={
          deletingUser ? `确定要删除用户 "${deletingUser.username}" 吗？` : ""
        }
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* 批量删除确认对话框 */}
      <AlertDialog
        open={batchDeleteDialogOpen}
        onClose={closeBatchDeleteDialog}
        onConfirm={handleConfirmBatchDelete}
        title="确认批量删除"
        description={`确定要删除选中的 ${selectedUsers.length} 个用户吗？`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* 关闭2FA确认对话框 */}
      <AlertDialog
        open={disable2FADialogOpen}
        onClose={closeDisable2FADialog}
        onConfirm={handleConfirmDisable2FA}
        title="确认关闭两步验证"
        description={
          disable2FAUser
            ? `确定要关闭用户 "${disable2FAUser.username}" 的两步验证吗？此操作将清除该用户的所有2FA配置，用户需要重新设置。`
            : ""
        }
        confirmText="关闭"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />
    </>
  );
}
