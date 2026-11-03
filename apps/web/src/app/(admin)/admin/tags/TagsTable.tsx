"use client";

import { useEffect, useState } from "react";
import { RiDeleteBinLine, RiEditLine, RiFileListLine } from "@remixicon/react";
import type { TagListItem } from "@repo/shared-types/api/tag";

import { deleteTags, updateTag } from "@/actions/tag";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getTagsList } from "@/lib/client/api/tag";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

export default function TagsTable() {
  const toast = useToast();
  const [data, setData] = useState<TagListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>("postCount");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>("desc");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedTags, setSelectedTags] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const navigate = useNavigateWithTransition();

  // 编辑对话框
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagListItem | null>(null);
  const [editFormData, setEditFormData] = useState({
    slug: "",
    newSlug: "",
    name: "",
    newName: "",
    description: "",
    featuredImage: "",
  });

  // 删除对话框
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingTag, setDeletingTag] = useState<TagListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedTags(selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (tag: TagListItem) => {
    setEditingTag(tag);
    setEditFormData({
      slug: tag.slug,
      newSlug: tag.slug,
      name: tag.name,
      newName: tag.name,
      description: tag.description || "",
      featuredImage: tag.featuredImage || "",
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingTag(null);
  };

  // 保存标签编辑
  const handleSaveTag = async () => {
    if (!editingTag) return;

    setIsSubmitting(true);
    try {
      const updateData: {
        slug: string;
        newSlug?: string;
        newName?: string;
        description?: string;
        featuredImage?: string | null;
      } = {
        slug: editingTag.slug,
      };

      if (editFormData.newSlug !== editingTag.slug) {
        updateData.newSlug = editFormData.newSlug;
      }
      if (editFormData.newName !== editingTag.name) {
        updateData.newName = editFormData.newName;
      }
      if (editFormData.description !== (editingTag.description || "")) {
        updateData.description = editFormData.description || undefined;
      }
      if (editFormData.featuredImage !== (editingTag.featuredImage || "")) {
        updateData.featuredImage = editFormData.featuredImage || null;
      }

      if (
        !updateData.newSlug &&
        !updateData.newName &&
        updateData.description === undefined &&
        updateData.featuredImage === undefined
      ) {
        toast.info("没有字段被修改");
        setIsSubmitting(false);
        return;
      }

      const result = await updateTag(updateData);

      if (result.success) {
        toast.success(`标签已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("更新标签失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个标签对话框
  const openDeleteDialog = (tag: TagListItem) => {
    setDeletingTag(tag);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingTag(null);
  };

  // 确认删除单个标签
  const handleConfirmDelete = async () => {
    if (!deletingTag) return;

    setIsSubmitting(true);
    try {
      const result = await deleteTags({
        slugs: [deletingTag.slug],
      });

      if (result.success) {
        toast.success(`标签 "${deletingTag.name}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("删除标签失败:", error);
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
      const result = await deleteTags({
        slugs: selectedTags.map((slug) => String(slug)),
      });

      if (result.success) {
        toast.success(`已删除 ${result.data?.deleted || 0} 个标签`);
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedTags([]);
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
      label: "批量删除",
      onClick: openBatchDeleteDialog,
      icon: <RiDeleteBinLine size="1em" />,
      variant: "danger",
    },
  ];

  // 行操作按钮
  const rowActions = (record: TagListItem): ActionButton[] => [
    {
      label: "查看文章",
      onClick: () => {
        navigate(`/admin/posts?tag=${encodeURIComponent(record.name)}`);
      },
      icon: <RiFileListLine size="1em" />,
      variant: "ghost",
    },
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
    if (message.type === "tags-refresh") {
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
          sortBy?: "slug" | "name" | "postCount" | "createdAt" | "updatedAt";
          sortOrder?: "asc" | "desc";
          search?: string;
          postIds?: number[];
          hasZeroPosts?: boolean;
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
            | "slug"
            | "name"
            | "postCount"
            | "createdAt"
            | "updatedAt";
          params.sortOrder = sortOrder;
        }

        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        // 处理 postId 参数（支持逗号分隔的多个 ID）
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

        const result = await getTagsList({
          ...params,
          sortBy: params.sortBy || "postCount",
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
        console.error("Failed to fetch tags list:", error);
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

  const columns: TableColumn<TagListItem>[] = [
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
      title: "标签名称",
      dataIndex: "name",
      align: "left",
      sortable: true,
      render: (value: unknown) => {
        return <span className="font-medium">{String(value)}</span>;
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
      key: "postCount",
      title: "文章数",
      dataIndex: "postCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown, record: TagListItem) => {
        const count = Number(value);
        return (
          <Link
            href={`/admin/posts?tag=${encodeURIComponent(record.name)}`}
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
        title="标签列表"
        columns={columns}
        data={data}
        loading={loading}
        rowKey="slug"
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onSortChange={handleSortChange}
        onSearchChange={handleSearchChange}
        searchPlaceholder="搜索标签名称..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无标签记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑标签对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`编辑标签 - ${editingTag?.name || ""}`}
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-4">
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
            <Input
              label="标签名称"
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
            <p className="text-sm text-muted-foreground">
              更改标签名称或 slug 会影响所有使用该标签的文章，请谨慎修改。
            </p>
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
              helperText="标签的特色图片，用于展示在标签页面"
            />
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
              onClick={handleSaveTag}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除单个标签确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除标签"
        description={
          deletingTag
            ? `确定要删除标签 "${deletingTag.name}" 吗？删除后，该标签与文章的关联将被移除。`
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
        description={`确定要删除选中的 ${selectedTags.length} 个标签吗？删除后，这些标签与文章的关联将被移除。`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />
    </>
  );
}
