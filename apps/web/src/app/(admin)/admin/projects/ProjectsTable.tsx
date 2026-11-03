"use client";

import { useEffect, useState } from "react";
import {
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiFileEditLine,
  RiGithubFill,
  RiRefreshLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import type { ProjectListItem } from "@repo/shared-types/api/project";

import {
  deleteProjects,
  syncProjectsGithub,
  updateProject,
  updateProjects,
} from "@/actions/project";
import { createTag } from "@/actions/tag";
import { CategoryInput } from "@/components/client/features/categories/CategoryInput";
import MediaSelector from "@/components/client/features/media/MediaSelector";
import type { SelectedTag } from "@/components/client/features/tags/TagInput";
import { TagInput } from "@/components/client/features/tags/TagInput";
import type { ActionButton, FilterConfig } from "@/components/ui/GridTable";
import GridTable from "@/components/ui/GridTable";
import Link, { useNavigateWithTransition } from "@/components/ui/Link";
import { useBroadcast } from "@/hooks/use-broadcast";
import { getProjectsList } from "@/lib/client/api/project-read";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { SelectOption } from "@/ui/Select";
import { Select } from "@/ui/Select";
import type { TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";

export default function ProjectsTable() {
  const toast = useToast();
  const [data, setData] = useState<ProjectListItem[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedProjects, setSelectedProjects] = useState<(string | number)[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectListItem | null>(
    null,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingProject, setDeletingProject] =
    useState<ProjectListItem | null>(null);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [batchStatusDialogOpen, setBatchStatusDialogOpen] = useState(false);
  const [batchNewStatus, setBatchNewStatus] = useState("PUBLISHED");
  const [batchGithubSyncDialogOpen, setBatchGithubSyncDialogOpen] =
    useState(false);
  const [batchNewGithubSync, setBatchNewGithubSync] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contentSyncWarningDialogOpen, setContentSyncWarningDialogOpen] =
    useState(false);
  const [projectToEdit, setProjectToEdit] = useState<ProjectListItem | null>(
    null,
  );
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

  // 编辑项目状态
  const [formData, setFormData] = useState({
    title: "",
    slug: "",
    description: "",
    status: "PUBLISHED",
    demoUrl: "",
    repoUrl: "",
    urls: "",
    techStack: [] as string[],
    repoPath: "",
    license: "",
    enableGithubSync: false,
    enableConentSync: false,
    featuredImages: [] as string[],
    startedAt: "" as string | undefined,
    completedAt: "" as string | undefined,
    isFeatured: false,
    sortOrder: 0,
    metaDescription: "",
    metaKeywords: "",
    robotsIndex: true,
    tags: [] as SelectedTag[],
    category: null as string | null,
  });

  // 处理选中状态变化
  const handleSelectionChange = (selectedKeys: (string | number)[]) => {
    setSelectedProjects(selectedKeys);
  };

  // 打开编辑对话框
  const openEditDialog = (project: ProjectListItem) => {
    setEditingProject(project);
    // 定义扩展类型以访问 SEO 字段
    const projectWithSEO = project as ProjectListItem & {
      metaDescription?: string | null;
      metaKeywords?: string | null;
      robotsIndex?: boolean;
    };
    setFormData({
      title: project.title,
      slug: project.slug,
      description: project.description,
      status: project.status,
      demoUrl: project.demoUrl || "",
      repoUrl: project.repoUrl || "",
      urls: project.urls ? project.urls.join("\n") : "",
      techStack: project.techStack || [],
      repoPath: project.repoPath || "",
      license: project.license || "",
      enableGithubSync: project.enableGithubSync,
      enableConentSync: project.enableConentSync,
      featuredImages: project.featuredImages || [],
      startedAt: project.startedAt
        ? new Date(project.startedAt).toISOString().split("T")[0]
        : "",
      completedAt: project.completedAt
        ? new Date(project.completedAt).toISOString().split("T")[0]
        : "",
      isFeatured: project.isFeatured,
      sortOrder: project.sortOrder,
      metaDescription: projectWithSEO.metaDescription || "",
      metaKeywords: projectWithSEO.metaKeywords || "",
      robotsIndex: projectWithSEO.robotsIndex ?? true,
      tags: project.tags
        ? project.tags.map((tag) => ({
            name: tag.name,
            slug: tag.slug,
            isNew: false,
          }))
        : [],
      category: project.categories?.[0] || null,
    });
    setEditDialogOpen(true);
  };

  // 关闭编辑对话框
  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingProject(null);
  };

  // 处理编辑内容按钮点击
  const handleEditContentClick = (project: ProjectListItem) => {
    // 如果启用了 README 同步，显示警告对话框
    if (project.enableGithubSync && project.enableConentSync) {
      setProjectToEdit(project);
      setContentSyncWarningDialogOpen(true);
    } else {
      // 直接导航到编辑页面
      navigate(`/admin/projects/${project.slug}`);
    }
  };

  // 处理关闭 README 同步
  const handleDisableContentSync = async () => {
    if (!projectToEdit) return;

    setIsSubmitting(true);
    try {
      const accessToken = localStorage.getItem("access_token");
      const result = await updateProjects({
        access_token: accessToken || undefined,
        ids: [projectToEdit.id],
        enableConentSync: false,
      });

      if (result.success) {
        toast.success("已关闭 README 同步，可以安全编辑内容");
        setContentSyncWarningDialogOpen(false);
        // 导航到编辑页面
        navigate(`/admin/projects/${projectToEdit.slug}`);
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "操作失败");
      }
    } catch (error) {
      console.error("关闭 README 同步失败:", error);
      toast.error("操作失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 处理表单字段变化
  const handleFieldChange = (
    field: string,
    value: string | boolean | number | SelectedTag[] | string[] | null,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 保存项目编辑
  const handleSaveProject = async () => {
    if (!editingProject) return;

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

      const tagNames = formData.tags.map((tag) => tag.name);

      // 检查 tags 是否有变化
      const currentTagNames = editingProject.tags.map((tag) => tag.name);
      const tagsChanged =
        JSON.stringify(currentTagNames.sort()) !==
        JSON.stringify(tagNames.sort());

      // 检查 categories 是否有变化
      const currentCategories = editingProject.categories || [];
      const newCategory = formData.category;
      const categoriesChanged =
        (currentCategories.length === 0 && newCategory !== null) ||
        (currentCategories.length > 0 && newCategory !== currentCategories[0]);

      // 检查 urls 是否有变化
      const currentUrls = editingProject.urls || [];
      const newUrls = formData.urls
        ? formData.urls
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean)
        : [];
      const urlsChanged =
        JSON.stringify(currentUrls.sort()) !== JSON.stringify(newUrls.sort());

      // 检查其他字段是否有变化
      const accessToken = localStorage.getItem("access_token");

      // 定义扩展类型以访问 SEO 字段
      const editingProjectWithSEO = editingProject as ProjectListItem & {
        metaDescription?: string | null;
        metaKeywords?: string | null;
        robotsIndex?: boolean;
      };

      const result = await updateProject({
        access_token: accessToken || undefined,
        slug: editingProject.slug,
        title:
          formData.title !== editingProject.title ? formData.title : undefined,
        newSlug:
          formData.slug !== editingProject.slug ? formData.slug : undefined,
        description:
          formData.description !== editingProject.description
            ? formData.description
            : undefined,
        status:
          formData.status !== editingProject.status
            ? (formData.status as
                | "DRAFT"
                | "PUBLISHED"
                | "ARCHIVED"
                | "DEVELOPING")
            : undefined,
        demoUrl:
          formData.demoUrl !== (editingProject.demoUrl || "")
            ? formData.demoUrl
            : undefined,
        repoUrl:
          formData.repoUrl !== (editingProject.repoUrl || "")
            ? formData.repoUrl
            : undefined,
        urls: urlsChanged ? newUrls : undefined,
        techStack:
          JSON.stringify(formData.techStack) !==
          JSON.stringify(editingProject.techStack || [])
            ? formData.techStack
            : undefined,
        repoPath:
          formData.repoPath !== (editingProject.repoPath || "")
            ? formData.repoPath || null
            : undefined,
        license:
          formData.license !== (editingProject.license || "")
            ? formData.license || null
            : undefined,
        enableGithubSync:
          formData.enableGithubSync !== editingProject.enableGithubSync
            ? formData.enableGithubSync
            : undefined,
        enableConentSync:
          formData.enableConentSync !== editingProject.enableConentSync
            ? formData.enableConentSync
            : undefined,
        isFeatured:
          formData.isFeatured !== editingProject.isFeatured
            ? formData.isFeatured
            : undefined,
        sortOrder:
          formData.sortOrder !== editingProject.sortOrder
            ? formData.sortOrder
            : undefined,
        metaDescription:
          formData.metaDescription !==
          (editingProjectWithSEO.metaDescription || "")
            ? formData.metaDescription || null
            : undefined,
        metaKeywords:
          formData.metaKeywords !== (editingProjectWithSEO.metaKeywords || "")
            ? formData.metaKeywords || null
            : undefined,
        robotsIndex:
          formData.robotsIndex !== (editingProjectWithSEO.robotsIndex ?? true)
            ? formData.robotsIndex
            : undefined,
        featuredImages:
          JSON.stringify(formData.featuredImages) !==
          JSON.stringify(editingProject.featuredImages || [])
            ? formData.featuredImages
            : undefined,
        startedAt:
          formData.startedAt !=
          (editingProject.startedAt
            ? new Date(editingProject.startedAt).toISOString().split("T")[0]
            : "")
            ? formData.startedAt || undefined
            : undefined,
        completedAt:
          formData.completedAt !=
          (editingProject.completedAt
            ? new Date(editingProject.completedAt).toISOString().split("T")[0]
            : "")
            ? formData.completedAt || undefined
            : undefined,
        tags: tagsChanged ? tagNames : undefined,
        categories: categoriesChanged
          ? formData.category
            ? [formData.category]
            : []
          : undefined,
      });

      if (result.success) {
        toast.success(`项目 "${editingProject.title}" 已更新`);
        closeEditDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("更新项目失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 打开删除单个项目对话框
  const openDeleteDialog = (project: ProjectListItem) => {
    setDeletingProject(project);
    setDeleteDialogOpen(true);
  };

  // 关闭删除对话框
  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setDeletingProject(null);
  };

  // 确认删除单个项目
  const handleConfirmDelete = async () => {
    if (!deletingProject) return;

    setIsSubmitting(true);
    try {
      const result = await deleteProjects({
        ids: [deletingProject.id],
      });

      if (result.success) {
        toast.success(`项目 "${deletingProject.title}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("删除项目失败:", error);
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
      const result = await deleteProjects({
        ids: selectedProjects.map((id) => Number(id)),
      });

      if (result.success) {
        toast.success(`已删除 ${result.data?.deleted || 0} 个项目`);
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedProjects([]);
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
      const result = await updateProjects({
        ids: selectedProjects.map((id) => Number(id)),
        status: batchNewStatus as
          | "DRAFT"
          | "PUBLISHED"
          | "ARCHIVED"
          | "DEVELOPING",
      });

      if (result.success) {
        toast.success(`已更新 ${result.data?.updated || 0} 个项目的状态`);
        closeBatchStatusDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedProjects([]);
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

  // 打开批量更改 GitHub 同步对话框
  const openBatchGithubSyncDialog = () => {
    setBatchGithubSyncDialogOpen(true);
  };

  // 关闭批量更改 GitHub 同步对话框
  const closeBatchGithubSyncDialog = () => {
    setBatchGithubSyncDialogOpen(false);
  };

  // 确认批量更改 GitHub 同步
  const handleConfirmBatchGithubSync = async () => {
    setIsSubmitting(true);
    try {
      const result = await updateProjects({
        ids: selectedProjects.map((id) => Number(id)),
        enableGithubSync: batchNewGithubSync,
      });

      if (result.success) {
        toast.success(
          `已${batchNewGithubSync ? "启用" : "关闭"} ${result.data?.updated || 0} 个项目的 GitHub 同步`,
        );
        closeBatchGithubSyncDialog();
        setRefreshTrigger((prev) => prev + 1);
        setSelectedProjects([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量更改 GitHub 同步状态失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 批量 GitHub 同步
  const handleBatchSync = async () => {
    setIsSubmitting(true);
    try {
      const result = await syncProjectsGithub({
        ids: selectedProjects.map((id) => Number(id)),
      });

      if (result.success && result.data) {
        const { synced, failed } = result.data;
        if (failed > 0) {
          toast.warning(`同步完成：${synced} 成功，${failed} 失败`);
        } else {
          toast.success(`已同步 ${synced} 个项目`);
        }
        setRefreshTrigger((prev) => prev + 1);
        setSelectedProjects([]);
      } else {
        toast.error(result.message || "未知错误");
      }
    } catch (error) {
      console.error("批量同步失败:", error);
      toast.error("请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 直接同步单个项目
  const handleSyncProject = async (project: ProjectListItem) => {
    const toastId = toast.info("正在同步...", "正在连接 GitHub...", 0);

    try {
      const result = await syncProjectsGithub({
        ids: [project.id],
      });

      if (result.success && result.data) {
        const projectResult = result.data.results[0];
        if (projectResult?.success) {
          toast.update(
            toastId,
            "同步成功",
            `Stars: ${projectResult.stars}, Forks: ${projectResult.forks}`,
            "success",
          );
          setRefreshTrigger((prev) => prev + 1);
        } else {
          toast.update(
            toastId,
            "同步失败",
            projectResult?.error || "同步过程中发生错误",
            "error",
          );
        }
      } else {
        toast.update(
          toastId,
          "同步失败",
          result.message || "未知错误",
          "error",
        );
      }
    } catch (error) {
      console.error("同步项目失败:", error);
      toast.update(toastId, "同步出错", "网络请求失败", "error");
    }

    // 3秒后自动关闭
    setTimeout(() => toast.dismiss(toastId), 3000);
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
      label: "GitHub 同步设置",
      onClick: openBatchGithubSyncDialog,
      icon: <RiGithubFill size="1em" />,
      variant: "ghost",
    },
    {
      label: "立即同步",
      onClick: () => void handleBatchSync(),
      icon: <RiRefreshLine size="1em" />,
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
  const rowActions = (record: ProjectListItem): ActionButton[] => [
    {
      label: "预览",
      onClick: () => window.open(`/projects/${record.slug}`, "_blank"),
      icon: <RiEyeLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "编辑内容",
      onClick: () => handleEditContentClick(record),
      icon: <RiFileEditLine size="1em" />,
      variant: "ghost",
    },
    {
      label: "快速编辑",
      onClick: () => openEditDialog(record),
      icon: <RiEditLine size="1em" />,
      variant: "ghost",
    },
    ...(record.enableGithubSync && record.repoPath
      ? [
          {
            label: "GitHub 同步",
            onClick: () => handleSyncProject(record),
            icon: <RiRefreshLine size="1em" />,
            variant: "ghost" as const,
          },
        ]
      : []),
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
      key: "id",
      label: "项目 ID",
      type: "input",
      inputType: "number",
      placeholder: "输入项目 ID",
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
        { value: "DEVELOPING", label: "开发中" },
      ],
    },
    {
      key: "isFeatured",
      label: "精选",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "是" },
        { value: "false", label: "否" },
      ],
    },
    {
      key: "enableGithubSync",
      label: "GitHub 同步",
      type: "checkboxGroup",
      options: [
        { value: "true", label: "已启用" },
        { value: "false", label: "未启用" },
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
    if (message.type === "projects-refresh") {
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
            | "stars"
            | "forks"
            | "sortOrder";
          sortOrder?: "asc" | "desc";
          search?: string;
          id?: number;
          authorUid?: number;
          status?: ("DRAFT" | "PUBLISHED" | "ARCHIVED" | "DEVELOPING")[];
          enableGithubSync?: boolean[];
          isFeatured?: boolean;
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
            | "createdAt"
            | "stars"
            | "forks"
            | "sortOrder";
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
            | "DEVELOPING"
          )[];
        }

        if (
          filterValues.enableGithubSync &&
          Array.isArray(filterValues.enableGithubSync)
        ) {
          params.enableGithubSync = filterValues.enableGithubSync.map((v) =>
            typeof v === "string" ? v === "true" : Boolean(v),
          );
        }

        if (filterValues.isFeatured && Array.isArray(filterValues.isFeatured)) {
          params.isFeatured = filterValues.isFeatured[0] === "true";
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

        const accessToken = localStorage.getItem("access_token");

        const result = await getProjectsList({
          ...params,
          access_token: accessToken || undefined,
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
        console.error("Failed to fetch projects list:", error);
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

  const columns: TableColumn<ProjectListItem>[] = [
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
      render: (value: unknown, record: ProjectListItem) => {
        return (
          <div className="flex items-center gap-1">
            <Link
              href={`/projects/${record.slug}`}
              className="truncate max-w-xs block"
              presets={["hover-underline"]}
              title={String(value)}
              target="_blank"
            >
              {String(value)}
            </Link>
            {record.isFeatured && (
              <RiStarFill size="1em" className="text-yellow-500 shrink-0" />
            )}
          </div>
        );
      },
    },
    {
      key: "author",
      title: "作者",
      dataIndex: "author",
      align: "left",
      render: (value: unknown, record: ProjectListItem) => {
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
      render: (value: unknown, record: ProjectListItem) => {
        const tags = Array.isArray(value) ? value : [];
        return (
          <Link
            href={`/admin/tags/?projectId=${record.id}`}
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
              : status === "DEVELOPING"
                ? "bg-info/20 text-info"
                : "bg-muted/20 text-muted-foreground";
        const statusText =
          status === "PUBLISHED"
            ? "已发布"
            : status === "DRAFT"
              ? "草稿"
              : status === "DEVELOPING"
                ? "开发中"
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
      key: "stars",
      title: "Stars",
      dataIndex: "stars",
      align: "center",
      sortable: true,
      mono: true,
      render: (value: unknown) => {
        return (
          <span className="inline-flex items-center gap-1 text-sm">
            <RiStarLine size="1em" className="text-yellow-500" />
            {typeof value === "number" ? value.toLocaleString() : 0}
          </span>
        );
      },
    },
    {
      key: "sortOrder",
      title: "权重",
      dataIndex: "sortOrder",
      align: "center",
      sortable: true,
      mono: true,
    },
    {
      key: "enableGithubSync",
      title: "GitHub 同步",
      dataIndex: "enableGithubSync",
      align: "center",
      render: (value: unknown, record: ProjectListItem) => {
        if (!record.repoPath) {
          return (
            <span className="text-muted-foreground text-xs">未配置仓库</span>
          );
        }
        return value === true ? (
          <span className="flex justify-center text-success">
            {record.enableConentSync ? (
              <RiCheckDoubleLine size="1.5em" />
            ) : (
              <RiCheckLine size="1.5em" />
            )}
          </span>
        ) : (
          <span className="flex justify-center">
            <RiCloseLine size="1.5em" className="text-muted-foreground" />
          </span>
        );
      },
    },
    {
      key: "languages",
      title: "主要语言",
      dataIndex: "languages",
      align: "center",
      render: (value: unknown) => {
        if (!value || typeof value !== "object") {
          return <span className="text-muted-foreground text-xs">-</span>;
        }

        const languages = value as Record<string, number>;
        const entries = Object.entries(languages);

        if (entries.length === 0) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }

        // 找到字节数最多的语言
        const primaryLanguage = entries.reduce(
          (max, [lang, bytes]) => {
            return bytes > max.bytes ? { lang, bytes } : max;
          },
          { lang: "", bytes: 0 },
        );

        return (
          <span className="text-sm font-medium">{primaryLanguage.lang}</span>
        );
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
    { value: "DEVELOPING", label: "开发中" },
  ];

  return (
    <>
      <GridTable
        title={userRole === "AUTHOR" ? "我的项目" : "项目列表"}
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
        searchPlaceholder="搜索标题、Slug 或描述..."
        filterConfig={filterConfig}
        onFilterChange={handleFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无项目记录"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        onRowClick={(record) => openEditDialog(record)}
      />

      {/* 编辑项目对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        title={`快速编辑 - ${editingProject?.title || ""}`}
        size="lg"
      >
        <div className="px-6 py-6 space-y-8">
          {/* 基本信息 */}
          <section>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                基本信息
              </h3>
              <p className="text-sm text-muted-foreground">
                填写项目的基本信息。
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="项目标题"
                  value={formData.title}
                  onChange={(e) => handleFieldChange("title", e.target.value)}
                  required
                  size="sm"
                  helperText="项目的显示名称"
                />
                <Input
                  label="Slug"
                  value={formData.slug}
                  onChange={(e) => handleFieldChange("slug", e.target.value)}
                  size="sm"
                  helperText="URL 路径"
                />
              </div>
              <Input
                label="项目描述"
                value={formData.description}
                onChange={(e) =>
                  handleFieldChange("description", e.target.value)
                }
                rows={2}
                size="sm"
              />
              <Input
                label="技术栈"
                value={formData.techStack.join(", ")}
                onChange={(e) =>
                  handleFieldChange(
                    "techStack",
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                size="sm"
                helperText="多个技术栈用逗号分隔，如：React, TypeScript, Tailwind CSS"
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Input
                    label="开始时间"
                    type="date"
                    value={formData.startedAt}
                    onChange={(e) =>
                      handleFieldChange("startedAt", e.target.value)
                    }
                    size="sm"
                  />
                </div>
                <div className="space-y-2">
                  <Input
                    label="完成时间"
                    type="date"
                    value={formData.completedAt}
                    onChange={(e) =>
                      handleFieldChange("completedAt", e.target.value)
                    }
                    size="sm"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-4">
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
          </section>

          {/* 链接信息 */}
          <section>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                链接信息
              </h3>
              <p className="text-sm text-muted-foreground">
                用于在项目页面展示相关链接。
              </p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Demo URL"
                  value={formData.demoUrl}
                  onChange={(e) => handleFieldChange("demoUrl", e.target.value)}
                  size="sm"
                  helperText="项目演示地址"
                />
                <Input
                  label="仓库 URL"
                  value={formData.repoUrl}
                  onChange={(e) => handleFieldChange("repoUrl", e.target.value)}
                  size="sm"
                  helperText="GitHub/GitLab 等仓库地址"
                />
              </div>
              <Input
                label="其他链接 (Urls)"
                value={formData.urls}
                onChange={(e) => handleFieldChange("urls", e.target.value)}
                rows={3}
                size="sm"
                helperText="每行一个链接"
              />
            </div>
          </section>

          {/* 展示设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                展示设置
              </h3>
            </div>
            <div className="space-y-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-foreground">状态</label>
                <Select
                  value={formData.status}
                  onChange={(value) =>
                    handleFieldChange("status", value as string)
                  }
                  options={[
                    { value: "DRAFT", label: "草稿" },
                    { value: "PUBLISHED", label: "已发布" },
                    { value: "DEVELOPING", label: "开发中" },
                    { value: "ARCHIVED", label: "已归档" },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground">
                  置顶状态
                </label>
                <Select
                  value={formData.isFeatured ? "true" : "false"}
                  onChange={(value) =>
                    handleFieldChange("isFeatured", value === "true")
                  }
                  options={[
                    { value: "false", label: "常规" },
                    { value: "true", label: "置顶" },
                  ]}
                  size="sm"
                  className="w-full"
                />
              </div>
            </div>
            <Input
              label="排序权重"
              value={String(formData.sortOrder)}
              onChange={(e) =>
                handleFieldChange("sortOrder", parseInt(e.target.value) || 0)
              }
              type="number"
              size="sm"
              helperText="数字越大排序越靠前"
            />
          </section>

          {/* SEO 设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                SEO 设置
              </h3>
            </div>
            <div className="space-y-4">
              <Input
                label="Meta Description"
                value={formData.metaDescription}
                onChange={(e) =>
                  handleFieldChange("metaDescription", e.target.value)
                }
                rows={2}
                size="sm"
                helperText="SEO 描述，建议 160 字以内，留空则使用项目描述内容"
              />
              <Input
                label="Meta Keywords"
                value={formData.metaKeywords}
                onChange={(e) =>
                  handleFieldChange("metaKeywords", e.target.value)
                }
                size="sm"
                helperText="SEO 关键词，用逗号分隔"
              />
              <Checkbox
                label="允许搜索引擎索引 (Robots Index)"
                checked={formData.robotsIndex}
                onChange={(e) =>
                  handleFieldChange("robotsIndex", e.target.checked)
                }
              />
            </div>
          </section>

          {/* GitHub 同步设置 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                GitHub 同步
              </h3>
              <p className="text-sm text-muted-foreground">
                启用后将自动同步仓库的 Stars、Forks、语言等信息。
              </p>
            </div>
            <AutoResizer>
              <div className="space-y-4 flex flex-col">
                <Input
                  label="GitHub 仓库路径"
                  value={formData.repoPath}
                  onChange={(e) =>
                    handleFieldChange("repoPath", e.target.value)
                  }
                  size="sm"
                  helperText='格式：owner/repo，如 "RavelloH/NeutralPress"'
                />
                <Input
                  label="开源许可证"
                  value={formData.license}
                  onChange={(e) => handleFieldChange("license", e.target.value)}
                  size="sm"
                  helperText="项目的开源许可证类型，如：MIT、Apache-2.0"
                />
                <Checkbox
                  label="启用 GitHub 同步"
                  checked={formData.enableGithubSync}
                  onChange={(e) => {
                    handleFieldChange("enableGithubSync", e.target.checked);
                    if (!e.target.checked) {
                      handleFieldChange("enableConentSync", false);
                    }
                  }}
                />
                <AutoTransition className="flex flex-col space-y-4">
                  {formData.enableGithubSync && (
                    <Checkbox
                      label="同步 README 内容"
                      checked={formData.enableConentSync}
                      onChange={(e) =>
                        handleFieldChange("enableConentSync", e.target.checked)
                      }
                    />
                  )}
                </AutoTransition>
              </div>
            </AutoResizer>
          </section>

          {/* 特色图片 */}
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                特色图片
              </h3>
              <p className="text-sm text-muted-foreground">
                可以选择多张图片作为项目展示图。
              </p>
            </div>
            <MediaSelector
              label="特色图片"
              value={formData.featuredImages}
              onChange={(urls) =>
                handleFieldChange(
                  "featuredImages",
                  Array.isArray(urls) ? urls : urls ? [urls] : [],
                )
              }
              multiple
              helperText="选择或上传项目的特色图片"
            />
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
              onClick={handleSaveProject}
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
            将为选中的 {selectedProjects.length} 个项目更改状态
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

      {/* 批量更改 GitHub 同步对话框 */}
      <Dialog
        open={batchGithubSyncDialogOpen}
        onClose={closeBatchGithubSyncDialog}
        title="批量更改 GitHub 同步"
        size="sm"
      >
        <div className="px-6 py-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            将为选中的 {selectedProjects.length} 个项目更改 GitHub 同步状态
          </p>
          <div>
            <label className="block text-sm text-foreground mb-2">
              GitHub 同步
            </label>
            <Select
              value={batchNewGithubSync ? "true" : "false"}
              onChange={(value) => setBatchNewGithubSync(value === "true")}
              options={[
                { value: "true", label: "启用同步" },
                { value: "false", label: "关闭同步" },
              ]}
              size="sm"
              direcation="down"
            />
          </div>
          <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeBatchGithubSyncDialog}
              size="sm"
              disabled={isSubmitting}
            />
            <Button
              label="确认"
              variant="primary"
              onClick={handleConfirmBatchGithubSync}
              size="sm"
              loading={isSubmitting}
            />
          </div>
        </div>
      </Dialog>

      {/* 删除单个项目确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="确认删除项目"
        description={
          deletingProject
            ? `确定要删除项目 "${deletingProject.title}" 吗？`
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
        description={`确定要删除选中的 ${selectedProjects.length} 个项目吗？`}
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        loading={isSubmitting}
      />

      {/* README 同步警告对话框 */}
      <AlertDialog
        open={contentSyncWarningDialogOpen}
        onClose={() => {
          setContentSyncWarningDialogOpen(false);
          setProjectToEdit(null);
        }}
        onConfirm={handleDisableContentSync}
        title="警告：项目内容正在自动同步"
        description={
          projectToEdit
            ? `项目 "${projectToEdit.title}" 已启用 GitHub README 同步，内容将自动从 GitHub 覆盖。\n是否关闭同步以解锁编辑？`
            : ""
        }
        confirmText="关闭同步并编辑"
        cancelText="取消"
        variant="warning"
        loading={isSubmitting}
      />
    </>
  );
}
