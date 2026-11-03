"use client";

import { useEffect, useState } from "react";
import {
  RiBarChartBoxLine,
  RiCheckLine,
  RiCloseLine,
  RiCodeSSlashLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiFileEditLine,
  RiHistoryLine,
  RiPushpinLine,
  RiUnpinLine,
} from "@remixicon/react";
import type { PostListItem } from "@repo/shared-types/api/post";

import { deletePosts, updatePost, updatePosts } from "@/actions/post";
import { createTag } from "@/actions/tag";
import { CategoryInput } from "@/components/client/features/categories/CategoryInput";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import {
  hasPostAccessFormChanged,
  normalizePasswordLines,
  normalizePostAccessForm,
  PostAccessControlFields,
  type PostAccessFormValue,
  validatePostAccessForm,
} from "@/components/client/features/posts/PostAccessControlFields";
import PostLicensePicker from "@/components/client/features/posts/PostLicensePicker";
import type { SelectedTag } from "@/components/client/features/tags/TagInput";
import { TagInput } from "@/components/client/features/tags/TagInput";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link, { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getPostsList } from "@/lib/client/api/post-read";
import {
  fromStoredPostLicense,
  type PostLicenseSelection,
} from "@/lib/shared/post-license";
import { AlertDialog } from "@/ui/AlertDialog";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { SelectOption } from "@/ui/Select";
import { Select } from "@/ui/Select";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

interface PostQuickEditFormData extends PostAccessFormValue {
  title: string;
  slug: string;
  excerpt: string;
  status: string;
  isPinned: boolean;
  allowComments: boolean;
  robotsIndex: boolean;
  accessPasswordText: string;
  metaDescription: string;
  metaKeywords: string;
  featuredImage: string;
  license: PostLicenseSelection;
  postMode: "MARKDOWN" | "MDX";
  tags: SelectedTag[];
  category: string | null;
}

export default function PostsTable() {
  const toast = useToast();
  const [data, setData] = useState<PostListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedPosts, setSelectedPosts] = useState<(string | number)[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PostListItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState<PostListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchStatusDialogOpen, setBatchStatusDialogOpen] = useState(false);
  const [batchNewStatus, setBatchNewStatus] = useState("PUBLISHED");
  const [batchCommentsDialogOpen, setBatchCommentsDialogOpen] = useState(false);
  const [batchNewCommentsStatus, setBatchNewCommentsStatus] = useState(true);
  const [batchPinnedDialogOpen, setBatchPinnedDialogOpen] = useState(false);
  const [batchNewPinnedStatus, setBatchNewPinnedStatus] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigateWithTransition();
  const [userRole, setUserRole] = useState<string | null>(null);

  // 从 localStorage 读取用户角色
  useEffect(() => {
    try {
      const userInfo = localStorage.getItem("user_info");
      if (userInfo) {
        const parsed = JSON.parse(userInfo);
        setUserRole(parsed.role);
      }
    } catch (error) {
      console.error("Failed to parse user_info from localStorage:", error);
    }
  }, []);

  // 编辑文章状态
  const [formData, setFormData] = useState<PostQuickEditFormData>({
    title: "",
    slug: "",
    excerpt: "",
    status: "PUBLISHED",
    isPinned: false,
    allowComments: true,
    accessMode: "PUBLIC",
    minRole: null,
    accessPasswords: [],
    accessPasswordText: "",
    robotsIndex: true,
    metaDescription: "",
    metaKeywords: "",
    featuredImage: "",
    license: "default" as PostLicenseSelection,
    postMode: "MARKDOWN" as "MARKDOWN" | "MDX",
    tags: [] as SelectedTag[],
    category: null as string | null, // 单个分类
  });

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedPosts(selectedKeys);
    console.log("选中的文章 ID:", selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (post: PostListItem) => {
    setEditingPost(post);
    setFormData({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt || "",
      status: post.status,
      isPinned: post.isPinned,
      allowComments: post.allowComments,
      accessMode: post.accessMode,
      minRole: post.minRole,
      accessPasswords: post.accessPasswords,
      accessPasswordText: post.accessPasswords.join("\n"),
      robotsIndex: post.robotsIndex,
      metaDescription: post.metaDescription || "",
      metaKeywords: post.metaKeywords || "",
      featuredImage: post.featuredImage || "",
      license: fromStoredPostLicense(post.license),
      postMode: post.postMode,
      tags: post.tags
        ? post.tags.map((tag) => ({
            name: tag.name,
            slug: tag.slug,
            isNew: false,
          }))
        : [],
      category: post.categories?.[0] || null, // 只取第一个分类
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingPost(null);
  };

  // 处理表单字段变化
  const handleFieldChange = (
    field: string,
    value: string | boolean | SelectedTag[] | string | null,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const toPostAccessFormValue = (
    value: PostQuickEditFormData,
  ): PostAccessFormValue => ({
    accessMode: value.accessMode,
    minRole: value.minRole,
    accessPasswords:
      value.accessMode === "PASSWORD"
        ? normalizePasswordLines(value.accessPasswordText)
        : value.accessPasswords,
  });

  // 保存文章编辑
  const handleSavePost = async () => {
    if (!editingPost) return;

    const accessValidationMessage = validatePostAccessForm(
      toPostAccessFormValue(formData),
    );
    if (accessValidationMessage) {
      toast.error(accessValidationMessage);
      return;
    }

    setIsSubmitting(true);
    try {
      // 先创建新标签
      const newTags = formData.tags.filter((tag) => tag.isNew);
      if (newTags.length > 0) {
        const accessToken = localStorage.getItem("access_token");

        await Promise.all(
          newTags.map(async (tag) => {
            try {
              await createTag({
                access_token: accessToken || undefined,
                name: tag.name,
              });
            } catch (error) {
              console.error(`创建标签 "${tag.name}" 失败:`, error);
            }
          }),
        );
      }

      // 将 SelectedTag[] 转换为 string[](只包含名称)
      const tagNames = formData.tags.map((tag) => tag.name);

      // 检查 tags 是否有变化（比较名称数组）
      const currentTagNames = editingPost.tags.map((tag) => tag.name);
      const tagsChanged =
        JSON.stringify(currentTagNames.sort()) !==
        JSON.stringify(tagNames.sort());

      // 检查 categories 是否有变化
      const currentCategories = editingPost.categories || [];
      const newCategory = formData.category;
      const categoriesChanged =
        (currentCategories.length === 0 && newCategory !== null) ||
        (currentCategories.length > 0 && newCategory !== currentCategories[0]);

      const accessChanged = hasPostAccessFormChanged(
        editingPost,
        toPostAccessFormValue(formData),
      );

      // 检查其他字段是否有变化
      const hasChanges =
        formData.title !== editingPost.title ||
        formData.slug !== editingPost.slug ||
        formData.excerpt !== (editingPost.excerpt || "") ||
        formData.status !== editingPost.status ||
        formData.isPinned !== editingPost.isPinned ||
        formData.allowComments !== editingPost.allowComments ||
        formData.featuredImage !== (editingPost.featuredImage || "") ||
        formData.metaDescription !== (editingPost.metaDescription || "") ||
        formData.metaKeywords !== (editingPost.metaKeywords || "") ||
        formData.robotsIndex !== editingPost.robotsIndex ||
        formData.license !== fromStoredPostLicense(editingPost.license) ||
        formData.postMode !== editingPost.postMode ||
        accessChanged ||
        tagsChanged ||
        categoriesChanged;

      if (!hasChanges) {
        toast.info("没有字段被修改");
        setIsSubmitting(false);
        return;
      }

      const accessToken = localStorage.getItem("access_token");
      const normalizedAccess = normalizePostAccessForm(
        toPostAccessFormValue(formData),
      );

      // 使用 updatePost 而不是 updatePosts
      const result = await updatePost({
        access_token: accessToken || undefined,
        slug: editingPost.slug,
        title:
          formData.title !== editingPost.title ? formData.title : undefined,
        newSlug: formData.slug !== editingPost.slug ? formData.slug : undefined,
        excerpt:
          formData.excerpt !== (editingPost.excerpt || "")
            ? formData.excerpt
            : undefined,
        status:
          formData.status !== editingPost.status
            ? (formData.status as "DRAFT" | "PUBLISHED" | "ARCHIVED")
            : undefined,
        isPinned:
          formData.isPinned !== editingPost.isPinned
            ? formData.isPinned
            : undefined,
        allowComments:
          formData.allowComments !== editingPost.allowComments
            ? formData.allowComments
            : undefined,
        accessMode: accessChanged ? normalizedAccess.accessMode : undefined,
        minRole: accessChanged ? normalizedAccess.minRole : undefined,
        accessPasswords: accessChanged
          ? normalizedAccess.accessPasswords
          : undefined,
        featuredImage:
          formData.featuredImage !== (editingPost.featuredImage || "")
            ? formData.featuredImage
            : undefined,
        metaDescription:
          formData.metaDescription !== (editingPost.metaDescription || "")
            ? formData.metaDescription
            : undefined,
        metaKeywords:
          formData.metaKeywords !== (editingPost.metaKeywords || "")
            ? formData.metaKeywords
            : undefined,
        robotsIndex:
          formData.robotsIndex !== editingPost.robotsIndex
            ? formData.robotsIndex
            : undefined,
        license:
          formData.license !== fromStoredPostLicense(editingPost.license)
            ? formData.license
            : undefined,
        postMode:
          formData.postMode !== editingPost.postMode
            ? formData.postMode
            : undefined,
        tags: tagsChanged ? tagNames : undefined,
        categories: categoriesChanged
          ? formData.category
            ? [formData.category]
            : []
          : undefined,
      });

      if (result.success) {
        toast.success(`文章 "${editingPost.title}" 已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("更新文章失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个文章对话框
  const openDeleteDialog = (post: PostListItem) => {
    setDeletingPost(post);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingPost(null);
  };

  // 确认删除单个文章
  const handleConfirmDelete = async () => {
    if (!deletingPost) return;

    setIsSubmitting(true);
    try {
      const result = await deletePosts({
        ids: [deletingPost.id],
      });

      if (result.success) {
        toast.success(`文章 "${deletingPost.title}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("删除文章失败:", error);
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
      const result = await deletePosts({
        ids: selectedPosts.map((id) => Number(id)),
      });

      if (result.success) {
        toast.success(`已删除 ${result.data?.deleted || 0} 篇文章`);
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
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
      const result = await updatePosts({
        ids: selectedPosts.map((id) => Number(id)),
        status: batchNewStatus as "DRAFT" | "PUBLISHED" | "ARCHIVED",
      });

      if (result.success) {
        toast.success(`已更新 ${result.data?.updated || 0} 篇文章的状态`);
        closeBatchStatusDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
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

  // 打开批量更改评论状态对话框
  const openBatchCommentsDialog = () => {
    setBatchCommentsDialogOpen(true);
  };

  // 关闭批量更改评论状态对话框
  const closeBatchCommentsDialog = () => {
    setBatchCommentsDialogOpen(false);
  };

  // 确认批量更改评论状态
  const handleConfirmBatchComments = async () => {
    setIsSubmitting(true);
    try {
      const result = await updatePosts({
        ids: selectedPosts.map((id) => Number(id)),
        allowComments: batchNewCommentsStatus,
      });

      if (result.success) {
        toast.success(
          `已${batchNewCommentsStatus ? "开启" : "关闭"} ${result.data?.updated || 0} 篇文章的评论功能`,
        );
        closeBatchCommentsDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量更改评论状态失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开批量更改置顶状态对话框
  const openBatchPinnedDialog = () => {
    setBatchPinnedDialogOpen(true);
  };

  // 关闭批量更改置顶状态对话框
  const closeBatchPinnedDialog = () => {
    setBatchPinnedDialogOpen(false);
  };

  // 确认批量更改置顶状态
  const handleConfirmBatchPinned = async () => {
    setIsSubmitting(true);
    try {
      const result = await updatePosts({
        ids: selectedPosts.map((id) => Number(id)),
        isPinned: batchNewPinnedStatus,
      });

      if (result.success) {
        toast.success(
          `已${batchNewPinnedStatus ? "置顶" : "取消置顶"} ${result.data?.updated || 0} 篇文章`,
        );
        closeBatchPinnedDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedPosts([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量更改置顶状态失败:", error);
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
      icon: <RiFileEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "评论设置",
      onClick: openBatchCommentsDialog,
      icon: <RiCheckLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "置顶设置",
      onClick: openBatchPinnedDialog,
      icon: <RiPushpinLine size="1em" />,
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
  const rowActions = (record: PostListItem): ActionButton[] => [
    {
      label: "预览",
      onClick: () => navigate(`/admin/posts/${record.slug}/preview`),
      icon: <RiEyeLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "查看源代码",
      onClick: () => navigate(`/admin/posts/${record.slug}/source`),
      icon: <RiCodeSSlashLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "编辑内容",
      onClick: () => navigate("/admin/posts/" + record.slug),
      icon: <RiFileEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "快速编辑",
      onClick: () => openEditDialog(record),
      icon: <RiEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "历史版本",
      onClick: () => navigate("/admin/posts/" + record.slug + "/history"),
      icon: <RiHistoryLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "数据分析",
      onClick: () => navigate("/admin/analytics?path=/posts/" + record.slug),
      icon: <RiBarChartBoxLine size="1em" />,
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
    setPage(1); // 筛选变化时重置到第一页
  };

  // 筛选配置
  const filterConfig: FilterConfig[] = [
    {
      key: "id",
      label: "文章 ID",
      type: "input",
      inputType: "number",
      placeholder: "输入文章 ID",
    },
    {
      key: "authorUid",
      label: "作者 UID",
      type: "input",
      inputType: "number",
      placeholder: "输入作者 UID",
    },
    {
      key: "status",
      label: "状态",
      type: "checkboxGroup",
      options: [
        { value: "PUBLISHED", label: "已发布" },
        { value: "DRAFT", label: "草稿" },
        { value: "ARCHIVED", label: "已归档" },
      ],
    },
    {
      key: "isPinned",
      label: "置顶状态",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "已置顶" },
        { value: "false", label: "未置顶" },
      ],
    },
    {
      key: "allowComments",
      label: "评论状态",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "允许评论" },
        { value: "false", label: "禁止评论" },
      ],
    },
    {
      key: "robotsIndex",
      label: "搜索引擎索引",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "允许索引" },
        { value: "false", label: "禁止索引" },
      ],
    },
    {
      key: "publishedAt",
      label: "发布时间",
      type: "dateRange",
      dateFields: { start: "publishedAtStart", end: "publishedAtEnd" },
    },
    {
      key: "updatedAt",
      label: "更新时间",
      type: "dateRange",
      dateFields: { start: "updatedAtStart", end: "updatedAtEnd" },
    },
    {
      key: "createdAt",
      label: "创建时间",
      type: "dateRange",
      dateFields: { start: "createdAtStart", end: "createdAtEnd" },
    },
  ];

  // 监听广播刷新消息
  useBroadcast<{ type: string }>(async (message) => {
    if (message.type === "posts-refresh") {
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
            | "id"
            | "title"
            | "publishedAt"
            | "updatedAt"
            | "createdAt"
            | "viewCount";
          sortOrder?: "asc" | "desc";
          search?: string;
          id?: number;
          authorUid?: number;
          status?: ("DRAFT" | "PUBLISHED" | "ARCHIVED")[];
          isPinned?: boolean[];
          allowComments?: boolean[];
          robotsIndex?: boolean[];
          publishedAtStart?: string;
          publishedAtEnd?: string;
          updatedAtStart?: string;
          updatedAtEnd?: string;
          createdAtStart?: string;
          createdAtEnd?: string;
        } = {
          page,
          pageSize,
        };

        if (sortKey && sortOrder) {
          params.sortBy = sortKey as
            | "id"
            | "title"
            | "publishedAt"
            | "updatedAt"
            | "createdAt";
          params.sortOrder = sortOrder;
        }

        if (searchQuery && searchQuery.trim()) {
          params.search = searchQuery.trim();
        }

        // 添加筛选参数
        if (filterValues.id && typeof filterValues.id === "string") {
          params.id = parseInt(filterValues.id, 10);
        }

        if (
          filterValues.authorUid &&
          typeof filterValues.authorUid === "string"
        ) {
          params.authorUid = parseInt(filterValues.authorUid, 10);
        }

        if (filterValues.status && Array.isArray(filterValues.status)) {
          params.status = filterValues.status as (
            | "DRAFT"
            | "PUBLISHED"
            | "ARCHIVED"
          )[];
        }

        if (filterValues.isPinned && Array.isArray(filterValues.isPinned)) {
          params.isPinned = filterValues.isPinned.map((v) =>
            typeof v === "string" ? v === "true" : Boolean(v),
          );
        }

        if (
          filterValues.allowComments &&
          Array.isArray(filterValues.allowComments)
        ) {
          params.allowComments = filterValues.allowComments.map((v) =>
            typeof v === "string" ? v === "true" : Boolean(v),
          );
        }

        if (
          filterValues.robotsIndex &&
          Array.isArray(filterValues.robotsIndex)
        ) {
          params.robotsIndex = filterValues.robotsIndex.map((v) =>
            typeof v === "string" ? v === "true" : Boolean(v),
          );
        }

        if (
          filterValues.publishedAt &&
          typeof filterValues.publishedAt === "object"
        ) {
          const dateRange = filterValues.publishedAt as {
            start?: string;
            end?: string;
          };
          if (dateRange.start) {
            params.publishedAtStart = dateRange.start;
          }
          if (dateRange.end) {
            params.publishedAtEnd = dateRange.end;
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

        const result = await getPostsList({
          ...params,
          sortBy: params.sortBy || "id",
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
        console.error("Failed to fetch posts list:", error);
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

  const columns: TableColumn<PostListItem>[] = [
    {
      key: "id",
      title: "ID",
      dataIndex: "id",
      align: "left",
      sortable: true,
      mono: true,
    },
    {
      key: "title",
      title: "标题",
      dataIndex: "title",
      align: "left",
      sortable: true,
      render: (value: unknown, record: PostListItem) => {
        return (
          <Link
            href={`/posts/${record.slug}`}
            className="truncate max-w-xs block"
            presets={["hover-underline"]}
            title={String(value)}
            target="_blank"
          >
            {String(value)}
          </Link>
        );
      },
    },
    {
      key: "author",
      title: "作者",
      dataIndex: "author",
      align: "left",
      render: (value: unknown, record: PostListItem) => {
        const author = record.author;
        return (
          <Link
            href={`/admin/users?uid=${author.uid}`}
            presets={["hover-underline"]}
            title={`@${author.username}`}
          >
            {author.nickname || `@${author.username}`}
          </Link>
        );
      },
    },
    {
      key: "categories",
      title: "分类",
      dataIndex: "categories",
      align: "center",
      render: (value: unknown) => {
        const categories = Array.isArray(value) ? value : [];
        return (
          <span className="text-sm truncate max-w-20 block">
            {categories.length > 0 ? categories.join(", ") : "-"}
          </span>
        );
      },
    },
    {
      key: "tags",
      title: "标签",
      dataIndex: "tags",
      align: "center",
      render: (value: unknown, record: PostListItem) => {
        const tags = Array.isArray(value) ? value : [];
        return (
          <Link
            href={`/admin/tags/?postId=${record.id}`}
            presets={["hover-underline"]}
            className="text-primary"
          >
            {tags.length}
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
        const colorClass =
          status === "PUBLISHED"
            ? "bg-success/20 text-success"
            : status === "DRAFT"
              ? "bg-warning/20 text-warning"
              : "bg-muted/20 text-muted-foreground";
        const statusText =
          status === "PUBLISHED"
            ? "已发布"
            : status === "DRAFT"
              ? "草稿"
              : "已归档";
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
      key: "isPinned",
      title: "置顶",
      dataIndex: "isPinned",
      align: "center",
      render: (value: unknown) => {
        return value === true ? (
          <span className="flex justify-center text-primary">
            <RiPushpinLine size="1.3em" />
          </span>
        ) : (
          <span className="flex justify-center">
            <RiUnpinLine size="1.3em" className="text-muted-foreground" />
          </span>
        );
      },
    },
    {
      key: "allowComments",
      title: "评论",
      dataIndex: "allowComments",
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
      key: "viewCount",
      title: "浏览量",
      dataIndex: "viewCount",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        return (
          <span className="text-sm">
            {typeof value === "number" ? value.toLocaleString() : 0}
          </span>
        );
      },
    },
    {
      key: "publishedAt",
      title: "发布时间",
      dataIndex: "publishedAt",
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

  const statusOptions: SelectOption[] = [
    { value: "PUBLISHED", label: "已发布" },
    { value: "DRAFT", label: "草稿" },
    { value: "ARCHIVED", label: "已归档" },
  ];

  const postModeOptions: SelectOption[] = [
    { value: "MARKDOWN", label: "Markdown" },
    { value: "MDX", label: "MDX" },
  ];

  return (
    <>
      <GridTable
        title={userRole === "AUTHOR" ? "我的文章" : "文章列表"}
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
        searchPlaceholder="搜索标题、Slug 或摘要..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无文章记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑文章对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`快速编辑 - ${editingPost?.title || ""}`}
        size="lg"
      >
        <div className="px-6 py-6 space-y-6">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              基本信息
            </h3>
            <div className="grid grid-cols-1 gap-6">
              <Input
                label="标题"
                value={formData.title}
                onChange={(e) => handleFieldChange("title", e.target.value)}
                required
                size="sm"
              />
              <Input
                label="Slug"
                value={formData.slug}
                onChange={(e) => handleFieldChange("slug", e.target.value)}
                required
                size="sm"
              />
              <p className="text-sm text-muted-foreground">
                更改 Slug 可能会影响搜索引擎收录和已有的外部链接，请谨慎修改。
              </p>
              <Input
                label="摘要"
                value={formData.excerpt}
                onChange={(e) => handleFieldChange("excerpt", e.target.value)}
                rows={3}
                size="sm"
              />
              <TagInput
                label="标签"
                value={formData.tags}
                onChange={(tags) => handleFieldChange("tags", tags)}
                helperText="输入关键词搜索现有标签，或直接创建新标签"
                size="sm"
              />
              <CategoryInput
                label="分类"
                value={formData.category}
                onChange={(category) => handleFieldChange("category", category)}
                size="sm"
              />
            </div>
          </div>

          {/* 发布设置 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              发布设置
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                <p className="text-sm text-muted-foreground mt-4">
                  已发布：文章将在前台显示 <br />
                  草稿：文章仅后台可见，不会公开 <br />
                  已归档：文章不会显示在文章列表中，但仍可正常访问
                </p>
              </div>
              <div>
                <label className="block text-sm text-foreground mb-2">
                  编辑器模式
                </label>
                <Select
                  value={formData.postMode}
                  onChange={(value) =>
                    handleFieldChange("postMode", value as string)
                  }
                  options={postModeOptions}
                  size="sm"
                />
                <p className="text-sm text-muted-foreground mt-4">
                  Markdown：标准 Markdown 格式 <br />
                  MDX：支持在 Markdown 中使用 React 组件
                </p>
              </div>
              <div className="space-y-3 flex flex-col justify-center">
                <Checkbox
                  label="置顶文章"
                  checked={formData.isPinned}
                  onChange={(e) =>
                    handleFieldChange("isPinned", e.target.checked)
                  }
                />
                <Checkbox
                  label="允许评论"
                  checked={formData.allowComments}
                  onChange={(e) =>
                    handleFieldChange("allowComments", e.target.checked)
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              访问控制
            </h3>
            <PostAccessControlFields
              value={toPostAccessFormValue(formData)}
              onChange={(nextValue) =>
                setFormData((prev) => ({
                  ...prev,
                  ...nextValue,
                }))
              }
              passwordText={formData.accessPasswordText}
              onPasswordTextChange={(nextValue) =>
                setFormData((prev) => ({
                  ...prev,
                  accessPasswordText: nextValue,
                }))
              }
            />
          </div>

          {/* 版权许可 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              版权许可
            </h3>
            <PostLicensePicker
              value={formData.license}
              onChange={(license) => handleFieldChange("license", license)}
              disabled={isSubmitting}
            />
          </div>

          {/* SEO 设置 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              SEO 设置
            </h3>
            <div className="grid grid-cols-1 gap-6">
              <Input
                label="SEO 描述"
                value={formData.metaDescription}
                onChange={(e) =>
                  handleFieldChange("metaDescription", e.target.value)
                }
                rows={2}
                size="sm"
                helperText="用于搜索引擎结果展示"
              />
              <Input
                label="SEO 关键词"
                value={formData.metaKeywords}
                onChange={(e) =>
                  handleFieldChange("metaKeywords", e.target.value)
                }
                size="sm"
                helperText="多个关键词用逗号分隔"
              />
              <Checkbox
                label="允许搜索引擎索引"
                checked={formData.robotsIndex}
                onChange={(e) =>
                  handleFieldChange("robotsIndex", e.target.checked)
                }
              />
            </div>
          </div>

          {/* 特色图片 */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-foreground border-b border-foreground/10 pb-2">
              特色图片
            </h3>
            <MediaSelector
              label="特色图片"
              value={formData.featuredImage}
              onChange={(url) =>
                handleFieldChange(
                  "featuredImage",
                  Array.isArray(url) ? url[0] || "" : url,
                )
              }
              helperText="选择或上传文章的特色图片，将显示在文章列表和详情页顶部"
            />
          </div>

          {/* 操作按钮 */}
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
              onClick={handleSavePost}
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
            将为选中的 {selectedPosts.length} 篇文章更改状态
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
            已发布：文章将在前台显示 <br />
            草稿：文章仅后台可见，不会公开 <br />
            已归档：文章不会显示在文章列表中，但仍可正常访问
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

      {/* 删除单个文章确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除文章"
        description={
          deletingPost ? `确定要删除文章 "${deletingPost.title}" 吗？` : ""
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
        description={`确定要删除选中的 ${selectedPosts.length} 篇文章吗？`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* 批量更改评论状态对话框 */}
      <Dialog
        open={batchCommentsDialogOpen}
        onClose={closeBatchCommentsDialog}
        title="批量更改评论状态"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedPosts.length} 篇文章更改评论状态
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">
              评论状态
            </label>
            <Select
              value={batchNewCommentsStatus ? "true" : "false"}
              onChange={(value) => setBatchNewCommentsStatus(value === "true")}
              options={[
                { value: "true", label: "允许评论" },
                { value: "false", label: "禁止评论" },
              ]}
              size="sm"
              direcation="down"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            允许评论：用户可以对文章发表评论 <br />
            禁止评论：文章将不显示评论区
          </p>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchCommentsDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchComments}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 批量更改置顶状态对话框 */}
      <Dialog
        open={batchPinnedDialogOpen}
        onClose={closeBatchPinnedDialog}
        title="批量更改置顶状态"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedPosts.length} 篇文章更改置顶状态
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">
              置顶状态
            </label>
            <Select
              value={batchNewPinnedStatus ? "true" : "false"}
              onChange={(value) => setBatchNewPinnedStatus(value === "true")}
              options={[
                { value: "true", label: "置顶" },
                { value: "false", label: "取消置顶" },
              ]}
              size="sm"
              direcation="down"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            置顶：文章将显示在列表顶部 <br />
            取消置顶：文章按正常顺序排列
          </p>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchPinnedDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchPinned}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
