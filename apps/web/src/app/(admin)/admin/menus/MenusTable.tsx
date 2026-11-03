"use client";

import { useEffect, useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiExternalLinkLine,
} from "@remixicon/react";
import type { MenuListItem } from "@repo/shared-types/api/menu";

import { deleteMenus, updateMenu, updateMenus } from "@/actions/menu";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getMenusList } from "@/lib/client/api/menu-read";
import runWithAuth from "@/lib/client/run-with-auth";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { Select } from "@/ui/Select";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

interface MenuFormState {
  name: string;
  icon: string;
  link: string;
  slug: string;
  status: MenuListItem["status"];
  order: number;
  category: MenuListItem["category"];
  linkType: "internal" | "external"; // 用于切换输入框
}

export default function MenusTable() {
  const toast = useToast();
  const [data, setData] = useState<MenuListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("order");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("asc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedMenus, setSelectedMenus] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuListItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingMenu, setDeletingMenu] = useState<MenuListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchStatusDialogOpen, setBatchStatusDialogOpen] = useState(false);
  const [batchCategoryDialogOpen, setBatchCategoryDialogOpen] = useState(false);
  const [batchNewStatus, setBatchNewStatus] = useState("ACTIVE");
  const [batchNewCategory, setBatchNewCategory] = useState("COMMON");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 编辑菜单状态
  const [formData, setFormData] = useState<MenuFormState>({
    name: "",
    icon: "",
    link: "",
    slug: "",
    status: "ACTIVE",
    order: 0,
    category: "COMMON",
    linkType: "internal",
  });

  // 处理表单字段变化
  const handleFieldChange = <K extends keyof MenuFormState>(
    field: K,
    value: MenuFormState[K],
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 处理链接类型切换
  const handleLinkTypeChange = (type: "internal" | "external") => {
    setFormData((prev) => ({
      ...prev,
      linkType: type,
      // 清空另一个字段
      link: type === "internal" ? "" : prev.link,
      slug: type === "external" ? "" : prev.slug,
    }));
  };

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedMenus(selectedKeys);
    console.log("选中的菜单 ID:", selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (menuItem: MenuListItem) => {
    setEditingMenu(menuItem);
    const linkType = menuItem.link ? "external" : "internal";
    setFormData({
      name: menuItem.name,
      icon: menuItem.icon || "",
      link: menuItem.link || "",
      slug: menuItem.slug || "",
      status: menuItem.status,
      order: menuItem.order,
      category: menuItem.category,
      linkType,
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingMenu(null);
  };

  // 保存菜单编辑
  const handleSaveMenu = async () => {
    if (!editingMenu) return;

    // 验证表单
    if (!formData.name.trim()) {
      toast.error("菜单名称不能为空");
      return;
    }

    if (formData.linkType === "internal" && !formData.slug.trim()) {
      toast.error("内部链接的 slug 不能为空");
      return;
    }

    if (formData.linkType === "external" && !formData.link.trim()) {
      toast.error("外部链接的 URL 不能为空");
      return;
    }

    setIsSubmitting(true);
    try {
      // 检查是否有变化
      const hasChanges =
        formData.name !== editingMenu.name ||
        formData.icon !== (editingMenu.icon || "") ||
        formData.status !== editingMenu.status ||
        formData.order !== editingMenu.order ||
        formData.category !== editingMenu.category ||
        (formData.linkType === "internal"
          ? formData.slug !== (editingMenu.slug || "")
          : formData.link !== (editingMenu.link || ""));

      if (!hasChanges) {
        toast.info("没有字段被修改");
        setIsSubmitting(false);
        return;
      }

      const result = await runWithAuth(updateMenu, {
        id: editingMenu.id,
        name: formData.name !== editingMenu.name ? formData.name : undefined,
        icon:
          formData.icon !== (editingMenu.icon || "")
            ? formData.icon || null
            : undefined,
        status:
          formData.status !== editingMenu.status ? formData.status : undefined,
        order:
          formData.order !== editingMenu.order ? formData.order : undefined,
        category:
          formData.category !== editingMenu.category
            ? formData.category
            : undefined,
        link: formData.linkType === "external" ? formData.link || null : null,
        slug: formData.linkType === "internal" ? formData.slug || null : null,
      });

      if (result && "data" in result && result.data) {
        toast.success(`菜单 "${editingMenu.name}" 已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error("操作失败");
      }
    } catch (error) {
      console.error("更新菜单失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个菜单对话框
  const openDeleteDialog = (menuItem: MenuListItem) => {
    setDeletingMenu(menuItem);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingMenu(null);
  };

  // 确认删除单个菜单
  const handleConfirmDelete = async () => {
    if (!deletingMenu) return;

    setIsSubmitting(true);
    try {
      const result = await runWithAuth(deleteMenus, {
        ids: [deletingMenu.id],
      });

      if (result && "data" in result && result.data) {
        toast.success(`菜单 "${deletingMenu.name}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error("操作失败");
      }
    } catch (error) {
      console.error("删除菜单失败:", error);
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
      const result = await runWithAuth(deleteMenus, {
        ids: selectedMenus.map((id) => String(id)),
      });

      if (result && "data" in result && result.data) {
        toast.success(`已删除 ${result.data?.deleted || 0} 个菜单`);
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedMenus([]);
      } else {
        toast.error("操作失败");
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
      const result = await runWithAuth(updateMenus, {
        ids: selectedMenus.map((id) => String(id)),
        status: batchNewStatus as "ACTIVE" | "SUSPENDED",
      });

      if (result && "data" in result && result.data) {
        toast.success(`已更新 ${result.data?.updated || 0} 个菜单的状态`);
        closeBatchStatusDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedMenus([]);
      } else {
        toast.error("操作失败");
      }
    } catch (error) {
      console.error("批量更改状态失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量更改分类对话框
  const openBatchCategoryDialog = () => {
    setBatchCategoryDialogOpen(true);
  };

  // 关闭批量更改分类对话框
  const closeBatchCategoryDialog = () => {
    setBatchCategoryDialogOpen(false);
  };

  // 确认批量更改分类
  const handleConfirmBatchCategory = async () => {
    setIsSubmitting(true);
    try {
      const result = await runWithAuth(updateMenus, {
        ids: selectedMenus.map((id) => String(id)),
        category: batchNewCategory as "MAIN" | "COMMON" | "OUTSITE",
      });

      if (result && "data" in result && result.data) {
        toast.success(`已更新 ${result.data?.updated || 0} 个菜单的分类`);
        closeBatchCategoryDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedMenus([]);
      } else {
        toast.error("操作失败");
      }
    } catch (error) {
      console.error("批量更改分类失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 批量操作按钮
  const batchActions: ActionButton[] = [
    {
      label: "更改状态",
      onClick: openBatchStatusDialog,
      icon: <RiEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "更改分类",
      onClick: openBatchCategoryDialog,
      icon: <RiEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "删除",
      onClick: openBatchDeleteDialog,
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 行操作按钮
  const rowActions = (record: MenuListItem): ActionButton[] => {
    const actions: ActionButton[] = [
      {
        label: "编辑",
        onClick: () => openEditDialog(record),
        icon: <RiEditLine size="1em" />,
        variant: "ghost",
      },
      {
        label: "删除",
        onClick: () => openDeleteDialog(record),
        icon: <RiDeleteBinLine size="1em" />,
        variant: "danger",
      },
    ];

    // 如果是外部链接，添加"打开链接"按钮
    if (record.link) {
      actions.unshift({
        label: "打开链接",
        onClick: () => window.open(record.link!, "_blank"),
        icon: <RiExternalLinkLine size="1em" />,
        variant: "ghost",
      });
    }

    return actions;
  };

  // 处理排序变化
  const handleSortChange = (key: string, order: "asc" | "desc" | null) => {
    setSortKey(order ? key : null);
    setSortOrder(order);
    setPage(1);
  };

  // 处理搜索变化
  const handleSearchChange = (search: string) => {
    setSearchQuery(search);
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
      key: "status",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { value: "ACTIVE", label: "已激活" },
        { value: "SUSPENDED", label: "已暂停" },
      ],
    },
    {
      key: "category",
      label: "分类",
      type: "checkboxGroup",
      options: [
        { value: "MAIN", label: "主导航" },
        { value: "COMMON", label: "常用链接" },
        { value: "OUTSITE", label: "外部链接" },
      ],
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
    {
      key: "updatedAt",
      label: "更新时间",
      type: "dateRange",
      dateFields: { start: "updatedAtStart", end: "updatedAtEnd" },
    },
  ];

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "menus-refresh") {
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
          sortBy?: "name" | "order" | "createdAt" | "updatedAt";
          sortOrder?: "asc" | "desc";
          search?: string;
          status?: ("ACTIVE" | "SUSPENDED")[];
          category?: ("MAIN" | "COMMON" | "OUTSITE")[];
          createdAtStart?: string;
          createdAtEnd?: string;
          updatedAtStart?: string;
          updatedAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "name"
            | "order"
            | "createdAt"
            | "updatedAt";
          params.sortOrder = sortOrder;
        }

        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        if (filterValues.status && Array.isArray(filterValues.status)) {
          const statusFilter = (filterValues.status as string[]).filter(
            (status): status is "ACTIVE" | "SUSPENDED" =>
              status === "ACTIVE" || status === "SUSPENDED",
          );
          if (statusFilter.length > 0) {
            params.status = statusFilter;
          }
        }

        if (filterValues.category && Array.isArray(filterValues.category)) {
          const categoryFilter = (filterValues.category as string[]).filter(
            (cat): cat is "MAIN" | "COMMON" | "OUTSITE" =>
              cat === "MAIN" || cat === "COMMON" || cat === "OUTSITE",
          );
          if (categoryFilter.length > 0) {
            params.category = categoryFilter;
          }
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
          filterValues.updatedAt &&
          typeof filterValues.updatedAt === "object"
        ) {
          const dateRange = filterValues.updatedAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.updatedAtStart = dateRange.start;
          }
          if (dateRange.end) {
            params.updatedAtEnd = dateRange.end;
          }
        }

        const result = await runWithAuth(getMenusList, {
          ...params,
          sortBy: params.sortBy || "order",
          sortOrder: params.sortOrder || "asc",
        });

        if (result && "data" in result && result.data) {
          // 先按分类排序，再按 order 排序
          const categoryOrder = { MAIN: 1, COMMON: 2, OUTSITE: 3 };
          const sortedData = [...result.data].sort((a, b) => {
            // 首先按分类排序
            const categoryDiff =
              categoryOrder[a.category] - categoryOrder[b.category];
            if (categoryDiff !== 0) return categoryDiff;

            // 分类相同时，按 order 排序
            return a.order - b.order;
          });

          setData(sortedData);
          setTotalRecords(sortedData.length);
          // 由于没有分页元数据，我们简单计算
          setTotalPages(Math.ceil(sortedData.length / pageSize));
        }
      } catch (error) {
        console.error("Failed to fetch menus list:", error);
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

  const columns: TableColumn<MenuListItem>[] = [
    {
      key: "order",
      title: "排序",
      dataIndex: "order",
      align: "center",
      width: 80,
      render: (value: unknown) => (
        <span className="font-mono">{String(value)}</span>
      ),
    },
    {
      key: "name",
      title: "名称",
      dataIndex: "name",
      align: "left",
      sortable: true,
      render: (value: unknown, record: MenuListItem) => {
        return (
          <div className="flex items-center gap-2">
            {record.icon && (
              <i className={`ri-${record.icon} text-lg`} aria-hidden="true" />
            )}
            <span>{String(value)}</span>
          </div>
        );
      },
    },
    {
      key: "category",
      title: "分类",
      dataIndex: "category",
      align: "center",
      render: (value: unknown) => {
        const category = String(value);
        const categoryMap = {
          MAIN: { text: "主导航", color: "bg-primary/20 text-primary" },
          COMMON: { text: "常用链接", color: "bg-info/20 text-info" },
          OUTSITE: { text: "外部链接", color: "bg-warning/20 text-warning" },
        };
        const config =
          categoryMap[category as keyof typeof categoryMap] ||
          categoryMap.COMMON;
        return (
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap ${config.color}`}
          >
            {config.text}
          </span>
        );
      },
    },
    {
      key: "link",
      title: "链接",
      dataIndex: "link",
      align: "left",
      mono: true,
      render: (value: unknown, record: MenuListItem) => {
        if (record.link) {
          return <span className="text-info">{record.link}</span>;
        }
        if (record.slug) {
          return <span className="text-success">{record.slug}</span>;
        }
        return <span className="text-muted-foreground">-</span>;
      },
    },
    {
      key: "status",
      title: "状态",
      dataIndex: "status",
      align: "center",
      render: (value: unknown) => {
        const status = String(value);
        return status === "ACTIVE" ? (
          <span className="flex justify-center text-success">
            <RiCheckLine size="1.5em" />
          </span>
        ) : (
          <span className="flex justify-center text-muted-foreground">
            <RiCloseLine size="1.5em" />
          </span>
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
      key: "updatedAt",
      title: "更新时间",
      dataIndex: "updatedAt",
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
  ];

  return (
    <>
      <GridTable
        title="菜单列表"
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
        searchPlaceholder="搜索菜单名称或路径..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无菜单记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑菜单对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`编辑菜单 - ${editingMenu?.name || ""}`}
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                基本信息
              </h3>
            </div>
            <div className="space-y-4">
              <Input
                label="菜单名称"
                value={formData.name}
                onChange={(e) => handleFieldChange("name", e.target.value)}
                required
                size="sm"
                helperText="显示在导航栏的文字"
              />
              <Input
                label="图标名称"
                value={formData.icon}
                onChange={(e) => handleFieldChange("icon", e.target.value)}
                size="sm"
                helperText="Remix Icon 图标名（如：home-3-fill）"
              />
              <div className="space-y-2">
                <label className="block text-sm text-foreground">分类</label>
                <Select
                  value={formData.category}
                  onChange={(value) =>
                    handleFieldChange(
                      "category",
                      value as MenuFormState["category"],
                    )
                  }
                  options={[
                    { value: "MAIN", label: "主导航" },
                    { value: "COMMON", label: "常用链接" },
                    { value: "OUTSITE", label: "外部链接" },
                  ]}
                  size="sm"
                />
              </div>
              <Input
                label="排序"
                type="number"
                value={String(formData.order)}
                onChange={(e) =>
                  handleFieldChange("order", Number(e.target.value))
                }
                size="sm"
                helperText="数字越小越靠前"
              />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                链接设置
              </h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm text-foreground">
                  链接类型
                </label>
                <Select
                  value={formData.linkType}
                  onChange={(value) =>
                    handleLinkTypeChange(value as "internal" | "external")
                  }
                  options={[
                    { value: "internal", label: "内部路径 (slug)" },
                    { value: "external", label: "外部链接 (URL)" },
                  ]}
                  size="sm"
                />
              </div>
              {formData.linkType === "internal" ? (
                <Input
                  label="内部路径 (slug)"
                  value={formData.slug}
                  onChange={(e) => handleFieldChange("slug", e.target.value)}
                  size="sm"
                  helperText="如：posts、about、categories"
                  required
                />
              ) : (
                <Input
                  label="外部链接 (URL)"
                  value={formData.link}
                  onChange={(e) => handleFieldChange("link", e.target.value)}
                  size="sm"
                  helperText="如：https://example.com"
                  required
                />
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">状态</h3>
            </div>
            <div className="space-y-2">
              <Select
                value={formData.status}
                onChange={(value) =>
                  handleFieldChange("status", value as MenuFormState["status"])
                }
                options={[
                  { value: "ACTIVE", label: "激活" },
                  { value: "SUSPENDED", label: "暂停" },
                ]}
                size="sm"
              />
              <p className="text-sm text-muted-foreground">
                激活：菜单项将在导航栏显示 <br />
                暂停：菜单项将不会显示
              </p>
            </div>
          </section>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end sm:gap-4">
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
              onClick={handleSaveMenu}
              size="sm"
              loading={isSubmitting}
            />
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
            将为选中的 {selectedMenus.length} 个菜单更改状态
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">新状态</label>
            <Select
              value={batchNewStatus}
              onChange={(value) => setBatchNewStatus(value as string)}
              options={[
                { value: "ACTIVE", label: "激活" },
                { value: "SUSPENDED", label: "暂停" },
              ]}
              size="sm"
            />
          </div>
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

      {/* 批量更改分类对话框 */}
      <Dialog
        open={batchCategoryDialogOpen}
        onClose={closeBatchCategoryDialog}
        title="批量更改分类"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedMenus.length} 个菜单更改分类
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">新分类</label>
            <Select
              value={batchNewCategory}
              onChange={(value) => setBatchNewCategory(value as string)}
              options={[
                { value: "MAIN", label: "主导航" },
                { value: "COMMON", label: "常用链接" },
                { value: "OUTSITE", label: "外部链接" },
              ]}
              size="sm"
            />
          </div>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchCategoryDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchCategory}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除单个菜单确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除菜单"
        description={
          deletingMenu ? `确定要删除菜单 "${deletingMenu.name}" 吗？` : ""
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
        description={`确定要删除选中的 ${selectedMenus.length} 个菜单吗？`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />
    </>
  );
}
