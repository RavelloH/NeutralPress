"use client";

import { useEffect, useState } from "react";
import {
  RiArrowRightLine,
  RiDeleteBinLine,
  RiEditLine,
  RiFileListLine,
  RiFolder3Line,
  RiFolderTransferLine,
} from "@remixicon/react";
import type { CategoryListItem } from "@repo/shared-types/api/category";

import {
  deleteCategories,
  moveCategories,
  updateCategory,
} from "@/actions/category";
import { CategoryInput } from "@/components/client/features/categories/CategoryInput";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getCategoriesList } from "@/lib/client/api/category";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

type CurrentCategory = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parentId: number | null;
} | null;

type Props = {
  parentId: number | null;
  categoryPath: string[];
  categoryNamePath: string[];
  currentCategory: CurrentCategory;
};

export default function CategoriesTable({
  parentId,
  categoryPath,
  categoryNamePath,
  currentCategory,
}: Props) {
  const toast = useToast();
  const [data, setData] = useState<CategoryListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("totalPostCount");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedCategories, setSelectedCategories] = useState<
    (string | number)[]
  >([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const navigate = useNavigateWithTransition();

  // 编辑对话框
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<CategoryListItem | null>(null);
  const [editFormData, setEditFormData] = useState({
    id: 0,
    newSlug: "",
    newName: "",
    description: "",
    featuredImage: "",
    parentId: null as number | null,
    parentCategoryPath: null as string | null,
  });

  // 移动对话框
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [movingCategory, setMovingCategory] = useState<CategoryListItem | null>(
    null,
  );
  const [moveTargetParentId, setMoveTargetParentId] = useState<number | null>(
    null,
  );
  const [moveTargetCategoryPath, setMoveTargetCategoryPath] = useState<
    string | null
  >(null);
  const [batchMoveDialogOpen, setBatchMoveDialogOpen] = useState(false);

  // 删除对话框
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] =
    useState<CategoryListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedCategories(selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (category: CategoryListItem) => {
    setEditingCategory(category);
    setEditFormData({
      id: category.id,
      newSlug: category.slug,
      newName: category.name,
      description: category.description || "",
      featuredImage: category.featuredImage || "",
      parentId: category.parentId,
      parentCategoryPath: category.parentName || null,
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingCategory(null);
  };

  // 保存分类编辑
  const handleSaveCategory = async () => {
    if (!editingCategory) return;

    setIsSubmitting(true);
    try {
      const updateData: {
        id: number;
        newSlug?: string;
        newName?: string;
        description?: string;
        featuredImage?: string | null;
        parentId?: number | null;
      } = {
        id: editingCategory.id,
      };

      // 只有非"未分类"分类才能更新 slug
      if (
        editingCategory.slug !== "uncategorized" &&
        editFormData.newSlug !== editingCategory.slug
      ) {
        updateData.newSlug = editFormData.newSlug;
      }
      if (editFormData.newName !== editingCategory.name) {
        updateData.newName = editFormData.newName;
      }
      if (editFormData.description !== (editingCategory.description || "")) {
        updateData.description = editFormData.description || undefined;
      }
      if (
        editFormData.featuredImage !== (editingCategory.featuredImage || "")
      ) {
        updateData.featuredImage = editFormData.featuredImage || null;
      }
      // "未分类"分类不允许修改父分类
      if (
        editingCategory.slug !== "uncategorized" &&
        editFormData.parentId !== editingCategory.parentId
      ) {
        updateData.parentId = editFormData.parentId;
      }

      if (
        !updateData.newSlug &&
        !updateData.newName &&
        updateData.description === undefined &&
        updateData.featuredImage === undefined &&
        updateData.parentId === undefined
      ) {
        toast.info("没有字段被修改");
        setIsSubmitting(false);
        return;
      }

      const result = await updateCategory(updateData);

      if (result.success) {
        toast.success(`分类已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("更新分类失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开移动单个分类对话框
  const openMoveDialog = (category: CategoryListItem) => {
    // 检查是否为"未分类"分类，禁止移动
    if (category.slug === "uncategorized") {
      toast.error('系统保留分类"未分类"不允许移动');
      return;
    }
    setMovingCategory(category);
    setMoveTargetParentId(category.parentId);
    setMoveTargetCategoryPath(category.parentName || null);
    setMoveDialogOpen(true);
  };

  // 关闭移动对话框
  const closeMoveDialog = () => {
    setMoveDialogOpen(false);
    setMovingCategory(null);
    setMoveTargetParentId(null);
    setMoveTargetCategoryPath(null);
  };

  // 确认移动单个分类
  const handleConfirmMove = async () => {
    if (!movingCategory) return;

    setIsSubmitting(true);
    try {
      const result = await moveCategories({
        ids: [movingCategory.id],
        targetParentId: moveTargetParentId,
      });

      if (result.success) {
        toast.success(`分类 "${movingCategory.name}" 已移动`);
        closeMoveDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("移动分类失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个分类对话框
  const openDeleteDialog = (category: CategoryListItem) => {
    // 检查是否为"未分类"分类，禁止删除
    if (category.slug === "uncategorized") {
      toast.error('系统保留分类"未分类"不允许删除');
      return;
    }
    setDeletingCategory(category);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingCategory(null);
  };

  // 确认删除单个分类
  const handleConfirmDelete = async () => {
    if (!deletingCategory) return;

    setIsSubmitting(true);
    try {
      const result = await deleteCategories({
        ids: [deletingCategory.id],
      });

      if (result.success) {
        const cascadeMsg =
          result.data && result.data.cascadeDeleted > 0
            ? `（级联删除了 ${result.data.cascadeDeleted} 个子分类）`
            : "";
        toast.success(`分类 "${deletingCategory.name}" 已删除${cascadeMsg}`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("删除分类失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量移动对话框
  const openBatchMoveDialog = () => {
    // 检查是否包含"未分类"分类
    const hasUncategorized = selectedCategories.some((id) => {
      const category = data.find((item) => item.id === Number(id));
      return category?.slug === "uncategorized";
    });

    if (hasUncategorized) {
      toast.error('选中的分类包含系统保留分类"未分类"，不允许移动');
      return;
    }

    setMoveTargetParentId(parentId);
    setMoveTargetCategoryPath(currentCategory?.name || null);
    setBatchMoveDialogOpen(true);
  };

  // 关闭批量移动对话框
  const closeBatchMoveDialog = () => {
    setBatchMoveDialogOpen(false);
    setMoveTargetParentId(null);
    setMoveTargetCategoryPath(null);
  };

  // 确认批量移动
  const handleConfirmBatchMove = async () => {
    setIsSubmitting(true);
    try {
      const result = await moveCategories({
        ids: selectedCategories.map((id) => Number(id)),
        targetParentId: moveTargetParentId,
      });

      if (result.success) {
        toast.success(`已移动 ${result.data?.moved || 0} 个分类`);
        closeBatchMoveDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedCategories([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量移动失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量删除对话框
  const openBatchDeleteDialog = () => {
    // 检查是否包含"未分类"分类
    const hasUncategorized = selectedCategories.some((id) => {
      const category = data.find((item) => item.id === Number(id));
      return category?.slug === "uncategorized";
    });

    if (hasUncategorized) {
      toast.error('选中的分类包含系统保留分类"未分类"，不允许删除');
      return;
    }

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
      const result = await deleteCategories({
        ids: selectedCategories.map((id) => Number(id)),
      });

      if (result.success) {
        const cascadeMsg =
          result.data && result.data.cascadeDeleted > 0
            ? `（级联删除了 ${result.data.cascadeDeleted} 个子分类）`
            : "";
        toast.success(
          `已删除 ${result.data?.deleted || 0} 个分类${cascadeMsg}`,
        );
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedCategories([]);
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

  // 批量操作按钮
  const batchActions: ActionButton[] = [
    {
      label: "批量移动",
      onClick: openBatchMoveDialog,
      icon: <RiFolderTransferLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "批量删除",
      onClick: openBatchDeleteDialog,
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 行操作按钮
  const rowActions = (record: CategoryListItem): ActionButton[] => {
    const actions: ActionButton[] = [
      {
        label: "查看文章",
        onClick: () => {
          navigate(`/admin/posts?category=${record.id}`);
        },
        icon: <RiFileListLine size="1em" />,
        variant: "ghost",
      },
      {
        label: "查看子分类",
        onClick: () => {
          const newPath = [...categoryPath, record.slug].join("/");
          navigate(`/admin/categories/${newPath}`);
        },
        icon: <RiFolder3Line size="1em" />,
        variant: "ghost",
      },
      {
        label: "编辑",
        onClick: () => openEditDialog(record),
        icon: <RiEditLine size="1em" />,
        variant: "ghost",
      },
    ];

    // "未分类"分类不允许移动和删除
    if (record.slug !== "uncategorized") {
      actions.push({
        label: "移动",
        onClick: () => openMoveDialog(record),
        icon: <RiFolderTransferLine size="1em" />,
        variant: "ghost",
      });
      actions.push({
        label: "删除",
        onClick: () => openDeleteDialog(record),
        icon: <RiDeleteBinLine size="1em" />,
        variant: "danger",
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
      key: "postId",
      label: "文章 ID",
      type: "input",
      placeholder: "输入文章 ID，多个用英文逗号分隔",
      inputType: "text",
    },
    {
      key: "hasZeroPosts",
      label: "文章关联",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "无文章关联" },
        { value: "false", label: "有文章关联" },
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
    if (message.type === "categories-refresh") {
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
          sortBy?:
            | "slug"
            | "name"
            | "directPostCount"
            | "totalPostCount"
            | "directChildCount"
            | "totalChildCount"
            | "createdAt"
            | "updatedAt";
          sortOrder?: "asc" | "desc";
          search?: string;
          parentId?: number | null;
          postIds?: number[];
          hasZeroPosts?: boolean;
          createdAtStart?: string;
          createdAtEnd?: string;
          updatedAtStart?: string;
          updatedAtEnd?: string;
        } = {
          page,
          pageSize,
          parentId: parentId,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "slug"
            | "name"
            | "directPostCount"
            | "totalPostCount"
            | "directChildCount"
            | "totalChildCount"
            | "createdAt"
            | "updatedAt";
          params.sortOrder = sortOrder;
        }

        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        if (filterValues.postId && typeof filterValues.postId === "string") {
          const postIdStr = filterValues.postId.trim();
          if (postIdStr) {
            const postIds = postIdStr
              .split(",")
              .map((id) => parseInt(id.trim(), 10))
              .filter((id) => !isNaN(id) && id > 0);
            if (postIds.length > 0) {
              params.postIds = postIds;
            }
          }
        }

        if (
          filterValues.hasZeroPosts &&
          Array.isArray(filterValues.hasZeroPosts) &&
          filterValues.hasZeroPosts.length === 1
        ) {
          params.hasZeroPosts = filterValues.hasZeroPosts[0] === "true";
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

        const result = await getCategoriesList({
          ...params,
          sortBy: params.sortBy || "totalPostCount",
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
        console.error("Failed to fetch categories list:", error);
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
    parentId,
  ]);

  const columns: TableColumn<CategoryListItem>[] = [
    {
      key: "slug",
      title: "Slug",
      dataIndex: "slug",
      align: "left",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm text-muted-foreground font-mono">
            {String(value)}
          </span>
        );
      },
    },
    {
      key: "name",
      title: "分类名称",
      dataIndex: "name",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return (
          <div className="flex flex-col">
            <span className="font-medium">{String(value)}</span>
          </div>
        );
      },
    },
    {
      key: "description",
      title: "描述",
      dataIndex: "description",
      align: "left",
      render: (value: unknown) => {
        return (
          <span className="text-sm text-muted-foreground truncate max-w-xs block">
            {value ? String(value) : "-"}
          </span>
        );
      },
    },
    {
      key: "directPostCount",
      title: "直属文章数",
      dataIndex: "directPostCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown, record: CategoryListItem) => {
        const count = Number(value);
        return (
          <Link
            href={`/admin/posts?category=${record.id}`}
            className="text-primary"
            presets={["hover-underline"]}
          >
            {count}
          </Link>
        );
      },
    },
    {
      key: "totalPostCount",
      title: "文章数",
      dataIndex: "totalPostCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown, record: CategoryListItem) => {
        const count = Number(value);
        return (
          <Link
            href={`/admin/posts?category=${record.id}`}
            className="text-primary"
            presets={["hover-underline"]}
            title="含子孙分类"
          >
            {count}
          </Link>
        );
      },
    },
    {
      key: "directChildCount",
      title: "直属子分类数",
      dataIndex: "directChildCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown, record: CategoryListItem) => {
        const count = Number(value);
        if (count === 0)
          return <span className="text-muted-foreground">0</span>;
        const newPath = [...categoryPath, record.slug].join("/");
        return (
          <Link
            href={`/admin/categories/${newPath}`}
            className="text-primary"
            presets={["hover-underline"]}
          >
            {count}
          </Link>
        );
      },
    },
    {
      key: "totalChildCount",
      title: "子分类数",
      dataIndex: "totalChildCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown, record: CategoryListItem) => {
        const count = Number(value);
        if (count === 0)
          return <span className="text-muted-foreground">0</span>;
        const newPath = [...categoryPath, record.slug].join("/");
        return (
          <Link
            href={`/admin/categories/${newPath}`}
            className="text-primary"
            presets={["hover-underline"]}
            title="含子孙分类"
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

  // 生成标题（包含面包屑导航）
  const renderTitle = () => {
    if (!currentCategory) {
      return <span className="text-xl">分类列表</span>;
    }

    return (
      <div className="flex items-center gap-2 text-xl">
        <Link
          href="/admin/categories"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          分类列表
        </Link>
        {categoryNamePath.map((name, index) => {
          const path = categoryPath.slice(0, index + 1);
          const isLast = index === categoryNamePath.length - 1;
          return (
            <div key={categoryPath[index]} className="flex items-center gap-2">
              <RiArrowRightLine
                size="0.8em"
                className="text-muted-foreground"
              />
              {isLast ? (
                <span>{name}</span>
              ) : (
                <Link
                  href={`/admin/categories/${path.join("/")}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {name}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <GridTable
        title={renderTitle()}
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
        searchPlaceholder="搜索分类名称..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无分类记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑分类对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`编辑分类 - ${editingCategory?.name || ""}`}
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-4">
            {/* 只有非"未分类"分类才显示 Slug 字段 */}
            {editingCategory?.slug !== "uncategorized" && (
              <Input
                label="Slug"
                value={editFormData.newSlug}
                onChange={(e) =>
                  setEditFormData((prev) => ({
                    ...prev,
                    newSlug: e.target.value,
                  }))
                }
                required
                size="sm"
                helperText="只能包含小写字母、数字和连字符"
              />
            )}
            <Input
              label="分类名称"
              value={editFormData.newName}
              onChange={(e) =>
                setEditFormData((prev) => ({
                  ...prev,
                  newName: e.target.value,
                }))
              }
              required
              size="sm"
            />
            {/* 为"未分类"分类显示特殊提示 */}
            {editingCategory?.slug === "uncategorized" ? (
              <p className="text-sm text-muted-foreground">
                此分类为系统默认分类，部分字段无法修改。
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                更改分类名称或 slug 会影响所有使用该分类的文章，请谨慎修改。
              </p>
            )}
            <Input
              label="描述"
              value={editFormData.description}
              onChange={(e) =>
                setEditFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              rows={3}
              size="sm"
            />
            <MediaSelector
              label="特色图片"
              value={editFormData.featuredImage}
              onChange={(url) =>
                setEditFormData((prev) => ({
                  ...prev,
                  featuredImage: Array.isArray(url) ? url[0] || "" : url,
                }))
              }
              helperText="分类的特色图片，用于展示在分类页面"
            />
            {/* "未分类"分类不允许设置父分类 */}
            {editingCategory?.slug !== "uncategorized" && (
              <CategoryInput
                label="父分类"
                value={editFormData.parentCategoryPath}
                onChange={(categoryPath, categoryId) =>
                  setEditFormData((prev) => ({
                    ...prev,
                    parentId: categoryId || null,
                    parentCategoryPath: categoryPath,
                  }))
                }
                placeholder="搜索或创建父分类（留空表示顶级分类）"
                size="sm"
                helperText="搜索并选择父分类，或留空表示顶级分类"
              />
            )}
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
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
              onClick={handleSaveCategory}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 移动单个分类对话框 */}
      <Dialog
        open={moveDialogOpen}
        onClose={closeMoveDialog}
        title={`移动分类 - ${movingCategory?.name || ""}`}
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <CategoryInput
            label="目标父分类"
            value={moveTargetCategoryPath}
            onChange={(categoryPath, categoryId) => {
              setMoveTargetParentId(categoryId || null);
              setMoveTargetCategoryPath(categoryPath);
            }}
            placeholder="搜索或创建目标父分类（留空表示移动到顶级）"
            size="sm"
            helperText="搜索并选择目标父分类，或留空表示移动到顶级"
          />

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeMoveDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="移动"
              variant="primary"
              onClick={handleConfirmMove}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 批量移动对话框 */}
      <Dialog
        open={batchMoveDialogOpen}
        onClose={closeBatchMoveDialog}
        title="批量移动分类"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将选中的 {selectedCategories.length} 个分类移动到指定父分类下
          </p>
          <CategoryInput
            label="目标父分类"
            value={moveTargetCategoryPath}
            onChange={(categoryPath, categoryId) => {
              setMoveTargetParentId(categoryId || null);
              setMoveTargetCategoryPath(categoryPath);
            }}
            placeholder="搜索或创建目标父分类（留空表示移动到顶级）"
            size="sm"
            helperText="搜索并选择目标父分类，或留空表示移动到顶级"
          />

          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchMoveDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="移动"
              variant="primary"
              onClick={handleConfirmBatchMove}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除单个分类确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除分类"
        description={
          deletingCategory
            ? `确定要删除分类 "${deletingCategory.name}" 吗？${deletingCategory.totalChildCount > 0 ? `该分类下有 ${deletingCategory.totalChildCount} 个子孙分类，删除后将会级联删除所有子分类。` : ""}删除后，该分类与文章的关联将被移除。`
            : ""
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
        description={`确定要删除选中的 ${selectedCategories.length} 个分类吗？如果这些分类下有子分类，将会级联删除所有子孙分类。删除后，这些分类与文章的关联将被移除。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />
    </>
  );
}
