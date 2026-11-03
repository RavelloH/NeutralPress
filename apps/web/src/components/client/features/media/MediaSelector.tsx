"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiCloseLine,
  RiEditLine,
  RiFolderLine,
  RiFolderOpenLine,
  RiImageLine,
  RiSearchLine,
  RiUploadLine,
} from "@remixicon/react";
import { type MediaListItem } from "@repo/shared-types/api/media";
import { AnimatePresence, motion } from "framer-motion";

import FolderPickerDialog from "@/app/(admin)/admin/media/FolderPickerDialog";
import CMSImage from "@/components/ui/CMSImage";
import { FileListItem } from "@/components/ui/FileListItem";
import {
  type MarqueeHit,
  useMarqueeSelection,
} from "@/hooks/use-marquee-selection";
import { useMediaImport } from "@/hooks/use-media-import";
import { type ProcessMode, useMediaUpload } from "@/hooks/use-media-upload";
import { useStorageProviders } from "@/hooks/use-storage-providers";
import { useUserInfo } from "@/hooks/use-user-info";
import { getMediaList } from "@/lib/client/api/media-read";
import {
  type BreadcrumbItem,
  type FolderItem,
  formatFolderName,
  getAccessibleFolders,
  getFolderBreadcrumb,
} from "@/lib/client/folder-utils";
import debounce from "@/lib/shared/debounce";
import { formatBytes } from "@/lib/shared/format";
import { AutoResizer } from "@/ui/AutoResizer";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Select } from "@/ui/Select";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

interface MediaSelectorProps {
  value?: string | string[];
  onChange: (url: string | string[]) => void;
  multiple?: boolean;
  label?: string;
  helperText?: string;
  /** 默认打开的标签页 */
  defaultTab?: "select" | "upload" | "url";
  /** 受控模式：对话框是否打开 */
  open?: boolean;
  /** 受控模式：对话框状态变化回调 */
  onOpenChange?: (open: boolean) => void;
  /** 是否隐藏触发按钮（用于外部控制打开） */
  hideTrigger?: boolean;
  /** 最大选择数量（仅多选模式） */
  maxCount?: number;
}

export default function MediaSelector({
  value,
  onChange,
  multiple = false,
  label = "图片",
  helperText,
  defaultTab = "select",
  open,
  onOpenChange,
  hideTrigger = false,
  maxCount,
}: MediaSelectorProps) {
  // ========== 对话框控制 ==========
  const isControlled = open !== undefined;
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const dialogOpen = isControlled ? open : internalDialogOpen;

  const setDialogOpen = useCallback(
    (value: boolean) => {
      if (isControlled) {
        onOpenChange?.(value);
      } else {
        setInternalDialogOpen(value);
      }
    },
    [isControlled, onOpenChange],
  );

  const [activeTab, setActiveTab] = useState<"select" | "upload" | "url">(
    defaultTab,
  );
  const toast = useToast();

  // ========== 用户信息 ==========
  const userInfo = useUserInfo();
  const userRole = userInfo?.role || "";
  const userUid = userInfo?.uid || 0;

  // ========== 选择标签页状态 ==========
  const [mediaList, setMediaList] = useState<MediaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    new Set(),
  );

  // 文件夹导航状态（默认根目录 null，与 MediaGridView 一致）
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  // 搜索状态
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // 框选状态
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<number>>(
    new Set(),
  );

  // Intersection Observer 哨兵 - 用于懒加载
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    skip: !hasMore,
  });

  // ========== 上传标签页状态 ==========
  const [uploadMode, setUploadMode] = useState<ProcessMode>("lossy");
  const [uploadFolderId, setUploadFolderId] = useState<number | null>(null);
  const [uploadFolderName, setUploadFolderName] = useState<string>("公共空间");
  const [uploadFolderPickerOpen, setUploadFolderPickerOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // 存储提供商
  const {
    providers: storageProviders,
    selectedId: selectedStorageId,
    setSelectedId: setSelectedStorageId,
    loading: loadingProviders,
  } = useStorageProviders({
    enabled: Boolean(userRole && userRole !== "AUTHOR"),
    filterVirtual: false,
  });

  // 上传 Hook
  const {
    files: uploadFiles,
    uploading,
    handleFileSelect,
    handlePaste,
    uploadAll,
    retryFile,
    removeFile,
    updateFileName,
    getDisplayFileName,
    handleImageError: handleUploadImageError,
    clearFiles,
  } = useMediaUpload({
    mode: uploadMode,
    storageId: selectedStorageId,
    folderId: uploadFolderId,
    multiple,
  });

  // ========== URL 标签页状态 ==========
  const [importMode, setImportMode] = useState<"record" | "transfer">("record");
  const [importProcessMode, setImportProcessMode] =
    useState<ProcessMode>("lossy");
  const [importFolderId, setImportFolderId] = useState<number | null>(null);
  const [importFolderName, setImportFolderName] = useState<string>("公共空间");
  const [importFolderPickerOpen, setImportFolderPickerOpen] = useState(false);

  // 导入 Hook
  const {
    items: importItems,
    importing,
    urlInput,
    setUrlInput,
    handleInputKeyDown,
    handleInputPaste,
    importAll,
    retryItem,
    removeItem,
    updateItemFileName,
    getDisplayFileName: getImportDisplayFileName,
    handleImageError: handleImportImageError,
    clearItems,
  } = useMediaImport({
    importMode,
    processMode: importProcessMode,
    storageId: selectedStorageId,
    folderId: importFolderId,
  });

  // ========== Refs ==========
  const loadingRef = useRef(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);

  // 多选模式预览轮播状态
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);

  // ========== Effects ==========

  // 多选模式自动轮播
  useEffect(() => {
    if (multiple && Array.isArray(value) && value.length > 1) {
      const interval = setInterval(() => {
        setPreviewActiveIndex((prev) => (prev + 1) % value.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [multiple, value]);

  // 监听 Shift 键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // 监听粘贴事件
  useEffect(() => {
    if (dialogOpen && activeTab === "upload") {
      document.addEventListener("paste", handlePaste);
      return () => document.removeEventListener("paste", handlePaste);
    }
  }, [dialogOpen, activeTab, handlePaste]);

  // 防抖搜索
  useEffect(() => {
    const debouncedSetSearch = debounce((query: string) => {
      setDebouncedSearch(query);
    }, 300);

    debouncedSetSearch(searchQuery);
    return () => debouncedSetSearch.cancel();
  }, [searchQuery]);

  // 加载默认文件夹（选择标签页使用根目录 null，上传/导入使用公共空间）
  useEffect(() => {
    if (userRole && userUid > 0 && dialogOpen) {
      getAccessibleFolders(userRole, userUid, "", null)
        .then(({ publicRootId: rootId }) => {
          if (rootId !== null) {
            // 上传和导入的默认文件夹是公共空间
            setUploadFolderId(rootId);
            setImportFolderId(rootId);
          }
          // 选择标签页的 currentFolderId 保持为 null（根目录）
        })
        .catch((err) => console.error("Failed to fetch folders:", err));
    }
  }, [userRole, userUid, dialogOpen]);

  // 加载媒体列表
  const loadMediaList = useCallback(
    async (pageToLoad: number, append: boolean = false) => {
      if (loadingRef.current) return;

      loadingRef.current = true;
      setLoading(true);
      try {
        // 搜索时不传 folderId，让后端返回所有匹配结果（会自动过滤权限）
        const result = await getMediaList({
          page: pageToLoad,
          pageSize: 24,
          sortBy: "createdAt",
          sortOrder: "desc",
          mediaType: "IMAGE",
          folderId: debouncedSearch ? undefined : currentFolderId,
          search: debouncedSearch || undefined,
        });

        if (result.success && result.data) {
          const data = result.data;
          if (append) {
            setMediaList((prev) => [...prev, ...data]);
          } else {
            setMediaList(data);
          }

          if (result.meta) {
            const hasMoreData = pageToLoad < result.meta.totalPages;
            setHasMore(hasMoreData);
            hasMoreRef.current = hasMoreData;
          }

          pageRef.current = pageToLoad;
        }
      } catch (error) {
        console.error("Failed to load media list:", error);
        toast.error("加载图片列表失败");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [toast, currentFolderId, debouncedSearch],
  );

  // 加载文件夹列表
  const loadFolders = useCallback(async () => {
    if (!userRole || userUid <= 0) return;

    try {
      const { folders: folderList } = await getAccessibleFolders(
        userRole,
        userUid,
        "",
        currentFolderId,
      );
      setFolders(folderList);
    } catch (error) {
      console.error("Failed to load folders:", error);
    }
  }, [userRole, userUid, currentFolderId]);

  // 加载面包屑
  const loadBreadcrumb = useCallback(async () => {
    try {
      const items = await getFolderBreadcrumb(currentFolderId, "");
      setBreadcrumb(items);
    } catch (error) {
      console.error("Failed to load breadcrumb:", error);
    }
  }, [currentFolderId]);

  // 当切换到选择标签页时加载列表
  useEffect(() => {
    if (activeTab === "select" && dialogOpen) {
      setMediaList([]);
      setHasMore(true);
      pageRef.current = 1;
      hasMoreRef.current = true;

      // Initialize selected IDs from value directly
      const initialSelectedIds = new Set<string>();
      if (value) {
        const selectedUrls = Array.isArray(value) ? value : [value];
        selectedUrls.forEach((url) => {
          const match = String(url).match(/\/p\/([\w-]+)/);
          if (match && match[1]) {
            initialSelectedIds.add(match[1]);
          }
        });
      }
      setSelectedImageIds(initialSelectedIds);
      setSelectedFolderIds(new Set());

      loadMediaList(1, false);
      loadFolders();
      loadBreadcrumb();
    }
  }, [
    activeTab,
    dialogOpen,
    loadMediaList,
    loadFolders,
    loadBreadcrumb,
    value,
  ]);

  // 当文件夹或搜索变化时重新加载
  useEffect(() => {
    if (activeTab === "select" && dialogOpen) {
      setMediaList([]);
      setHasMore(true);
      pageRef.current = 1;
      hasMoreRef.current = true;
      loadMediaList(1, false);
      loadFolders();
      loadBreadcrumb();
    }
  }, [
    activeTab,
    dialogOpen,
    currentFolderId,
    debouncedSearch,
    loadMediaList,
    loadFolders,
    loadBreadcrumb,
  ]);

  // Intersection Observer 触发加载更多
  useEffect(() => {
    if (
      inView &&
      hasMoreRef.current &&
      !loadingRef.current &&
      activeTab === "select"
    ) {
      const timer = setTimeout(() => {
        if (hasMoreRef.current && !loadingRef.current) {
          const nextPage = pageRef.current + 1;
          loadMediaList(nextPage, true);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [inView, activeTab, loadMediaList]);

  // ========== 框选 Hook ==========
  const { isSelecting, selectionRect } = useMarqueeSelection({
    containerRef: gridContainerRef,
    enabled: activeTab === "select" && dialogOpen,
    onSelectionChange: (hits: MarqueeHit[]) => {
      const mediaIds = hits
        .filter((h) => h.type === "media")
        .map((h) => {
          // Find the item in mediaList to get its imageId
          const item = mediaList.find((m) => m.id === Number(h.id));
          return item ? item.imageId : null;
        })
        .filter((id): id is string => id !== null);

      const folderIds = hits
        .filter((h) => h.type === "folder")
        .map((h) => h.id);

      if (isShiftHeld) {
        // Shift 追加模式
        setSelectedImageIds((prev) => {
          const newSet = new Set(prev);
          mediaIds.forEach((id) => newSet.add(id));
          return newSet;
        });
        setSelectedFolderIds((prev) => {
          const newSet = new Set(prev);
          folderIds.forEach((id) => newSet.add(id));
          return newSet;
        });
      } else {
        setSelectedImageIds(new Set(mediaIds));
        setSelectedFolderIds(new Set(folderIds));
      }
    },
    isShiftHeld,
  });

  // ========== 事件处理 ==========

  // 选择图片
  const handleSelectImage = useCallback(
    (item: MediaListItem) => {
      if (multiple) {
        setSelectedImageIds((prev) => {
          const newSet = new Set(prev);
          if (newSet.has(item.imageId)) {
            newSet.delete(item.imageId);
          } else {
            if (maxCount && newSet.size >= maxCount) {
              toast.error(`最多只能选择 ${maxCount} 张图片`);
              return prev;
            }
            newSet.add(item.imageId);
          }
          return newSet;
        });
      } else {
        setSelectedImageIds(new Set([item.imageId]));
      }
    },
    [multiple, maxCount, toast],
  );

  // 单击进入文件夹（与 MediaGridView 一致）
  const handleFolderClick = useCallback((folder: FolderItem) => {
    setCurrentFolderId(folder.id);
    setSearchQuery("");
    setDebouncedSearch("");
  }, []);

  // 返回上级文件夹
  const handleGoBack = useCallback(() => {
    if (breadcrumb.length > 1) {
      const parentItem = breadcrumb[breadcrumb.length - 2];
      setCurrentFolderId(parentItem?.id ?? null);
    }
  }, [breadcrumb]);

  // 关闭对话框
  const closeDialog = useCallback(() => {
    if (uploading || importing) return;
    setDialogOpen(false);
    clearFiles();
    clearItems();
    setUrlInput("");
    setSelectedImageIds(new Set());
    setSelectedFolderIds(new Set());
    setUploadMode("lossy");
    setImportMode("record");
    setImportProcessMode("lossy");
    setSearchQuery("");
    setDebouncedSearch("");
  }, [
    uploading,
    importing,
    setDialogOpen,
    clearFiles,
    clearItems,
    setUrlInput,
  ]);

  // 确认选择
  const handleConfirmSelect = useCallback(() => {
    if (selectedImageIds.size > 0) {
      if (multiple) {
        const urls = Array.from(selectedImageIds).map((id) => `/p/${id}`);
        onChange(urls);
        toast.success(`已选择 ${urls.length} 张图片`);
      } else {
        const firstId = Array.from(selectedImageIds)[0];
        onChange(`/p/${firstId}`);
        toast.success("图片已选择");
      }
      closeDialog();
    }
  }, [selectedImageIds, onChange, toast, multiple, closeDialog]);

  // 打开对话框
  const openDialog = useCallback(() => {
    setDialogOpen(true);
    if (multiple || !value) {
      setActiveTab(defaultTab);
    } else if (typeof value === "string" && value.startsWith("/p/")) {
      setActiveTab("select");
    } else if (typeof value === "string") {
      setActiveTab("url");
      setUrlInput(value);
    } else {
      setActiveTab(defaultTab);
    }
  }, [value, defaultTab, setDialogOpen, multiple, setUrlInput]);

  // 清除图片
  const handleClear = useCallback(() => {
    onChange("");
    toast.success("图片已清除");
  }, [onChange, toast]);

  // ========== 上传处理 ==========
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileSelect(e.dataTransfer.files);
      }
    },
    [handleFileSelect],
  );

  const handleUploadAndSelect = useCallback(async () => {
    if (uploadFiles.length === 0) {
      toast.error("请先选择文件");
      return;
    }

    const { successCount, failCount, successfulResults } = await uploadAll();

    if (successCount > 0 && failCount === 0) {
      if (multiple) {
        const urls = successfulResults.map((r) => `/p/${r.imageId}`);
        onChange(urls);
      } else if (successfulResults[0]) {
        onChange(`/p/${successfulResults[0].imageId}`);
      }
      closeDialog();
      toast.success(`成功上传 ${successCount} 张图片`);
    } else if (successCount > 0 && failCount > 0) {
      if (multiple) {
        const urls = successfulResults.map((r) => `/p/${r.imageId}`);
        onChange(urls);
      } else if (successfulResults[0]) {
        onChange(`/p/${successfulResults[0].imageId}`);
      }
      closeDialog();
      toast.success(`成功 ${successCount} 张,失败 ${failCount} 张`);
    } else {
      toast.error("上传失败,所有文件都上传失败");
    }
  }, [uploadFiles, uploadAll, onChange, closeDialog, toast, multiple]);

  const handleRetryUpload = useCallback(
    async (id: string) => {
      const result = await retryFile(id);
      if (result.success && result.data) {
        if (!multiple) {
          onChange(`/p/${result.data.imageId}`);
          closeDialog();
        }
        toast.success("上传成功");
      } else {
        toast.error("上传失败，请检查错误信息后重试");
      }
    },
    [retryFile, onChange, closeDialog, toast, multiple],
  );

  // ========== 导入处理 ==========
  const handleImportAndSelect = useCallback(async () => {
    if (importItems.length === 0) {
      toast.error("请先添加要导入的图片 URL");
      return;
    }

    const pendingItems = importItems.filter(
      (item) => item.status === "pending",
    );
    if (pendingItems.length === 0) {
      toast.error("没有需要导入的项目");
      return;
    }

    const { successCount, failCount, successfulResults } = await importAll();

    if (successCount > 0 && failCount === 0) {
      if (multiple) {
        const urls = successfulResults.map((r) => `/p/${r.imageId}`);
        onChange(urls);
      } else if (successfulResults[0]) {
        onChange(`/p/${successfulResults[0].imageId}`);
      }
      closeDialog();
      toast.success(`成功导入 ${successCount} 张图片`);
    } else if (successCount > 0 && failCount > 0) {
      if (multiple) {
        const urls = successfulResults.map((r) => `/p/${r.imageId}`);
        onChange(urls);
      } else if (successfulResults[0]) {
        onChange(`/p/${successfulResults[0].imageId}`);
      }
      closeDialog();
      toast.success(`成功 ${successCount} 张,失败 ${failCount} 张`);
    } else {
      toast.error("导入失败,所有图片都导入失败");
    }
  }, [importItems, importAll, onChange, closeDialog, toast, multiple]);

  const handleRetryImport = useCallback(
    async (id: string) => {
      const result = await retryItem(id);
      if (result.success && result.data) {
        if (!multiple) {
          onChange(`/p/${result.data.imageId}`);
          closeDialog();
        }
        toast.success("导入成功");
      } else {
        toast.error("导入失败，请检查错误信息后重试");
      }
    },
    [retryItem, onChange, closeDialog, toast, multiple],
  );

  // ========== 渲染 ==========
  return (
    <div className={hideTrigger ? "" : "space-y-2"}>
      {!hideTrigger && label && (
        <label className="block text-sm font-medium text-foreground">
          {label}
        </label>
      )}

      {/* 图片预览或添加按钮 - 仅在非隐藏模式下显示 */}
      {!hideTrigger && (
        <div className="relative">
          {(multiple ? Array.isArray(value) && value.length > 0 : value) ? (
            <div className="relative group">
              <div className="aspect-video w-full bg-muted overflow-hidden max-h-[20em] rounded-md relative">
                {multiple && Array.isArray(value) ? (
                  <>
                    {value.map((url, index) => (
                      <div
                        key={url}
                        className={`absolute inset-0 transition-opacity duration-500 ${
                          index === previewActiveIndex
                            ? "opacity-100"
                            : "opacity-0"
                        }`}
                      >
                        <CMSImage
                          src={url}
                          alt={`${label} ${index + 1}`}
                          fill
                          className="object-cover rounded-md"
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <CMSImage
                    src={String(value || "")}
                    alt={label}
                    fill
                    className="object-cover rounded-md"
                  />
                )}
              </div>
              {multiple && Array.isArray(value) && value.length > 1 && (
                <div className="absolute top-2 left-2 bg-background/80 backdrop-blur-sm px-2 py-1 text-xs font-medium rounded-sm">
                  {previewActiveIndex + 1} / {value.length}
                </div>
              )}
              <div className="absolute inset-0 bg-background/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Tooltip content="编辑">
                  <Clickable onClick={openDialog} hoverScale={1.1}>
                    <div className="p-3 bg-foreground/10 hover:bg-foreground/50 rounded-lg text-foreground hover:text-background transition-all">
                      <RiEditLine size="1.5em" />
                    </div>
                  </Clickable>
                </Tooltip>
                <Tooltip content="清除">
                  <Clickable onClick={handleClear} hoverScale={1.1}>
                    <div className="p-3 bg-error/40 hover:bg-error/80 rounded-lg text-foreground hover:text-background transition-all">
                      <RiCloseLine size="1.5em" />
                    </div>
                  </Clickable>
                </Tooltip>
              </div>
            </div>
          ) : (
            <button
              onClick={openDialog}
              className="max-h-[20em] aspect-video w-full bg-muted/30 rounded-lg flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-all cursor-pointer border-2 border-dashed border-border hover:border-muted-foreground"
              type="button"
            >
              <RiAddLine size="1.5em" />
              <span className="text-sm">
                {multiple ? "选择图片（可多选）" : "选择图片"}
              </span>
            </button>
          )}
        </div>
      )}

      {!hideTrigger && helperText && (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      )}

      {/* 选择对话框 */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title="选择图片"
        size="lg"
      >
        <div className="px-6 py-6 space-y-6">
          {/* 标签页切换 */}
          <SegmentedControl
            value={activeTab}
            onChange={setActiveTab}
            options={[
              {
                value: "select",
                label: "选择",
                description: "从已有图片中选择",
              },
              {
                value: "upload",
                label: "上传",
                description: "上传新图片",
              },
              {
                value: "url",
                label: "URL",
                description: "手动输入图片链接",
              },
            ]}
            columns={3}
          />

          <AutoResizer duration={0.3}>
            <AutoTransition type="fade" duration={0.3}>
              {/* 选择标签页 */}
              {activeTab === "select" && (
                <div className="space-y-4" key="select-tab">
                  {/* 面包屑导航和搜索 */}
                  <div className="flex items-center gap-4">
                    {/* 返回按钮 */}
                    {breadcrumb.length > 1 && (
                      <button
                        type="button"
                        onClick={handleGoBack}
                        className="p-2 hover:bg-muted rounded-md transition-colors"
                        title="返回上级"
                      >
                        <RiArrowLeftLine size="1.25em" />
                      </button>
                    )}

                    {/* 面包屑 */}
                    <div className="flex-1 flex items-center gap-1 text-sm text-muted-foreground overflow-x-auto">
                      {breadcrumb.map((item, index) => (
                        <span
                          key={item.id ?? "root"}
                          className="flex items-center"
                        >
                          {index > 0 && <span className="mx-1">/</span>}
                          <button
                            type="button"
                            onClick={() => setCurrentFolderId(item.id)}
                            className={`hover:text-foreground transition-colors whitespace-nowrap ${
                              index === breadcrumb.length - 1
                                ? "text-foreground font-medium"
                                : ""
                            }`}
                          >
                            {item.name}
                          </button>
                        </span>
                      ))}
                    </div>

                    {/* 搜索框 - 与 MediaGridView 完全一致的样式 */}
                    <div className="relative w-[12em]">
                      <input
                        title="search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="relative w-full bg-transparent border-0 px-0 py-2 text-sm text-foreground focus:outline-none"
                      />
                      {/* 动画下划线 */}
                      <motion.div
                        className="absolute bottom-0 left-0 h-0.5 w-full"
                        initial={{ backgroundColor: "var(--color-foreground)" }}
                        animate={{
                          backgroundColor:
                            searchQuery.length > 0
                              ? "var(--color-primary)"
                              : "var(--color-foreground)",
                        }}
                        transition={{ duration: 0.3 }}
                      />
                      {/* 占位标签 */}
                      <motion.label
                        className="absolute top-2 left-0 pointer-events-none whitespace-nowrap flex items-center text-sm text-foreground"
                        animate={{
                          opacity: searchQuery.length > 0 ? 0 : 1,
                        }}
                        transition={{ duration: 0.2 }}
                      >
                        <RiSearchLine size="1em" className="inline mr-1" />
                        搜索图片...
                      </motion.label>
                      {/* 清空按钮 */}
                      <AnimatePresence>
                        {searchQuery.length > 0 && (
                          <motion.button
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            transition={{
                              duration: 0.3,
                              ease: [0.68, -0.55, 0.265, 1.55],
                            }}
                            onClick={() => setSearchQuery("")}
                            className="absolute right-0 top-2 text-primary hover:text-foreground transition-colors cursor-pointer flex items-center"
                            type="button"
                          >
                            <RiCloseLine size="1em" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* 网格内容 - 使用 AutoTransition 实现切换动画 */}
                  <AutoTransition type="slideUp" duration={0.2}>
                    {loading &&
                    mediaList.length === 0 &&
                    folders.length === 0 ? (
                      <div
                        className="h-64 flex items-center justify-center"
                        key="loading"
                      >
                        <LoadingIndicator />
                      </div>
                    ) : folders.length === 0 && mediaList.length === 0 ? (
                      <div
                        className="h-64 flex items-center justify-center text-muted-foreground"
                        key="empty"
                      >
                        {debouncedSearch ? "没有找到匹配的图片" : "暂无图片"}
                      </div>
                    ) : (
                      <div
                        key={
                          debouncedSearch
                            ? `search-${debouncedSearch}`
                            : `folder-${currentFolderId || "root"}`
                        }
                        ref={gridContainerRef}
                        className="max-h-96 overflow-y-auto scroll-smooth relative"
                      >
                        {/* 框选矩形 */}
                        {isSelecting && selectionRect && (
                          <div
                            className="absolute border-2 border-primary bg-primary/10 pointer-events-none z-50"
                            style={{
                              left: selectionRect.x,
                              top: selectionRect.y,
                              width: selectionRect.width,
                              height: selectionRect.height,
                            }}
                          />
                        )}

                        <div
                          className="grid gap-3"
                          style={{
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(7rem, 1fr))",
                            contentVisibility: "auto",
                          }}
                        >
                          {/* 文件夹 - 单击进入（与 MediaGridView 一致） */}
                          {!debouncedSearch &&
                            folders
                              .filter((folder) => {
                                // 在根目录下，不显示公共空间文件夹（因为其内容已在根目录中展示）
                                if (
                                  currentFolderId === null &&
                                  folder.systemType === "ROOT_PUBLIC"
                                ) {
                                  return false;
                                }
                                return true;
                              })
                              .map((folder) => (
                                <div
                                  key={`folder-${folder.id}`}
                                  data-grid-item="true"
                                  data-item-type="folder"
                                  data-item-id={folder.id}
                                  onClick={() => handleFolderClick(folder)}
                                  className={`
                                relative aspect-square cursor-pointer overflow-hidden bg-muted/30
                                group transition-all duration-150 flex flex-col items-center justify-center gap-2
                                ${
                                  selectedFolderIds.has(folder.id)
                                    ? "border-2 border-primary"
                                    : "border-2 border-transparent hover:border-foreground/30"
                                }
                              `}
                                >
                                  {selectedFolderIds.has(folder.id) ? (
                                    <RiFolderOpenLine
                                      className="text-primary"
                                      size="2.5em"
                                    />
                                  ) : (
                                    <RiFolderLine
                                      className="text-muted-foreground group-hover:text-foreground transition-colors"
                                      size="2.5em"
                                    />
                                  )}
                                  <span className="text-xs text-center px-2 truncate w-full">
                                    {formatFolderName(
                                      folder,
                                      userRole,
                                      userUid,
                                    )}
                                  </span>
                                  {folder.fileCount !== undefined &&
                                    folder.fileCount > 0 && (
                                      <span className="text-xs text-muted-foreground">
                                        {folder.fileCount} 个文件
                                      </span>
                                    )}
                                </div>
                              ))}

                          {/* 图片 */}
                          {mediaList.map((item, index) => {
                            const isSelected = selectedImageIds.has(
                              item.imageId,
                            );
                            const loadingStrategy =
                              index < 12 ? "eager" : "lazy";

                            const renderTooltipContent = () => (
                              <div className="space-y-1 min-w-[200px]">
                                <div className="font-medium truncate">
                                  {item.originalName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {item.width && item.height && (
                                    <div>
                                      尺寸: {item.width} × {item.height}
                                    </div>
                                  )}
                                  <div>大小: {formatBytes(item.size)}</div>
                                  <div>
                                    上传:{" "}
                                    {new Date(item.createdAt).toLocaleString(
                                      "zh-CN",
                                      {
                                        year: "numeric",
                                        month: "2-digit",
                                        day: "2-digit",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      },
                                    )}
                                  </div>
                                </div>
                              </div>
                            );

                            return (
                              <Tooltip
                                key={item.id}
                                content={renderTooltipContent()}
                                placement="top"
                                delay={300}
                                className="block"
                              >
                                <div
                                  data-grid-item="true"
                                  data-item-type="media"
                                  data-item-id={item.id}
                                  onClick={(e) => {
                                    const target = e.target as HTMLElement;
                                    const isCheckboxClick = target.closest(
                                      '[data-checkbox="true"]',
                                    );
                                    if (!isCheckboxClick) {
                                      handleSelectImage(item);
                                    }
                                  }}
                                  className={`
                                  relative aspect-square cursor-pointer overflow-hidden bg-muted/30
                                  group transition-all duration-150
                                  ${
                                    isSelected
                                      ? "border-2 border-primary"
                                      : "border-2 border-transparent hover:border-foreground/30"
                                  }
                                `}
                                  style={{ transform: "translateZ(0)" }}
                                >
                                  {item.width && item.height ? (
                                    <CMSImage
                                      src={`/p/${item.imageId}`}
                                      alt={item.altText || item.originalName}
                                      fill
                                      blur={item.blur}
                                      className="object-cover"
                                      loading={loadingStrategy}
                                      sizes="8em"
                                      priority={index < 6}
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                      <RiImageLine size="2em" />
                                    </div>
                                  )}
                                  {/* 复选框 */}
                                  <div
                                    className={`
                                    absolute top-2 right-2 z-10
                                    transition-opacity duration-150
                                    ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
                                  `}
                                    data-checkbox="true"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="rounded p-1">
                                      <Checkbox
                                        checked={isSelected}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          handleSelectImage(item);
                                        }}
                                        size="lg"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </Tooltip>
                            );
                          })}
                        </div>

                        {/* 底部状态 */}
                        {hasMore ? (
                          <div
                            ref={loadMoreRef}
                            className="flex justify-center py-4 my-4"
                          >
                            <LoadingIndicator />
                          </div>
                        ) : (
                          mediaList.length > 0 && (
                            <div className="text-center text-sm text-muted-foreground py-4">
                              没有更多图片了
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </AutoTransition>

                  {/* 操作按钮 */}
                  <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
                    <Button
                      label="取消"
                      variant="ghost"
                      onClick={closeDialog}
                      size="sm"
                    />
                    <Button
                      label="确认选择"
                      variant="primary"
                      onClick={handleConfirmSelect}
                      size="sm"
                      disabled={selectedImageIds.size === 0}
                    />
                  </div>
                </div>
              )}

              {/* 上传标签页 */}
              {activeTab === "upload" && (
                <div className="space-y-4" key="upload-tab">
                  {/* 处理模式选择 */}
                  <SegmentedControl
                    value={uploadMode}
                    onChange={setUploadMode}
                    disabled={uploading}
                    options={[
                      {
                        value: "lossy",
                        label: "有损优化",
                        description: "压缩为 AVIF 格式，节省占用",
                      },
                      {
                        value: "lossless",
                        label: "无损转换",
                        description: "无损转换为 WebP ",
                      },
                      {
                        value: "original",
                        label: "保留原片",
                        description: "以原始格式上传，不做处理",
                      },
                    ]}
                    columns={3}
                  />

                  {/* 存储提供商选择 */}
                  {userRole && userRole !== "AUTHOR" && (
                    <div className="space-y-2 flex flex-col gap-y-2">
                      <label className="text-sm font-medium text-muted-foreground">
                        上传位置
                      </label>
                      {loadingProviders ? (
                        <div className="text-sm text-muted-foreground">
                          加载中...
                        </div>
                      ) : (
                        <Select
                          value={selectedStorageId}
                          onChange={(value) =>
                            setSelectedStorageId(String(value))
                          }
                          options={storageProviders.map((provider) => ({
                            value: provider.id,
                            label: `${provider.displayName}${provider.isDefault ? " (默认)" : ""}`,
                          }))}
                          size="sm"
                          disabled={uploading}
                          placeholder="选择存储提供商"
                        />
                      )}
                    </div>
                  )}

                  {/* 文件夹选择 */}
                  <div className="space-y-2 flex flex-col gap-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      目标文件夹
                    </label>
                    <Clickable
                      onClick={() =>
                        !uploading && setUploadFolderPickerOpen(true)
                      }
                      hoverScale={1}
                      className={`flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm transition-colors ${
                        uploading
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <RiFolderLine className="text-muted-foreground" />
                      <span className="flex-1 text-left">
                        {uploadFolderName}
                      </span>
                    </Clickable>
                  </div>

                  {/* 文件选择区域 */}
                  <div
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                      dragActive
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <RiUploadLine
                      className="mx-auto mb-4 text-muted-foreground"
                      size="3em"
                    />
                    <div className="text-base font-medium mb-2">
                      {multiple
                        ? "拖拽、粘贴文件到此处，或点击选择"
                        : "拖拽、粘贴文件到此处，或点击选择（仅限单张）"}
                    </div>
                    <div className="text-sm text-muted-foreground mb-4">
                      <AutoTransition>
                        {uploadMode === "original"
                          ? "支持所有图片格式（原样上传）"
                          : "支持 JPG、PNG、GIF、WebP、AVIF、TIFF 格式"}
                      </AutoTransition>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      multiple={multiple}
                      onChange={(e) => handleFileSelect(e.target.files)}
                      className="hidden"
                      id="media-selector-file-input"
                      aria-label="选择图片文件"
                    />
                    <Button
                      label="选择文件"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        document
                          .getElementById("media-selector-file-input")
                          ?.click()
                      }
                      disabled={uploading}
                    />
                  </div>

                  {/* 文件列表 */}
                  <AutoResizer>
                    {uploadFiles.length > 0 && (
                      <div className="space-y-0">
                        <div className="text-sm font-medium text-muted-foreground pb-3 border-b border-border">
                          文件列表 ({uploadFiles.length})
                        </div>
                        <div className="divide-y divide-border">
                          {uploadFiles.map((uploadFile) => (
                            <FileListItem
                              key={uploadFile.id}
                              id={uploadFile.id}
                              displayName={getDisplayFileName(uploadFile)}
                              status={uploadFile.status}
                              error={uploadFile.error}
                              previewSrc={uploadFile.previewUrl}
                              imageLoadError={uploadFile.imageLoadError}
                              onImageError={() =>
                                handleUploadImageError(uploadFile.id)
                              }
                              originalSize={uploadFile.originalSize}
                              processedSize={uploadFile.processedSize}
                              isDuplicate={uploadFile.result?.isDuplicate}
                              uploadProgress={uploadFile.uploadProgress}
                              editable={uploadFile.status === "pending"}
                              onNameChange={(newName) =>
                                updateFileName(uploadFile.id, newName)
                              }
                              originalName={uploadFile.file.name}
                              onRemove={() => removeFile(uploadFile.id)}
                              onRetry={() => handleRetryUpload(uploadFile.id)}
                              operationDisabled={uploading}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </AutoResizer>

                  {/* 操作按钮 */}
                  <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
                    <Button
                      label="取消"
                      variant="ghost"
                      onClick={closeDialog}
                      size="sm"
                      disabled={uploading}
                    />
                    <Button
                      label="上传并选择"
                      variant="primary"
                      onClick={handleUploadAndSelect}
                      size="sm"
                      loading={uploading}
                      disabled={uploadFiles.length === 0}
                    />
                  </div>
                </div>
              )}

              {/* URL 标签页 */}
              {activeTab === "url" && (
                <div className="space-y-4" key="url-tab">
                  {/* 导入模式选择 */}
                  <SegmentedControl
                    value={importMode}
                    onChange={setImportMode}
                    disabled={importing}
                    options={[
                      {
                        value: "record",
                        label: "外链优化",
                        description: "仅优化图片，不上传到存储",
                      },
                      {
                        value: "transfer",
                        label: "转存托管",
                        description: "下载并上传到存储，可选择压缩",
                      },
                    ]}
                    columns={2}
                  />

                  <AutoResizer>
                    <AutoTransition>
                      {importMode === "transfer" ? (
                        <div key="transfer-options">
                          <p className="text-sm text-muted-foreground">
                            将图片直接下载并上传到存储服务，完全由站点托管。
                          </p>
                          <div className="space-y-4 mt-4">
                            <SegmentedControl
                              value={importProcessMode}
                              onChange={setImportProcessMode}
                              disabled={importing}
                              options={[
                                {
                                  value: "lossy",
                                  label: "有损优化",
                                  description: "压缩为 AVIF 格式，节省占用",
                                },
                                {
                                  value: "lossless",
                                  label: "无损转换",
                                  description: "无损转换为 WebP ",
                                },
                                {
                                  value: "original",
                                  label: "保留原片",
                                  description: "以原始格式上传，不做处理",
                                },
                              ]}
                              columns={3}
                            />
                          </div>
                          {userRole && userRole !== "AUTHOR" && (
                            <div className="space-y-2 flex flex-col gap-y-2 pt-4 pb-8">
                              <label className="text-sm font-medium text-muted-foreground">
                                上传位置
                              </label>
                              {loadingProviders ? (
                                <div className="text-sm text-muted-foreground">
                                  加载中...
                                </div>
                              ) : (
                                <Select
                                  value={selectedStorageId}
                                  onChange={(value) =>
                                    setSelectedStorageId(String(value))
                                  }
                                  options={storageProviders.map((provider) => ({
                                    value: provider.id,
                                    label: `${provider.displayName}${provider.isDefault ? " (默认)" : ""}`,
                                  }))}
                                  size="sm"
                                  disabled={importing}
                                  placeholder="选择存储提供商"
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p
                          className="text-sm text-muted-foreground"
                          key="record-mode-info"
                        >
                          将图片的元信息保存到数据库，并为其启用站点的图片优化。图片仍托管在原始的外部
                          URL 上。
                        </p>
                      )}
                    </AutoTransition>
                  </AutoResizer>

                  {/* 文件夹选择 */}
                  <div className="space-y-2 flex flex-col gap-y-2">
                    <label className="text-sm font-medium text-muted-foreground">
                      目标文件夹
                    </label>
                    <Clickable
                      onClick={() =>
                        !importing && setImportFolderPickerOpen(true)
                      }
                      hoverScale={1}
                      className={`flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm transition-colors ${
                        importing
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-muted/50"
                      }`}
                    >
                      <RiFolderLine className="text-muted-foreground" />
                      <span className="flex-1 text-left">
                        {importFolderName}
                      </span>
                    </Clickable>
                  </div>

                  {/* URL 输入区域 */}
                  <Input
                    label="图片 URL"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onPaste={handleInputPaste}
                    helperText="粘贴图片 URL，每行一个。Enter 或粘贴后自动添加"
                    rows={2}
                    size="sm"
                    disabled={importing}
                  />

                  {/* 导入列表 */}
                  <AutoResizer>
                    {importItems.length > 0 && (
                      <div className="space-y-0">
                        <div className="text-sm font-medium text-muted-foreground pb-3 border-b border-border">
                          导入列表 ({importItems.length})
                        </div>
                        <div className="divide-y divide-border">
                          {importItems.map((item) => (
                            <FileListItem
                              key={item.id}
                              id={item.id}
                              displayName={getImportDisplayFileName(item)}
                              status={item.status}
                              error={item.error}
                              previewSrc={item.url}
                              imageLoadError={item.imageLoadError}
                              onImageError={() =>
                                handleImportImageError(item.id)
                              }
                              editable={item.status === "pending"}
                              onNameChange={(newName) =>
                                updateItemFileName(item.id, newName)
                              }
                              originalName={item.fileName}
                              onRemove={() => removeItem(item.id)}
                              onRetry={() => handleRetryImport(item.id)}
                              operationDisabled={importing}
                              subtitle={
                                !item.error && !item.result
                                  ? `${item.url}${item.fileSize ? ` · ${formatBytes(item.fileSize)}` : ""}`
                                  : undefined
                              }
                              resultInfo={
                                item.result ? (
                                  <div className="text-xs text-muted-foreground">
                                    {formatBytes(item.result.originalSize)}
                                    {item.result.width &&
                                      item.result.height && (
                                        <span className="ml-2">
                                          · {item.result.width} ×{" "}
                                          {item.result.height}
                                        </span>
                                      )}
                                    {item.result.isDuplicate && (
                                      <span className="text-orange-500 ml-2">
                                        · 重复项目
                                      </span>
                                    )}
                                  </div>
                                ) : undefined
                              }
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </AutoResizer>

                  {/* 操作按钮 */}
                  <div className="flex justify-end gap-4 pt-4 border-t border-foreground/10">
                    <Button
                      label="取消"
                      variant="ghost"
                      onClick={closeDialog}
                      size="sm"
                      disabled={importing}
                    />
                    <Button
                      label="导入并选择"
                      variant="primary"
                      onClick={handleImportAndSelect}
                      size="sm"
                      loading={importing}
                      disabled={importItems.length === 0}
                    />
                  </div>
                </div>
              )}
            </AutoTransition>
          </AutoResizer>
        </div>
      </Dialog>

      {/* 文件夹选择对话框 - 上传 */}
      <FolderPickerDialog
        open={uploadFolderPickerOpen}
        onClose={() => setUploadFolderPickerOpen(false)}
        onSelect={(folderId, folderName) => {
          setUploadFolderId(folderId);
          setUploadFolderName(folderName);
        }}
        userRole={userRole}
        userUid={userUid}
        title="选择目标文件夹"
      />

      {/* 文件夹选择对话框 - 导入 */}
      <FolderPickerDialog
        open={importFolderPickerOpen}
        onClose={() => setImportFolderPickerOpen(false)}
        onSelect={(folderId, folderName) => {
          setImportFolderId(folderId);
          setImportFolderName(folderName);
        }}
        userRole={userRole}
        userUid={userUid}
        title="选择目标文件夹"
      />
    </div>
  );
}
