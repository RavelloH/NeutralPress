"use client";

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiFileLine,
  RiFilter3Line,
  RiFolderAddLine,
  RiFolderLine,
  RiSearchLine,
} from "@remixicon/react";
import type { MediaListItem } from "@repo/shared-types/api/media";
import { AnimatePresence, motion } from "framer-motion";

import type { FolderItem } from "@/actions/media";
import { GridItem } from "@/components/client/layout/RowGrid";
import CMSImage from "@/components/ui/CMSImage";
import {
  type MarqueeHit,
  useMarqueeSelection,
} from "@/hooks/use-marquee-selection";
import { createArray } from "@/lib/client/create-array";
import type { MediaGridViewProps, RowAction } from "@/types/media-table";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

// MediaGridItem 的 Props 类型
interface MediaGridItemProps {
  item: MediaListItem;
  isSelected: boolean;
  onSelect: (id: string | number, checked: boolean) => void;
  onPreview: (item: MediaListItem) => void;
  formatFileSize: (bytes: number) => string;
  getFileTypeIcon: (type: string) => React.ReactNode;
  actions: RowAction[];
  index: number;
  isDragDisabled?: boolean;
  isDragging?: boolean;
  isShiftHeld?: boolean;
}

// 提取图片卡片为独立组件并使用 memo
const MediaGridItem = memo<MediaGridItemProps>(
  ({
    item,
    isSelected,
    onSelect,
    onPreview,
    formatFileSize,
    getFileTypeIcon,
    actions,
    index,
    isDragDisabled,
    isDragging: isDraggingProp,
    isShiftHeld,
  }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      isDragging: isDraggingLocal,
    } = useDraggable({
      id: `media-${item.id}`,
      disabled: isDragDisabled,
    });

    const isDragging = isDraggingProp || isDraggingLocal;

    // 前 24 张图片使用 eager 加载，其余懒加载
    const loadingStrategy = index < 24 ? "eager" : "lazy";

    const renderTooltipContent = () => {
      return (
        <div className="space-y-1 min-w-[200px]">
          <div className="font-medium truncate">{item.originalName}</div>
          <div className="text-xs text-muted-foreground">
            {item.width && item.height && (
              <div>
                尺寸: {item.width} × {item.height}
              </div>
            )}
            <div>大小: {formatFileSize(item.size)}</div>
            <div>
              上传:{" "}
              {new Date(item.createdAt).toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
      );
    };

    return (
      <Tooltip content={renderTooltipContent()} placement="top" delay={300}>
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          data-grid-item
          data-item-type="media"
          data-item-id={item.id}
          className={`
            relative aspect-square cursor-pointer overflow-hidden bg-muted/30
            group transition-all duration-150
            ${
              isSelected
                ? "border-2 border-primary"
                : "border-2 border-transparent hover:border-foreground/30"
            }
          `}
          style={{
            transform: "translateZ(0)",
            opacity: isDragging ? 0.5 : 1,
          }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            const isCheckboxClick = target.closest('[data-checkbox="true"]');
            const isActionClick = target.closest('[data-action="true"]');

            // 按住 Shift 时，点击任何位置（除了操作按钮）都切换选中状态
            if (isShiftHeld && !isActionClick) {
              onSelect(item.id, !isSelected);
              return;
            }

            if (!isCheckboxClick && !isActionClick) {
              onPreview(item);
            }
          }}
        >
          {/* 图片 */}
          {item.mediaType === "IMAGE" && item.width && item.height ? (
            <CMSImage
              src={`/p/${item.imageId}`}
              alt={item.altText || item.originalName}
              fill
              blur={item.blur}
              className="object-cover"
              sizes="(max-width: 768px) 8rem, 10rem"
              loading={loadingStrategy}
              priority={index < 12}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              {getFileTypeIcon(item.mediaType)}
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
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="rounded p-1">
              <Checkbox
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onSelect(item.id, e.target.checked);
                }}
                size="lg"
              />
            </div>
          </div>

          {/* 底部操作栏 */}
          <div
            className={`
              absolute bottom-0 left-0 right-0 z-10
              bg-background/80 backdrop-blur-sm
              transform transition-transform duration-200 ease-out
              ${isSelected ? "translate-y-0" : "translate-y-full group-hover:translate-y-0"}
            `}
            data-action="true"
          >
            <div className="flex items-center justify-center gap-2 px-2 py-2">
              {actions.map((action) => (
                <Tooltip
                  key={action.label}
                  content={action.label}
                  placement="top"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      action.onClick();
                    }}
                    className={`
                      p-2 rounded transition-colors
                      ${
                        action.variant === "danger"
                          ? "hover:bg-error/20 hover:text-error"
                          : "hover:bg-muted"
                      }
                    `}
                    aria-label={action.label}
                  >
                    {action.icon}
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      </Tooltip>
    );
  },
  (prevProps, nextProps) => {
    // 自定义比较函数：返回 true 表示 props 相等（不重新渲染）
    // 只比较数据相关的 props，不比较函数 props（函数引用可能变化但功能相同）
    return (
      prevProps.item.id === nextProps.item.id &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.item.imageId === nextProps.item.imageId &&
      (prevProps.isDragDisabled ?? false) ===
        (nextProps.isDragDisabled ?? false) &&
      (prevProps.isDragging ?? false) === (nextProps.isDragging ?? false) &&
      (prevProps.isShiftHeld ?? false) === (nextProps.isShiftHeld ?? false)
    );
  },
);

MediaGridItem.displayName = "MediaGridItem";

// FolderGridItem 的 Props 类型
interface FolderGridItemProps {
  folder: FolderItem;
  isSelected: boolean;
  isSelectable: boolean;
  onSelect: (id: number, checked: boolean) => void;
  onEnter: (folderId: number) => void;
  currentUserId: number;
  isDragDisabled?: boolean;
  isDropTarget?: boolean;
}

// 文件夹卡片组件（同时可拖拽和可放置）
const FolderGridItem = memo<FolderGridItemProps>(
  ({
    folder,
    isSelected,
    isSelectable,
    onSelect,
    onEnter,
    currentUserId,
    isDragDisabled,
    isDropTarget,
  }) => {
    // 可拖拽
    const {
      attributes,
      listeners,
      setNodeRef: setDragRef,
      isDragging,
    } = useDraggable({
      id: `folder-${folder.id}`,
      disabled: isDragDisabled || folder.systemType !== "NORMAL",
    });

    // 可放置
    const { setNodeRef: setDropRef, isOver } = useDroppable({
      id: `drop-folder-${folder.id}`,
      disabled: folder.systemType === "ROOT_USERS", // 用户目录不可作为放置目标
    });

    const formatFolderName = useCallback(() => {
      switch (folder.systemType) {
        case "ROOT_PUBLIC":
          return "公共空间";
        case "ROOT_USERS":
          return "用户目录";
        case "USER_HOME":
          return folder.userUid === currentUserId ? "我的文件夹" : folder.name;
        default:
          return folder.name;
      }
    }, [folder, currentUserId]);

    // 合并两个 ref
    const setRef = useCallback(
      (node: HTMLDivElement | null) => {
        setDragRef(node);
        setDropRef(node);
      },
      [setDragRef, setDropRef],
    );

    return (
      <div
        ref={setRef}
        {...attributes}
        {...listeners}
        data-grid-item
        data-item-type="folder"
        data-item-id={folder.id}
        className={`
          relative aspect-square cursor-pointer overflow-hidden
          bg-muted/30 group transition-all duration-150
          ${
            isSelected
              ? "border-2 border-primary"
              : isOver || isDropTarget
                ? "border-2 border-primary ring-2 ring-primary/30"
                : "border-2 border-transparent hover:border-foreground/30"
          }
        `}
        style={{
          transform: "translateZ(0)",
          opacity: isDragging ? 0.5 : 1,
        }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const isCheckboxClick = target.closest('[data-checkbox="true"]');
          if (!isCheckboxClick) {
            onEnter(folder.id);
          }
        }}
      >
        {/* 文件夹图标 */}
        <div className="w-full h-full flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground group-hover:text-foreground transition-colors">
            <RiFolderLine size="3em" />
            <div className="text-sm text-center px-2 line-clamp-2">
              {formatFolderName()}
            </div>
          </div>
        </div>

        {/* 复选框 - 仅对可选择的文件夹显示 */}
        {isSelectable && (
          <div
            className={`
              absolute top-2 right-2 z-10
              transition-opacity duration-150
              ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}
            `}
            data-checkbox="true"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="rounded p-1">
              <Checkbox
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  onSelect(folder.id, e.target.checked);
                }}
                size="lg"
              />
            </div>
          </div>
        )}

        {/* 文件计数徽章 */}
        {folder.fileCount !== undefined && folder.fileCount > 0 && (
          <div className="absolute bottom-2 right-2 z-10 px-2 py-0.5 text-xs text-muted-foreground">
            {folder.fileCount}
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.folder.id === nextProps.folder.id &&
      prevProps.folder.fileCount === nextProps.folder.fileCount &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isSelectable === nextProps.isSelectable &&
      (prevProps.isDragDisabled ?? false) ===
        (nextProps.isDragDisabled ?? false) &&
      (prevProps.isDropTarget ?? false) === (nextProps.isDropTarget ?? false)
    );
  },
);

FolderGridItem.displayName = "FolderGridItem";

/**
 * 媒体网格视图组件
 * 负责渲染网格布局的媒体列表，支持无限滚动加载、框选和拖拽移动
 */
export default function MediaGridView({
  // 数据
  data,
  folders,
  loading,
  hasMore,

  // 选中状态
  selectedItems,
  onSelectMedia,
  onSelectFolder,

  // 操作回调
  onPreview,
  onEdit,
  onDelete,
  onEnterFolder,
  onLoadMore,

  // 工具函数
  formatFileSize,
  getFileTypeIcon,

  // 用户信息
  currentUserId,
  isMobile,

  // 视图切换
  viewModeToggle,

  // 搜索
  searchValue,
  onSearchValueChange,
  onOpenSearchDialog,

  // 筛选
  hasActiveFilters,
  onOpenFilterDialog,

  // 批量操作
  batchActions,

  // 面包屑导航
  currentFolderId,
  breadcrumbItems,
  onNavigateToBreadcrumb,
  onGoBack,

  // 新建文件夹
  onCreateFolder,
  createFolderLoading,

  // 拖拽移动
  onMoveItems,
  onBatchSelect,

  onClearSelection: _onClearSelection,
}: MediaGridViewProps) {
  const toast = useToast();

  // 新建文件夹对话框状态
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [activeDragData, setActiveDragData] = useState<{
    type: "media" | "folder";
    id: number;
    count: number;
    // 预览图信息（最多4张）
    previewItems: Array<{
      type: "media" | "folder";
      imageId?: string;
      rotation: number;
    }>;
  } | null>(null);
  const [overFolderId, setOverFolderId] = useState<number | null>(null);

  // Shift 键状态
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // 无限滚动：监听容器
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreRef = useRef(false);

  // DnD 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }, // 区分点击和拖拽
    }),
  );

  // 监听 Shift 键和 Ctrl+A 全选
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setIsShiftHeld(true);

      // Ctrl+A 全选
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        // 检查焦点是否在输入框内
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.getAttribute("contenteditable") === "true"
        ) {
          return; // 不阻止输入框内的全选
        }

        e.preventDefault();

        // 全选当前视图中的所有媒体文件和可选择的文件夹
        const allMediaIds = data.map((item) => item.id);
        const selectableFolderIds = folders
          .filter((f) => f.systemType === "NORMAL")
          .map((f) => f.id);

        onBatchSelect(allMediaIds, selectableFolderIds, false);
      }
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
  }, [data, folders, onBatchSelect]);

  // 框选功能
  const handleMarqueeSelectionChange = useCallback(
    (hits: MarqueeHit[]) => {
      const mediaIds = hits.filter((h) => h.type === "media").map((h) => h.id);
      const folderIds = hits
        .filter((h) => h.type === "folder")
        .map((h) => h.id)
        .filter((id) => {
          const folder = folders.find((f) => f.id === id);
          return folder?.systemType === "NORMAL";
        });
      onBatchSelect(mediaIds, folderIds, isShiftHeld);
    },
    [folders, onBatchSelect, isShiftHeld],
  );

  const { isSelecting, selectionRect } = useMarqueeSelection({
    containerRef: scrollContainerRef,
    enabled: !isMobile && !isDragging,
    onSelectionChange: handleMarqueeSelectionChange,
    isShiftHeld,
  });

  // 拖拽开始
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const idStr = String(active.id);
      const [type, idPart] = idStr.split("-");
      const id = Number(idPart);

      setIsDragging(true);

      // 如果拖拽的项目已选中，拖拽所有选中项
      // 如果未选中，只拖拽当前项
      const isSelected =
        type === "media"
          ? selectedItems.mediaIds.has(id)
          : selectedItems.folderIds.has(id);

      const count = isSelected
        ? selectedItems.mediaIds.size + selectedItems.folderIds.size
        : 1;

      // 收集预览图信息（最多4张）
      const previewItems: Array<{
        type: "media" | "folder";
        imageId?: string;
        rotation: number;
      }> = [];

      if (isSelected) {
        // 先添加媒体文件
        const selectedMediaItems = data.filter((item) =>
          selectedItems.mediaIds.has(item.id),
        );
        for (const item of selectedMediaItems.slice(0, 4)) {
          previewItems.push({
            type: "media",
            imageId: item.mediaType === "IMAGE" ? item.imageId : undefined,
            rotation: Math.random() * 48 - 24, // -6 到 6 度随机旋转
          });
        }
        // 如果媒体文件不足4张，添加文件夹
        if (previewItems.length < 4) {
          const remainingSlots = 4 - previewItems.length;
          for (let i = 0; i < remainingSlots; i++) {
            if (selectedItems.folderIds.size > i) {
              previewItems.push({
                type: "folder",
                rotation: Math.random() * 12 - 6,
              });
            }
          }
        }
      } else {
        // 只拖拽当前项
        if (type === "media") {
          const item = data.find((m) => m.id === id);
          previewItems.push({
            type: "media",
            imageId: item?.mediaType === "IMAGE" ? item.imageId : undefined,
            rotation: 0,
          });
        } else {
          previewItems.push({
            type: "folder",
            rotation: 0,
          });
        }
      }

      setActiveDragData({
        type: type as "media" | "folder",
        id,
        count,
        previewItems,
      });
    },
    [selectedItems, data],
  );

  // 拖拽悬停
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (over && String(over.id).startsWith("drop-folder-")) {
      const folderId = Number(String(over.id).replace("drop-folder-", ""));
      setOverFolderId(folderId);
    } else {
      setOverFolderId(null);
    }
  }, []);

  // 拖拽结束
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setIsDragging(false);
      setActiveDragData(null);
      setOverFolderId(null);

      if (!over || !String(over.id).startsWith("drop-folder-")) return;

      const targetFolderId = Number(
        String(over.id).replace("drop-folder-", ""),
      );
      const idStr = String(active.id);
      const [type, idPart] = idStr.split("-");
      const draggedId = Number(idPart);

      // 收集要移动的项目
      const isSelected =
        type === "media"
          ? selectedItems.mediaIds.has(draggedId)
          : selectedItems.folderIds.has(draggedId);

      let mediaIds: number[] = [];
      let folderIds: number[] = [];

      if (isSelected) {
        mediaIds = Array.from(selectedItems.mediaIds);
        folderIds = Array.from(selectedItems.folderIds);
      } else {
        if (type === "media") mediaIds = [draggedId];
        else folderIds = [draggedId];
      }

      // 验证：不能将文件夹拖入自身
      if (folderIds.includes(targetFolderId)) {
        toast.error("不能将文件夹移动到自身");
        return;
      }

      await onMoveItems(mediaIds, folderIds, targetFolderId);
    },
    [selectedItems, onMoveItems, toast],
  );

  // 拖拽取消
  const handleDragCancel = useCallback(() => {
    setIsDragging(false);
    setActiveDragData(null);
    setOverFolderId(null);
  }, []);

  // 无限滚动：IntersectionObserver
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    const scrollContainer = scrollContainerRef.current;

    if (!loadMoreElement || !scrollContainer) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry?.isIntersecting &&
          hasMore &&
          !loading &&
          !isLoadingMoreRef.current
        ) {
          isLoadingMoreRef.current = true;
          onLoadMore();
          // 延迟重置，防止连续触发
          setTimeout(() => {
            isLoadingMoreRef.current = false;
          }, 500);
        }
      },
      {
        root: scrollContainer,
        rootMargin: "200px",
        threshold: 0,
      },
    );

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loading, onLoadMore]);

  // 生成行操作
  const getRowActions = useCallback(
    (item: MediaListItem): RowAction[] => [
      {
        label: "查看详情",
        icon: <RiEyeLine size="1.1em" />,
        onClick: () => onPreview(item),
      },
      {
        label: "编辑",
        icon: <RiEditLine size="1.1em" />,
        onClick: () => onEdit(item),
      },
      {
        label: "删除",
        icon: <RiDeleteBinLine size="1.1em" />,
        onClick: () => onDelete(item),
        variant: "danger" as const,
      },
    ],
    [onPreview, onEdit, onDelete],
  );

  // 打开新建文件夹对话框
  const openCreateFolderDialog = useCallback(() => {
    setNewFolderName("");
    setNewFolderError("");
    setCreateFolderDialogOpen(true);
  }, []);

  // 关闭新建文件夹对话框
  const closeCreateFolderDialog = useCallback(() => {
    setCreateFolderDialogOpen(false);
    setNewFolderName("");
    setNewFolderError("");
  }, []);

  // 处理新建文件夹
  const handleCreateFolder = useCallback(async () => {
    // 验证文件夹名称
    if (!newFolderName.trim()) {
      setNewFolderError("文件夹名称不能为空");
      return;
    }

    if (newFolderName.length > 100) {
      setNewFolderError("文件夹名称不能超过 100 个字符");
      return;
    }

    const invalidChars = /[/\\:*?"<>|]/;
    if (invalidChars.test(newFolderName)) {
      setNewFolderError('文件夹名称不能包含以下字符: / \\ : * ? " < > |');
      return;
    }

    setNewFolderError("");

    const success = await onCreateFolder(newFolderName.trim());
    if (success) {
      closeCreateFolderDialog();
    }
  }, [newFolderName, onCreateFolder, closeCreateFolderDialog]);

  return (
    <>
      {/* 表头 */}
      <GridItem
        areas={[1]}
        width={24}
        height={0.1}
        className="flex items-center justify-between text-2xl px-10"
      >
        <div className="flex items-center gap-4">
          <span>媒体文件管理</span>
          {/* 视图切换 */}
          {viewModeToggle}
          {/* 新建文件夹按钮 */}
          <Tooltip content="新建文件夹" placement="bottom">
            <Clickable
              onClick={openCreateFolderDialog}
              className="p-2 rounded transition-colors bg-muted/30 hover:bg-muted"
              hoverScale={1.05}
            >
              <RiFolderAddLine size="1em" />
            </Clickable>
          </Tooltip>
        </div>
        <div className="flex items-center gap-4">
          {/* 搜索框 */}
          {isMobile ? (
            // 移动端：显示搜索图标
            <Tooltip content="搜索" placement="bottom">
              <Clickable
                onClick={onOpenSearchDialog}
                className="p-2 rounded transition-colors hover:bg-muted inline-flex"
                hoverScale={1.1}
              >
                <RiSearchLine size="1em" />
              </Clickable>
            </Tooltip>
          ) : (
            // 桌面端：显示搜索输入框
            <div className="relative w-[15em]">
              <input
                title="search"
                type="text"
                value={searchValue}
                onChange={(e) => onSearchValueChange(e.target.value)}
                className="
                  relative w-full bg-transparent border-0
                  px-0 py-2 text-base text-foreground
                  focus:outline-none
                "
              />
              <motion.div
                className="absolute bottom-0 left-0 h-0.5 w-full"
                initial={{ backgroundColor: "var(--color-foreground)" }}
                animate={{
                  backgroundColor:
                    searchValue.length > 0
                      ? "var(--color-primary)"
                      : "var(--color-foreground)",
                }}
                transition={{ duration: 0.3 }}
              />
              <motion.label
                className="absolute top-2 left-0 pointer-events-none whitespace-nowrap flex items-center text-base text-foreground"
                animate={{
                  opacity: searchValue.length > 0 ? 0 : 1,
                }}
                transition={{ duration: 0.2 }}
              >
                <RiSearchLine size="1em" className="inline mr-1" />
                搜索显示名称、原始文件名或替代文本...
              </motion.label>
              <AnimatePresence>
                {searchValue.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{
                      duration: 0.3,
                      ease: [0.68, -0.55, 0.265, 1.55],
                    }}
                    onClick={() => onSearchValueChange("")}
                    className="absolute right-0 top-2 text-primary hover:text-foreground transition-colors cursor-pointer flex items-center"
                    type="button"
                  >
                    <RiCloseLine size="1em" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* 筛选按钮 */}
          <Tooltip
            content={hasActiveFilters ? "筛选（已激活）" : "筛选条件"}
            placement="bottom"
          >
            <Clickable
              onClick={onOpenFilterDialog}
              className={`p-2 rounded transition-colors ${
                hasActiveFilters
                  ? "bg-foreground text-background"
                  : "bg-muted/30 hover:bg-muted"
              }`}
              hoverScale={1.05}
            >
              <RiFilter3Line size="1em" />
            </Clickable>
          </Tooltip>
        </div>
      </GridItem>

      {/* 内容区 */}
      <GridItem areas={createArray(2, 12)} width={24 / 11} height={2}>
        <div className="flex flex-col h-full">
          {/* 批量操作栏 */}
          <AnimatePresence>
            {(selectedItems.mediaIds.size > 0 ||
              selectedItems.folderIds.size > 0) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.3, ease: "easeInOut" },
                  opacity: { duration: 0.2, ease: "easeInOut" },
                }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between px-10 py-2 border-b border-muted">
                  <div className="flex items-center gap-4">
                    <AutoTransition
                      key={
                        selectedItems.mediaIds.size +
                        selectedItems.folderIds.size
                      }
                    >
                      <span className="text-primary">
                        已选中{" "}
                        {selectedItems.mediaIds.size > 0 &&
                          `${selectedItems.mediaIds.size} 个文件`}
                        {selectedItems.mediaIds.size > 0 &&
                          selectedItems.folderIds.size > 0 &&
                          "、"}
                        {selectedItems.folderIds.size > 0 &&
                          `${selectedItems.folderIds.size} 个文件夹`}
                      </span>
                    </AutoTransition>
                  </div>
                  <div className="flex items-center gap-2">
                    {batchActions.map((action) => (
                      <Button
                        key={action.label}
                        label={action.label || "操作"}
                        variant={action.variant || "outline"}
                        size="sm"
                        icon={action.icon}
                        onClick={action.onClick}
                        disabled={
                          action.disabled ||
                          (selectedItems.mediaIds.size === 0 &&
                            selectedItems.folderIds.size === 0)
                        }
                        loading={action.loading}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 面包屑导航栏 */}
          <AnimatePresence>
            {currentFolderId !== null && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { duration: 0.3, ease: "easeInOut" },
                  opacity: { duration: 0.2, ease: "easeInOut" },
                }}
                className="overflow-hidden"
              >
                <div className="flex items-center justify-between px-10 py-2 border-b border-muted">
                  <div className="flex items-center gap-2 text-sm">
                    {breadcrumbItems.map((item, index) => (
                      <React.Fragment key={item.id || "root"}>
                        {index > 0 && (
                          <RiArrowRightSLine
                            className="text-muted-foreground"
                            size="1.2em"
                          />
                        )}
                        <button
                          onClick={() => onNavigateToBreadcrumb(index)}
                          className={`transition-colors hover:text-foreground ${
                            index === breadcrumbItems.length - 1
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          }`}
                        >
                          {item.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                  <Button
                    label="返回上一级"
                    variant="ghost"
                    size="sm"
                    icon={<RiArrowLeftSLine size="1em" />}
                    onClick={onGoBack}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 网格内容 */}
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div
              ref={scrollContainerRef}
              className={`flex-1 min-h-0 overflow-auto px-10 py-6 scroll-smooth relative ${
                isSelecting ? "select-none" : ""
              }`}
            >
              {/* 框选覆盖层 */}
              {selectionRect && (
                <div
                  className="absolute border border-primary/50 bg-primary/10 pointer-events-none z-20"
                  style={{
                    left: selectionRect.x,
                    top: selectionRect.y,
                    width: selectionRect.width,
                    height: selectionRect.height,
                  }}
                />
              )}

              <AutoTransition type="slideDown" duration={0.3}>
                {loading && data.length === 0 ? (
                  <div className="h-full py-70" key="loading">
                    <LoadingIndicator />
                  </div>
                ) : data.length === 0 && folders.length === 0 ? (
                  <div
                    className="flex items-center justify-center h-full"
                    key="empty"
                  >
                    <div className="text-muted-foreground">暂无媒体文件</div>
                  </div>
                ) : (
                  <div key={currentFolderId || "root"}>
                    <div
                      className="grid gap-4"
                      style={{
                        gridTemplateColumns: isMobile
                          ? "repeat(auto-fill, minmax(8em, 1fr))"
                          : "repeat(auto-fill, minmax(10em, 1fr))",
                        contentVisibility: "auto",
                      }}
                    >
                      {/* 文件夹卡片 */}
                      {folders.map((folder) => {
                        // 判断文件夹是否可选择（系统文件夹不可选）
                        const isSelectable =
                          folder.systemType === "NORMAL" ||
                          (folder.systemType !== "ROOT_PUBLIC" &&
                            folder.systemType !== "ROOT_USERS" &&
                            folder.systemType !== "USER_HOME");

                        return (
                          <FolderGridItem
                            key={folder.id}
                            folder={folder}
                            isSelected={selectedItems.folderIds.has(folder.id)}
                            isSelectable={isSelectable}
                            onSelect={onSelectFolder}
                            onEnter={onEnterFolder}
                            currentUserId={currentUserId}
                            isDragDisabled={isMobile}
                            isDropTarget={overFolderId === folder.id}
                          />
                        );
                      })}

                      {/* 媒体文件卡片 */}
                      {data.map((item, index) => (
                        <MediaGridItem
                          key={item.id}
                          item={item}
                          isSelected={selectedItems.mediaIds.has(item.id)}
                          onSelect={(id, checked) =>
                            onSelectMedia(Number(id), checked)
                          }
                          onPreview={onPreview}
                          formatFileSize={formatFileSize}
                          getFileTypeIcon={getFileTypeIcon}
                          actions={getRowActions(item)}
                          index={index + folders.length}
                          isDragDisabled={isMobile}
                          isShiftHeld={isShiftHeld}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </AutoTransition>

              {/* 无限滚动加载指示器*/}
              <div
                ref={loadMoreRef}
                className={`flex items-center justify-center pt-6 transition-opacity ${loading && data.length === 0 ? "opacity-0" : ""}`}
              >
                <AutoTransition>
                  {loading && (data.length > 0 || folders.length > 0) && (
                    <div
                      className="flex items-center gap-2 text-muted-foreground"
                      key="loading-more"
                    >
                      <LoadingIndicator />
                    </div>
                  )}
                  {!loading &&
                    !hasMore &&
                    (data.length > 0 || folders.length > 0) && (
                      <div
                        className="text-muted-foreground text-sm"
                        key="no-more"
                      >
                        {data.length > 0
                          ? `已加载全部 ${data.length} 个文件`
                          : "当前文件夹没有文件"}
                      </div>
                    )}
                </AutoTransition>
              </div>
            </div>

            {/* 拖拽覆盖层 */}
            {typeof document !== "undefined" &&
              createPortal(
                <DragOverlay
                  dropAnimation={null}
                  modifiers={[snapCenterToCursor]}
                >
                  {activeDragData && (
                    <div
                      className="relative"
                      style={{
                        width: 80,
                        height: 80,
                      }}
                    >
                      {/* 堆叠的预览卡片 */}
                      {activeDragData.previewItems.map((preview, index) => (
                        <div
                          key={index}
                          className="absolute inset-0 rounded-lg overflow-hidden border-2 border-primary shadow-lg bg-muted"
                          style={{
                            transform: `rotate(${preview.rotation}deg)`,
                            zIndex: activeDragData.previewItems.length - index,
                          }}
                        >
                          {preview.type === "media" && preview.imageId ? (
                            <CMSImage
                              src={`/p/${preview.imageId}`}
                              alt=""
                              width={80}
                              height={80}
                              className="w-full h-full object-cover"
                            />
                          ) : preview.type === "folder" ? (
                            <div className="w-full h-full flex items-center justify-center bg-muted">
                              <RiFolderLine
                                size="2em"
                                className="text-muted-foreground"
                              />
                            </div>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted">
                              <RiFileLine
                                size="2em"
                                className="text-muted-foreground"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {/* 数量徽章 */}
                      {activeDragData.count > 1 && (
                        <div className="absolute -top-2 -right-2 z-50 bg-primary text-background text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center shadow">
                          {activeDragData.count}
                        </div>
                      )}
                    </div>
                  )}
                </DragOverlay>,
                document.body,
              )}
          </DndContext>
        </div>
      </GridItem>

      {/* 新建文件夹对话框 */}
      <Dialog
        open={createFolderDialogOpen}
        onClose={closeCreateFolderDialog}
        title="新建文件夹"
        size="sm"
      >
        <div className="px-6 py-6">
          <Input
            label="文件夹名称"
            value={newFolderName}
            onChange={(e) => {
              setNewFolderName(e.target.value);
              if (newFolderError) setNewFolderError("");
            }}
            helperText={newFolderError || "请输入文件夹名称"}
            error={!!newFolderError}
            autoFocus
            size="sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !createFolderLoading) {
                handleCreateFolder();
              }
            }}
          />
          <div className="flex justify-end gap-4 pt-6 border-t border-foreground/10 mt-6">
            <Button
              label="取消"
              variant="ghost"
              onClick={closeCreateFolderDialog}
              size="sm"
              disabled={createFolderLoading}
            />
            <Button
              label="创建"
              variant="primary"
              onClick={handleCreateFolder}
              size="sm"
              loading={createFolderLoading}
              disabled={!newFolderName.trim()}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
}
