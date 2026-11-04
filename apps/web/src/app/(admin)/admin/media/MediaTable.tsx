"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RiCloseLine,
  RiDeleteBinLine,
  RiDragMoveLine,
  RiFileLine,
  RiGridLine,
  RiImageLine,
  RiListUnordered,
  RiMusicLine,
  RiVideoLine,
} from "@remixicon/react";
import type { MediaDetail, MediaListItem } from "@repo/shared-types/api/media";

import {
  batchUpdateMedia,
  type BreadcrumbItem,
  createFolder,
  deleteFolders,
  deleteMedia,
  ensureUserHomeFolder,
  type FolderItem,
  moveItems,
} from "@/actions/media";
import MediaEditDialog from "@/app/(admin)/admin/media/MediaEditDialog";
import MediaGridView from "@/app/(admin)/admin/media/MediaGridView";
import MediaPreviewDialog from "@/app/(admin)/admin/media/MediaPreviewDialog";
import MediaTableView from "@/app/(admin)/admin/media/MediaTableView";
import MoveDialog from "@/app/(admin)/admin/media/MoveDialog";
import RowGrid from "@/components/client/layout/RowGrid";
import type { FilterConfig } from "@/components/ui/GridTable";
import { useBroadcast } from "@/hooks/use-broadcast";
import { useMobile } from "@/hooks/use-mobile";
import {
  getMediaDetail,
  getMediaExplorerPage,
} from "@/lib/client/api/media-read";
import type { SelectedItems } from "@/types/media-table";
import { AlertDialog } from "@/ui/AlertDialog";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

// 每次加载的数量
const PAGE_SIZE = 50;

export default function MediaTable() {
  const toast = useToast();
  const isMobile = useMobile();

  // 数据状态
  const [data, setData] = useState<MediaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentPageSize, setCurrentPageSize] = useState(PAGE_SIZE);
  const pageRef = useRef(1); // 使用 ref 避免多次触发（用于无限滚动）

  // 视图模式
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  // 排序状态
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);

  // 搜索和筛选状态
  const [searchQuery, setSearchQuery] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSearchValueRef = useRef<string>("");
  const [filterValues, setFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  // 选中状态
  const [selectedItems, setSelectedItems] = useState<SelectedItems>({
    mediaIds: new Set(),
    folderIds: new Set(),
  });

  // 对话框状态
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

  // 媒体详情状态
  const [selectedMediaItem, setSelectedMediaItem] =
    useState<MediaListItem | null>(null);
  const [mediaDetail, setMediaDetail] = useState<MediaDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 提交状态
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 刷新触发器
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 创建文件夹状态
  const [createFolderLoading, setCreateFolderLoading] = useState(false);

  // 筛选临时值
  const [tempFilterValues, setTempFilterValues] = useState<
    Record<string, string | string[] | { start?: string; end?: string }>
  >({});

  // 用户信息和文件夹导航
  const [userRole, setUserRole] = useState<string>("");
  const [userUid, setUserUid] = useState<number>(0);
  const [username, setUsername] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string>("");
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([
    { id: null, name: "全部" },
  ]);

  // 从 localStorage 获取用户信息
  useEffect(() => {
    try {
      const userInfoStr = localStorage.getItem("user_info");
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        setUserRole(userInfo.role);
        setUserUid(userInfo.uid);
        setUsername(userInfo.username || "");
        const accessTokenStr = localStorage.getItem("access_token");
        if (accessTokenStr) {
          setAccessToken(accessTokenStr);
        }
      }
    } catch (error) {
      console.error("Failed to parse user info:", error);
    }
  }, []);

  // 重置数据（搜索/筛选/排序变化时调用）
  const resetData = useCallback(() => {
    setData([]);
    pageRef.current = 1;
    setHasMore(true);
  }, []);

  // 搜索输入变化处理（防抖）
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      if (searchValue !== lastSearchValueRef.current) {
        lastSearchValueRef.current = searchValue;
        setSearchQuery(searchValue);
        // 重置数据
        resetData();
      }
    }, 1000);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchValue, resetData]);

  // 构建请求参数
  const buildRequestParams = useCallback(
    (page: number) => {
      const params: {
        page: number;
        pageSize: number;
        sortBy?:
          | "id"
          | "createdAt"
          | "size"
          | "originalName"
          | "referencesCount";
        sortOrder?: "asc" | "desc";
        search?: string;
        mediaType?: "IMAGE" | "VIDEO" | "AUDIO" | "FILE";
        userUid?: number;
        sizeMin?: number;
        sizeMax?: number;
        inGallery?: boolean;
        isOptimized?: boolean;
        hasReferences?: boolean;
        createdAtStart?: string;
        createdAtEnd?: string;
      } = {
        page,
        pageSize: currentPageSize,
      };

      // 排序参数
      if (sortKey && sortOrder) {
        const mappedSortKey =
          sortKey === "postsCount" ? "referencesCount" : sortKey;
        params.sortBy = mappedSortKey as
          | "id"
          | "createdAt"
          | "size"
          | "originalName"
          | "referencesCount";
        params.sortOrder = sortOrder;
      }

      // 搜索参数
      if (searchQuery && searchQuery.trim()) {
        params.search = searchQuery.trim();
      }

      // 筛选参数
      if (filterValues.mediaType) {
        if (typeof filterValues.mediaType === "string") {
          params.mediaType = filterValues.mediaType as
            | "IMAGE"
            | "VIDEO"
            | "AUDIO"
            | "FILE";
        } else if (
          Array.isArray(filterValues.mediaType) &&
          filterValues.mediaType.length > 0
        ) {
          params.mediaType = filterValues.mediaType[0] as
            | "IMAGE"
            | "VIDEO"
            | "AUDIO"
            | "FILE";
        }
      }

      if (filterValues.userUid && typeof filterValues.userUid === "string") {
        params.userUid = parseInt(filterValues.userUid, 10);
      }

      if (filterValues.size && typeof filterValues.size === "object") {
        const sizeRange = filterValues.size as { start?: string; end?: string };
        if (sizeRange.start) params.sizeMin = parseInt(sizeRange.start, 10);
        if (sizeRange.end) params.sizeMax = parseInt(sizeRange.end, 10);
      }

      if (filterValues.inGallery) {
        if (typeof filterValues.inGallery === "string") {
          params.inGallery = filterValues.inGallery === "true";
        } else if (
          Array.isArray(filterValues.inGallery) &&
          filterValues.inGallery.length > 0
        ) {
          params.inGallery = filterValues.inGallery[0] === "true";
        }
      }

      if (filterValues.isOptimized) {
        if (typeof filterValues.isOptimized === "string") {
          params.isOptimized = filterValues.isOptimized === "true";
        } else if (
          Array.isArray(filterValues.isOptimized) &&
          filterValues.isOptimized.length > 0
        ) {
          params.isOptimized = filterValues.isOptimized[0] === "true";
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
        if (dateRange.start) params.createdAtStart = dateRange.start;
        if (dateRange.end) params.createdAtEnd = dateRange.end;
      }

      if (filterValues.hasReferences) {
        if (typeof filterValues.hasReferences === "string") {
          params.hasReferences = filterValues.hasReferences === "true";
        } else if (
          Array.isArray(filterValues.hasReferences) &&
          filterValues.hasReferences.length > 0
        ) {
          params.hasReferences = filterValues.hasReferences[0] === "true";
        }
      }

      return params;
    },
    [sortKey, sortOrder, searchQuery, filterValues, currentPageSize],
  );

  // 获取数据
  const fetchData = useCallback(
    async (page: number, append: boolean = false) => {
      setLoading(true);
      try {
        const params = buildRequestParams(page);
        const result = await getMediaExplorerPage({
          page: params.page,
          pageSize: params.pageSize,
          sortBy: params.sortBy || "createdAt",
          sortOrder: params.sortOrder || "desc",
          search: params.search,
          mediaType: params.mediaType,
          userUid: params.userUid,
          sizeMin: params.sizeMin,
          sizeMax: params.sizeMax,
          inGallery: params.inGallery,
          isOptimized: params.isOptimized,
          hasReferences: params.hasReferences,
          createdAtStart: params.createdAtStart,
          createdAtEnd: params.createdAtEnd,
          currentFolderId,
        });

        if (result.success && result.data) {
          const media = result.data.media || [];

          if (append) {
            setData((prev) => [...prev, ...media]);
          } else {
            setData(media);
          }
          setFolders(result.data.folders || []);
          setBreadcrumbItems(
            result.data.breadcrumb || [{ id: null, name: "全部" }],
          );
          setTotalRecords(result.meta?.total || 0);
          // 判断是否还有更多
          const pages = result.meta?.totalPages || 1;
          setTotalPages(pages);
          setHasMore(page < pages);
        }
      } catch (error) {
        console.error("Failed to fetch media list:", error);
      } finally {
        setLoading(false);
      }
    },
    [buildRequestParams, currentFolderId],
  );

  // 初始加载和参数变化时重新获取
  useEffect(() => {
    resetData();
    fetchData(1, false);
  }, [
    sortKey,
    sortOrder,
    searchQuery,
    filterValues,
    refreshTrigger,
    currentFolderId,
    resetData,
    fetchData,
  ]);

  // 加载更多（用于网格视图的无限滚动）
  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    fetchData(nextPage, true);
  }, [loading, hasMore, fetchData]);

  // 表格分页处理（用于表格视图）
  const handleTablePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      fetchData(page, false);
    },
    [fetchData],
  );

  const handleTablePageSizeChange = useCallback(
    (size: number) => {
      setCurrentPageSize(size);
      setCurrentPage(1);
      fetchData(1, false);
    },
    [fetchData],
  );

  // 监听广播刷新消息
  useBroadcast<{ type: string }>((message) => {
    if (message.type === "media-refresh") {
      setRefreshTrigger((prev) => prev + 1);
    }
  });

  // ===== 选中处理 =====
  const handleSelectMedia = useCallback((id: number, checked: boolean) => {
    setSelectedItems((prev) => {
      const newMediaIds = new Set(prev.mediaIds);
      if (checked) {
        newMediaIds.add(id);
      } else {
        newMediaIds.delete(id);
      }
      return { ...prev, mediaIds: newMediaIds };
    });
  }, []);

  const handleSelectFolder = useCallback((id: number, checked: boolean) => {
    setSelectedItems((prev) => {
      const newFolderIds = new Set(prev.folderIds);
      if (checked) {
        newFolderIds.add(id);
      } else {
        newFolderIds.delete(id);
      }
      return { ...prev, folderIds: newFolderIds };
    });
  }, []);

  const _handleSelectionChange = useCallback(
    (selectedKeys: (string | number)[]) => {
      setSelectedItems((prev) => ({
        ...prev,
        mediaIds: new Set(selectedKeys.map((k) => Number(k))),
      }));
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedItems({ mediaIds: new Set(), folderIds: new Set() });
  }, []);

  // ===== 文件夹导航处理 =====
  const enterFolder = useCallback(
    async (folderId: number | null) => {
      if (folderId === -1) {
        if (!accessToken || !userUid) {
          toast.error("用户信息未准备完成，请稍后重试");
          return;
        }

        const result = await ensureUserHomeFolder({
          access_token: accessToken,
          userUid,
          username,
        });

        if (result.success && result.data) {
          setCurrentFolderId(result.data.id);
          setCurrentPage(1);
          clearSelection();
        } else {
          toast.error(result.message || "无法进入我的文件夹");
        }
        return;
      }

      setCurrentFolderId(folderId);
      setCurrentPage(1);
      clearSelection();
    },
    [accessToken, userUid, username, toast, clearSelection],
  );

  const goBack = useCallback(() => {
    if (breadcrumbItems.length <= 1) return;
    const parentItem = breadcrumbItems[breadcrumbItems.length - 2];
    if (!parentItem) return;

    setCurrentFolderId(parentItem.id);
    setCurrentPage(1);
    clearSelection();
  }, [breadcrumbItems, clearSelection]);

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      const item = breadcrumbItems[index];
      if (!item) return;

      setCurrentFolderId(item.id);
      setCurrentPage(1);
      clearSelection();
    },
    [breadcrumbItems, clearSelection],
  );

  // 批量选择回调（用于框选）
  const handleBatchSelect = useCallback(
    (mediaIds: number[], folderIds: number[], append: boolean) => {
      if (append) {
        setSelectedItems((prev) => ({
          mediaIds: new Set([...prev.mediaIds, ...mediaIds]),
          folderIds: new Set([...prev.folderIds, ...folderIds]),
        }));
      } else {
        setSelectedItems({
          mediaIds: new Set(mediaIds),
          folderIds: new Set(folderIds),
        });
      }
    },
    [],
  );

  // 拖拽移动回调
  const handleDragMoveItems = useCallback(
    async (mediaIds: number[], folderIds: number[], targetFolderId: number) => {
      const result = await moveItems({
        access_token: accessToken,
        mediaIds: mediaIds.length > 0 ? mediaIds : undefined,
        folderIds: folderIds.length > 0 ? folderIds : undefined,
        targetFolderId,
      });
      if (result.success) {
        const total =
          (result.data?.movedMedia || 0) + (result.data?.movedFolders || 0);
        toast.success(`已移动 ${total} 个项目`);
        clearSelection();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "移动失败");
      }
    },
    [accessToken, toast, clearSelection],
  );

  // ===== 排序处理 =====
  const handleSortChange = useCallback(
    (key: string, order: "asc" | "desc" | null) => {
      setSortKey(order ? key : null);
      setSortOrder(order);
    },
    [],
  );

  // ===== 搜索处理 =====
  const handleSearchChange = useCallback((search: string) => {
    setSearchQuery((prev) => {
      if (search !== prev) {
        return search;
      }
      return prev;
    });
  }, []);

  // ===== 筛选处理 =====
  const handleFilterChange = useCallback(
    (
      filters: Record<
        string,
        string | string[] | { start?: string; end?: string }
      >,
    ) => {
      setFilterValues(filters);
    },
    [],
  );

  const openFilterDialog = useCallback(() => {
    setTempFilterValues({ ...filterValues });
    setFilterDialogOpen(true);
  }, [filterValues]);

  const closeFilterDialog = useCallback(() => {
    setFilterDialogOpen(false);
  }, []);

  const updateTempFilterValue = useCallback(
    (
      key: string,
      value: string | string[] | { start?: string; end?: string },
    ) => {
      setTempFilterValues((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
  );

  const toggleCheckboxOption = useCallback((key: string, option: string) => {
    setTempFilterValues((prev) => {
      const currentValue = prev[key];
      const currentArray = Array.isArray(currentValue) ? currentValue : [];

      if (currentArray.includes(option)) {
        const newArray = currentArray.filter((v) => v !== option);
        if (newArray.length === 0) {
          const { [key]: _, ...rest } = prev;
          return rest;
        }
        return { ...prev, [key]: newArray };
      } else {
        return { ...prev, [key]: [...currentArray, option] };
      }
    });
  }, []);

  const applyFilters = useCallback(() => {
    const cleanedFilters: Record<
      string,
      string | string[] | { start?: string; end?: string }
    > = {};
    Object.entries(tempFilterValues).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        if (value.length > 0) cleanedFilters[key] = value;
      } else if (
        typeof value === "object" &&
        value !== null &&
        "start" in value
      ) {
        if (value.start || value.end) cleanedFilters[key] = value;
      } else if (value !== "" && value !== undefined && value !== null) {
        cleanedFilters[key] = value as string;
      }
    });

    handleFilterChange(cleanedFilters);
    closeFilterDialog();
  }, [tempFilterValues, handleFilterChange, closeFilterDialog]);

  const resetFilters = useCallback(() => {
    setTempFilterValues({});
    handleFilterChange({});
    closeFilterDialog();
  }, [handleFilterChange, closeFilterDialog]);

  const hasActiveFilters = useMemo(() => {
    return Object.keys(filterValues).length > 0;
  }, [filterValues]);

  // 筛选配置
  const filterConfig: FilterConfig[] = useMemo(
    () => [
      {
        key: "mediaType",
        label: "文件类型",
        type: "checkboxGroup",
        options: [
          { value: "IMAGE", label: "图片" },
          { value: "VIDEO", label: "视频" },
          { value: "AUDIO", label: "音频" },
          { value: "FILE", label: "文件" },
        ],
      },
      {
        key: "userUid",
        label: "上传者 UID",
        type: "input",
        inputType: "number",
        placeholder: "输入用户 UID",
      },
      {
        key: "size",
        label: "文件大小",
        type: "range",
        rangeFields: { min: "sizeMin", max: "sizeMax" },
        inputType: "number",
        placeholderMin: "最小大小 (字节)",
        placeholderMax: "最大大小 (字节)",
      },
      {
        key: "inGallery",
        label: "在图库中显示",
        type: "checkboxGroup",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
      {
        key: "isOptimized",
        label: "已优化",
        type: "checkboxGroup",
        options: [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ],
      },
      {
        key: "hasReferences",
        label: "引用状态",
        type: "checkboxGroup",
        options: [
          { value: "true", label: "已被引用" },
          { value: "false", label: "未被引用" },
        ],
      },
      {
        key: "createdAt",
        label: "上传时间",
        type: "dateRange",
        dateFields: { start: "createdAtStart", end: "createdAtEnd" },
      },
    ],
    [],
  );

  // ===== 对话框处理 =====
  const openDetailDialog = useCallback(
    async (media: MediaListItem) => {
      setSelectedMediaItem(media);
      setDetailDialogOpen(true);
      setDetailLoading(true);

      try {
        const result = await getMediaDetail({ id: media.id });
        if (result.success && result.data) {
          setMediaDetail(result.data);
        } else {
          toast.error(result.message || "获取详情失败");
        }
      } catch (error) {
        console.error("Get media detail error:", error);
        toast.error("获取详情失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [toast],
  );

  const closeDetailDialog = useCallback(() => {
    setDetailDialogOpen(false);
    setSelectedMediaItem(null);
    setMediaDetail(null);
  }, []);

  const openEditDialog = useCallback((media: MediaListItem) => {
    setSelectedMediaItem(media);
    setEditDialogOpen(true);
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditDialogOpen(false);
    setSelectedMediaItem(null);
  }, []);

  const handleEditUpdate = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const openDeleteDialog = useCallback((media: MediaListItem) => {
    setSelectedMediaItem(media);
    setDeleteDialogOpen(true);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
    setSelectedMediaItem(null);
  }, []);

  // ===== 删除处理 =====
  const handleDelete = useCallback(async () => {
    if (!selectedMediaItem) return;

    setIsSubmitting(true);
    try {
      const result = await deleteMedia({ ids: [selectedMediaItem.id] });

      if (result.success) {
        toast.success(`文件 "${selectedMediaItem.originalName}" 已删除`);
        closeDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "删除失败");
      }
    } catch (error) {
      console.error("Delete media error:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedMediaItem, toast, closeDeleteDialog]);

  // ===== 批量操作 =====
  const handleBatchAddToGallery = useCallback(async () => {
    if (selectedItems.mediaIds.size === 0) return;

    setIsSubmitting(true);
    try {
      const result = await batchUpdateMedia({
        ids: Array.from(selectedItems.mediaIds),
        inGallery: true,
      });

      if (result.success) {
        toast.success(`已将 ${result.data?.updated || 0} 个文件加入图库`);
        clearSelection();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "操作失败");
      }
    } catch (error) {
      console.error("Batch add to gallery error:", error);
      toast.error("操作失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedItems.mediaIds, toast, clearSelection]);

  const handleBatchRemoveFromGallery = useCallback(async () => {
    if (selectedItems.mediaIds.size === 0) return;

    setIsSubmitting(true);
    try {
      const result = await batchUpdateMedia({
        ids: Array.from(selectedItems.mediaIds),
        inGallery: false,
      });

      if (result.success) {
        toast.success(`已将 ${result.data?.updated || 0} 个文件移出图库`);
        clearSelection();
        setRefreshTrigger((prev) => prev + 1);
      } else {
        toast.error(result.message || "操作失败");
      }
    } catch (error) {
      console.error("Batch remove from gallery error:", error);
      toast.error("操作失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedItems.mediaIds, toast, clearSelection]);

  const openBatchDeleteDialog = useCallback(() => {
    setBatchDeleteDialogOpen(true);
  }, []);

  const closeBatchDeleteDialog = useCallback(() => {
    setBatchDeleteDialogOpen(false);
  }, []);

  const handleConfirmBatchDelete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      let deletedFiles = 0;
      let deletedFolders = 0;

      // 删除媒体文件
      if (selectedItems.mediaIds.size > 0) {
        const mediaResult = await deleteMedia({
          ids: Array.from(selectedItems.mediaIds),
        });
        if (mediaResult.success) {
          deletedFiles = mediaResult.data?.deleted || 0;
        } else {
          toast.error(mediaResult.message || "删除文件失败");
        }
      }

      // 删除文件夹
      if (selectedItems.folderIds.size > 0) {
        const folderResult = await deleteFolders({
          access_token: accessToken,
          ids: Array.from(selectedItems.folderIds),
        });
        if (folderResult.success) {
          deletedFolders = folderResult.data?.deleted || 0;
          if (folderResult.data?.deletedMediaCount) {
            toast.info(
              `${folderResult.data.deletedMediaCount} 个文件已移至公共空间`,
            );
          }
        } else {
          toast.error(folderResult.message || "删除文件夹失败");
        }
      }

      if (deletedFiles > 0 || deletedFolders > 0) {
        const messages: string[] = [];
        if (deletedFiles > 0) messages.push(`${deletedFiles} 个文件`);
        if (deletedFolders > 0) messages.push(`${deletedFolders} 个文件夹`);
        toast.success(`已删除 ${messages.join("、")}`);
        clearSelection();
        closeBatchDeleteDialog();
        setRefreshTrigger((prev) => prev + 1);
      }
    } catch (error) {
      console.error("Batch delete error:", error);
      toast.error("删除失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    selectedItems,
    accessToken,
    toast,
    clearSelection,
    closeBatchDeleteDialog,
  ]);

  // ===== 移动操作 =====
  const openMoveDialog = useCallback(() => {
    setMoveDialogOpen(true);
  }, []);

  const closeMoveDialog = useCallback(() => {
    setMoveDialogOpen(false);
  }, []);

  const handleMove = useCallback(
    async (targetFolderId: number | null) => {
      setIsSubmitting(true);
      try {
        const result = await moveItems({
          access_token: accessToken,
          mediaIds:
            selectedItems.mediaIds.size > 0
              ? Array.from(selectedItems.mediaIds)
              : undefined,
          folderIds:
            selectedItems.folderIds.size > 0
              ? Array.from(selectedItems.folderIds)
              : undefined,
          targetFolderId,
        });

        if (result.success) {
          const messages: string[] = [];
          if (result.data?.movedMedia)
            messages.push(`${result.data.movedMedia} 个文件`);
          if (result.data?.movedFolders)
            messages.push(`${result.data.movedFolders} 个文件夹`);
          toast.success(`已移动 ${messages.join("、")}`);
          clearSelection();
          closeMoveDialog();
          setRefreshTrigger((prev) => prev + 1);
        } else {
          toast.error(result.message || "移动失败");
        }
      } catch (error) {
        console.error("Move error:", error);
        toast.error("移动失败，请稍后重试");
      } finally {
        setIsSubmitting(false);
      }
    },
    [accessToken, selectedItems, toast, clearSelection, closeMoveDialog],
  );

  // ===== 创建文件夹 =====
  const handleCreateFolder = useCallback(
    async (name: string): Promise<boolean> => {
      setCreateFolderLoading(true);
      try {
        const result = await createFolder({
          access_token: accessToken,
          name,
          parentId: currentFolderId,
        });

        if (result.success) {
          toast.success(`文件夹 "${name}" 创建成功`);
          setRefreshTrigger((prev) => prev + 1);
          return true;
        } else {
          toast.error(result.message || "创建文件夹失败");
          return false;
        }
      } catch (error) {
        console.error("Create folder error:", error);
        toast.error("创建文件夹失败，请稍后重试");
        return false;
      } finally {
        setCreateFolderLoading(false);
      }
    },
    [accessToken, currentFolderId, toast],
  );

  // ===== 工具函数 =====
  const formatFileSize = useCallback((bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }, []);

  const getFileTypeIcon = useCallback((type: string) => {
    switch (type) {
      case "IMAGE":
        return <RiImageLine size="1.2em" />;
      case "VIDEO":
        return <RiVideoLine size="1.2em" />;
      case "AUDIO":
        return <RiMusicLine size="1.2em" />;
      case "FILE":
        return <RiFileLine size="1.2em" />;
      default:
        return <RiFileLine size="1.2em" />;
    }
  }, []);

  // 批量操作按钮
  const batchActions = useMemo(
    () => [
      {
        label: "移动",
        onClick: openMoveDialog,
        icon: <RiDragMoveLine size="1em" />,
        variant: "ghost" as const,
      },
      {
        label: "加入图库",
        onClick: handleBatchAddToGallery,
        icon: <RiImageLine size="1em" />,
        variant: "ghost" as const,
        disabled: selectedItems.mediaIds.size === 0, // 只有选中文件时才可用
      },
      {
        label: "移出图库",
        onClick: handleBatchRemoveFromGallery,
        icon: <RiCloseLine size="1em" />,
        variant: "ghost" as const,
        disabled: selectedItems.mediaIds.size === 0, // 只有选中文件时才可用
      },
      {
        label: "删除",
        onClick: openBatchDeleteDialog,
        icon: <RiDeleteBinLine size="1em" />,
        variant: "danger" as const,
      },
    ],
    [
      openMoveDialog,
      handleBatchAddToGallery,
      handleBatchRemoveFromGallery,
      openBatchDeleteDialog,
      selectedItems.mediaIds.size,
    ],
  );

  // 视图切换器组件
  const viewModeToggle = useMemo(
    () => (
      <div className="flex items-center gap-1 bg-muted/30 rounded p-1 text-base">
        <Tooltip content="网格视图" placement="bottom">
          <Clickable
            onClick={() => setViewMode("grid")}
            className={`p-2 rounded transition-colors ${
              viewMode === "grid"
                ? "bg-foreground text-background"
                : "hover:bg-muted"
            }`}
            hoverScale={1.05}
          >
            <RiGridLine size="1em" />
          </Clickable>
        </Tooltip>
        <Tooltip content="表格视图" placement="bottom">
          <Clickable
            onClick={() => setViewMode("table")}
            className={`p-2 rounded transition-colors ${
              viewMode === "table"
                ? "bg-foreground text-background"
                : "hover:bg-muted"
            }`}
            hoverScale={1.05}
          >
            <RiListUnordered size="1em" />
          </Clickable>
        </Tooltip>
      </div>
    ),
    [viewMode],
  );

  return (
    <>
      <AutoTransition type="fade" duration={0.3}>
        {viewMode === "table" ? (
          <RowGrid key="media-table-view">
            <MediaTableView
              data={data}
              folders={folders}
              loading={loading}
              page={currentPage}
              totalPages={totalPages}
              totalRecords={totalRecords}
              pageSize={currentPageSize}
              onPageChange={handleTablePageChange}
              onPageSizeChange={handleTablePageSizeChange}
              onPreview={openDetailDialog}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              onEnterFolder={enterFolder}
              formatFileSize={formatFileSize}
              getFileTypeIcon={getFileTypeIcon}
              viewModeToggle={viewModeToggle}
              onSortChange={handleSortChange}
              onSearchChange={handleSearchChange}
              filterConfig={filterConfig}
              onFilterChange={handleFilterChange}
              batchActions={batchActions}
              selectedItems={selectedItems}
              onSelectMedia={handleSelectMedia}
              onSelectFolder={handleSelectFolder}
              onBatchSelect={handleBatchSelect}
              onClearSelection={clearSelection}
              currentFolderId={currentFolderId}
              breadcrumbItems={breadcrumbItems}
              onNavigateToBreadcrumb={navigateToBreadcrumb}
              onGoBack={goBack}
              onCreateFolder={handleCreateFolder}
              createFolderLoading={createFolderLoading}
              onMoveItems={handleDragMoveItems}
              currentUserId={userUid}
              isMobile={isMobile}
            />
          </RowGrid>
        ) : (
          <RowGrid key="media-grid-view">
            <MediaGridView
              data={data}
              folders={folders}
              loading={loading}
              hasMore={hasMore}
              selectedItems={selectedItems}
              onSelectMedia={handleSelectMedia}
              onSelectFolder={handleSelectFolder}
              onPreview={openDetailDialog}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              onEnterFolder={enterFolder}
              onLoadMore={handleLoadMore}
              formatFileSize={formatFileSize}
              getFileTypeIcon={getFileTypeIcon}
              currentUserId={userUid}
              isMobile={isMobile}
              viewModeToggle={viewModeToggle}
              searchValue={searchValue}
              onSearchValueChange={setSearchValue}
              onOpenSearchDialog={() => setSearchDialogOpen(true)}
              hasActiveFilters={hasActiveFilters}
              onOpenFilterDialog={openFilterDialog}
              batchActions={batchActions}
              currentFolderId={currentFolderId}
              breadcrumbItems={breadcrumbItems}
              onNavigateToBreadcrumb={navigateToBreadcrumb}
              onGoBack={goBack}
              onCreateFolder={handleCreateFolder}
              createFolderLoading={createFolderLoading}
              onMoveItems={handleDragMoveItems}
              onBatchSelect={handleBatchSelect}
              onClearSelection={clearSelection}
            />
          </RowGrid>
        )}
      </AutoTransition>

      {/* 详情对话框 */}
      <MediaPreviewDialog
        open={detailDialogOpen}
        onClose={closeDetailDialog}
        media={mediaDetail || selectedMediaItem}
        loading={detailLoading}
      />

      {/* 编辑对话框 */}
      <MediaEditDialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        media={selectedMediaItem}
        onUpdate={handleEditUpdate}
      />

      {/* 删除确认对话框 */}
      <AlertDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        title="确认删除文件"
        description={
          selectedMediaItem
            ? `确定要删除文件 "${selectedMediaItem.originalName}" 吗？此操作不可撤销。`
            : ""
        }
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleDelete}
        variant="danger"
        loading={isSubmitting}
      />

      {/* 批量删除确认对话框 */}
      <AlertDialog
        open={batchDeleteDialogOpen}
        onClose={closeBatchDeleteDialog}
        title="确认批量删除"
        description={`确定要删除选中的${selectedItems.mediaIds.size > 0 ? ` ${selectedItems.mediaIds.size} 个文件` : ""}${selectedItems.mediaIds.size > 0 && selectedItems.folderIds.size > 0 ? "和" : ""}${selectedItems.folderIds.size > 0 ? ` ${selectedItems.folderIds.size} 个文件夹` : ""}吗？此操作不可撤销。${selectedItems.folderIds.size > 0 ? "文件夹中的文件将被移至公共空间。" : ""}`}
        confirmText="删除"
        cancelText="取消"
        onConfirm={handleConfirmBatchDelete}
        variant="danger"
        loading={isSubmitting}
      />

      {/* 移动对话框 */}
      <MoveDialog
        open={moveDialogOpen}
        onClose={closeMoveDialog}
        onConfirm={handleMove}
        userRole={userRole}
        userUid={userUid}
        selectedFolderIds={Array.from(selectedItems.folderIds)}
        loading={isSubmitting}
      />

      {/* 筛选 Dialog */}
      <Dialog
        open={filterDialogOpen}
        onClose={closeFilterDialog}
        title="筛选条件"
        size="md"
      >
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-6">
            {filterConfig.map((config) => (
              <div key={config.key}>
                {config.type !== "input" && (
                  <label className="block text-sm font-medium text-foreground mb-3">
                    {config.label}
                  </label>
                )}
                {config.type === "checkboxGroup" && config.options && (
                  <div className="flex gap-4">
                    {config.options.map((option) => {
                      const currentValue = tempFilterValues[config.key];
                      const currentArray = Array.isArray(currentValue)
                        ? currentValue
                        : [];
                      return (
                        <Checkbox
                          key={option.value}
                          label={option.label}
                          checked={currentArray.includes(String(option.value))}
                          onChange={() =>
                            toggleCheckboxOption(
                              config.key,
                              String(option.value),
                            )
                          }
                        />
                      );
                    })}
                  </div>
                )}
                {config.type === "input" && (
                  <Input
                    label={config.label}
                    value={(tempFilterValues[config.key] as string) || ""}
                    onChange={(e) =>
                      updateTempFilterValue(config.key, e.target.value)
                    }
                    helperText={config.placeholder}
                    type={config.inputType || "text"}
                    size="sm"
                  />
                )}
                {config.type === "dateRange" && config.dateFields && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Input
                        label="开始时间"
                        type="datetime-local"
                        value={
                          ((
                            tempFilterValues[config.key] as
                              | { start?: string; end?: string }
                              | undefined
                          )?.start || "") as string
                        }
                        onChange={(e) => {
                          const currentValue = tempFilterValues[config.key] as
                            | { start?: string; end?: string }
                            | undefined;
                          updateTempFilterValue(config.key, {
                            start: e.target.value || undefined,
                            end: currentValue?.end,
                          });
                        }}
                        size="sm"
                      />
                    </div>
                    <div>
                      <Input
                        label="结束时间"
                        type="datetime-local"
                        value={
                          ((
                            tempFilterValues[config.key] as
                              | { start?: string; end?: string }
                              | undefined
                          )?.end || "") as string
                        }
                        onChange={(e) => {
                          const currentValue = tempFilterValues[config.key] as
                            | { start?: string; end?: string }
                            | undefined;
                          updateTempFilterValue(config.key, {
                            start: currentValue?.start,
                            end: e.target.value || undefined,
                          });
                        }}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
                {config.type === "range" && config.rangeFields && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Input
                        label={config.placeholderMin || "最小值"}
                        type={config.inputType || "number"}
                        value={
                          ((
                            tempFilterValues[config.key] as
                              | { start?: string; end?: string }
                              | undefined
                          )?.start || "") as string
                        }
                        onChange={(e) => {
                          const currentValue = tempFilterValues[config.key] as
                            | { start?: string; end?: string }
                            | undefined;
                          updateTempFilterValue(config.key, {
                            start: e.target.value || undefined,
                            end: currentValue?.end,
                          });
                        }}
                        size="sm"
                      />
                    </div>
                    <div>
                      <Input
                        label={config.placeholderMax || "最大值"}
                        type={config.inputType || "number"}
                        value={
                          ((
                            tempFilterValues[config.key] as
                              | { start?: string; end?: string }
                              | undefined
                          )?.end || "") as string
                        }
                        onChange={(e) => {
                          const currentValue = tempFilterValues[config.key] as
                            | { start?: string; end?: string }
                            | undefined;
                          updateTempFilterValue(config.key, {
                            start: currentValue?.start,
                            end: e.target.value || undefined,
                          });
                        }}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-between pt-4 border-t border-foreground/10">
            <Button
              label="重置"
              variant="ghost"
              onClick={resetFilters}
              size="sm"
            />
            <div className="flex gap-4">
              <Button
                label="取消"
                variant="ghost"
                onClick={closeFilterDialog}
                size="sm"
              />
              <Button
                label="确认"
                variant="primary"
                onClick={applyFilters}
                size="sm"
              />
            </div>
          </div>
        </div>
      </Dialog>

      {/* 搜索 Dialog（移动端） */}
      <Dialog
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
        title="搜索"
        size="sm"
      >
        <div className="px-6 py-6">
          <Input
            label="搜索关键词"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            helperText="搜索显示名称、原始文件名或替代文本..."
            type="text"
            size="md"
            autoFocus
          />
          <div className="flex justify-end gap-4 pt-6 border-t border-foreground/10 mt-6">
            <Button
              label="取消"
              variant="ghost"
              onClick={() => setSearchDialogOpen(false)}
              size="sm"
            />
            <Button
              label="搜索"
              variant="primary"
              onClick={() => setSearchDialogOpen(false)}
              size="sm"
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
