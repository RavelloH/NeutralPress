"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  type DragEndEvent,
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
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiEditLine,
  RiEyeLine,
  RiFileLine,
  RiFolderAddLine,
  RiFolderLine,
} from "@remixicon/react";
import type { MediaListItem } from "@repo/shared-types/api/media";
import { AnimatePresence, motion } from "framer-motion";

import CMSImage from "@/components/ui/CMSImage";
import GridTable from "@/components/ui/GridTable";
import Link from "@/components/ui/Link";
import type { FolderItem } from "@/lib/shared/media-types";
import type { MediaTableViewProps, TableRowItem } from "@/types/media-table";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import type { RowComponentProps, TableColumn } from "@/ui/Table";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

// 拖拽行组件
function DraggableTableRow({
  record,
  cells,
  className,
  onClick,
  rowKey,
  isDragDisabled,
}: RowComponentProps & {
  isDragDisabled?: boolean;
}) {
  const rowItem = record as unknown as TableRowItem;
  const isFolder = rowItem.type === "folder";
  const itemId = isFolder
    ? `folder-${rowItem.data.id}`
    : `media-${(rowItem.data as MediaListItem).id}`;

  // 可拖拽
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: itemId,
    disabled:
      isDragDisabled || (isFolder && rowItem.data.systemType !== "NORMAL"),
  });

  // 文件夹可放置
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: isFolder ? `drop-folder-${rowItem.data.id}` : `no-drop-${rowKey}`,
    disabled: !isFolder || rowItem.data.systemType === "ROOT_USERS",
  });

  // 合并 ref
  const setRef = useCallback(
    (node: HTMLTableRowElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  return (
    <motion.tr
      ref={setRef}
      {...attributes}
      {...listeners}
      role="row"
      className={`
        ${className}
        ${isDragging ? "opacity-50" : ""}
        ${isOver ? "ring-2 ring-primary bg-primary/10" : ""}
        ${isFolder ? "bg-muted/10" : ""}
      `}
      onClick={onClick}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
      transition={{ duration: 0.1 }}
    >
      {cells}
    </motion.tr>
  );
}

/**
 * 媒体表格视图组件
 * 负责渲染表格布局的媒体列表，支持文件夹、拖拽和高级选中
 */
export default function MediaTableView({
  // 数据
  data,
  folders,
  loading,

  // 分页
  page,
  totalPages,
  totalRecords,
  pageSize,
  onPageChange,
  onPageSizeChange,

  // 操作回调
  onPreview,
  onEdit,
  onDelete,
  onEnterFolder,

  // 工具函数
  formatFileSize,
  getFileTypeIcon,

  // 视图切换
  viewModeToggle,

  // 排序
  onSortChange,

  // 搜索
  onSearchChange,

  // 筛选
  filterConfig,
  onFilterChange,

  // 批量操作
  batchActions,

  // 选中状态
  selectedItems,
  onSelectMedia: _onSelectMedia,
  onSelectFolder: _onSelectFolder,
  onBatchSelect,
  onClearSelection: _onClearSelection,

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

  // 用户信息
  currentUserId,
  isMobile,
}: MediaTableViewProps) {
  const toast = useToast();

  // 新建文件夹对话框状态
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");

  // 拖拽状态
  const [_isDragging, setIsDragging] = useState(false);
  const [activeDragData, setActiveDragData] = useState<{
    type: "media" | "folder";
    id: number;
    count: number;
    previewItems: Array<{
      type: "media" | "folder";
      imageId?: string;
      rotation: number;
    }>;
  } | null>(null);

  // Shift 键状态
  const isShiftHeldRef = useRef(false);

  // DnD 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // 监听 Shift 键和 Ctrl+A 全选
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") isShiftHeldRef.current = true;

      // Ctrl+A 全选
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement?.getAttribute("contenteditable") === "true"
        ) {
          return;
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
      if (e.key === "Shift") isShiftHeldRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [data, folders, onBatchSelect]);

  // 合并文件夹和媒体数据
  const tableData: TableRowItem[] = useMemo(() => {
    const folderRows: TableRowItem[] = folders.map((folder) => ({
      type: "folder" as const,
      data: folder,
    }));
    const mediaRows: TableRowItem[] = data.map((media) => ({
      type: "media" as const,
      data: media,
    }));
    return [...folderRows, ...mediaRows];
  }, [folders, data]);

  // 计算选中的 keys（用于 GridTable 的受控模式）
  const controlledSelectedKeys = useMemo(() => {
    const keys = new Set<string | number>();
    selectedItems.mediaIds.forEach((id) => keys.add(`media-${id}`));
    selectedItems.folderIds.forEach((id) => keys.add(`folder-${id}`));
    return keys;
  }, [selectedItems]);

  // 获取文件夹显示名称
  const formatFolderName = useCallback(
    (folder: FolderItem) => {
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
    },
    [currentUserId],
  );

  // 获取行唯一键
  const getRowKey = useCallback((item: TableRowItem): string => {
    if (item.type === "folder") {
      return `folder-${item.data.id}`;
    }
    return `media-${(item.data as MediaListItem).id}`;
  }, []);

  // 处理选中变化
  const handleSelectionChange = useCallback(
    (selectedKeys: (string | number)[]) => {
      const mediaIds: number[] = [];
      const folderIds: number[] = [];

      selectedKeys.forEach((key) => {
        const keyStr = String(key);
        if (keyStr.startsWith("media-")) {
          mediaIds.push(Number(keyStr.replace("media-", "")));
        } else if (keyStr.startsWith("folder-")) {
          folderIds.push(Number(keyStr.replace("folder-", "")));
        }
      });

      onBatchSelect(mediaIds, folderIds, false);
    },
    [onBatchSelect],
  );

  // 处理范围选择
  const handleRangeSelect = useCallback(
    (startIndex: number, endIndex: number) => {
      const mediaIds: number[] = [];
      const folderIds: number[] = [];

      for (let i = startIndex; i <= endIndex; i++) {
        const item = tableData[i];
        if (!item) continue;

        if (item.type === "folder") {
          // 只选择普通文件夹
          const folder = item.data;
          if (folder.systemType === "NORMAL") {
            folderIds.push(folder.id);
          }
        } else {
          const media = item.data as MediaListItem;
          mediaIds.push(media.id);
        }
      }

      onBatchSelect(mediaIds, folderIds, isShiftHeldRef.current);
    },
    [tableData, onBatchSelect],
  );

  // 行操作按钮
  const rowActions = useCallback(
    (record: TableRowItem) => {
      if (record.type === "folder") {
        return [
          {
            label: "进入文件夹",
            icon: <RiArrowRightSLine size="1.1em" />,
            onClick: () => onEnterFolder(record.data.id),
          },
        ];
      }

      const media = record.data as MediaListItem;
      return [
        {
          label: "查看详情",
          icon: <RiEyeLine size="1.1em" />,
          onClick: () => onPreview(media),
        },
        {
          label: "编辑",
          icon: <RiEditLine size="1.1em" />,
          onClick: () => onEdit(media),
        },
        {
          label: "删除",
          icon: <RiDeleteBinLine size="1.1em" />,
          onClick: () => onDelete(media),
          variant: "danger" as const,
        },
      ];
    },
    [onPreview, onEdit, onDelete, onEnterFolder],
  );

  // 处理行点击
  const handleRowClick = useCallback(
    (record: TableRowItem, _index: number, _event: React.MouseEvent) => {
      if (record.type === "folder") {
        onEnterFolder(record.data.id);
      } else {
        onPreview(record.data as MediaListItem);
      }
    },
    [onEnterFolder, onPreview],
  );

  // 表格列定义
  const columns: TableColumn<TableRowItem>[] = useMemo(
    () => [
      {
        key: "id",
        title: "ID",
        dataIndex: "data",
        align: "left" as const,
        sortable: true,
        mono: true,
        width: "80px",
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          return (record.data as MediaListItem).id;
        },
      },
      {
        key: "preview",
        title: "预览",
        dataIndex: "data",
        align: "left" as const,
        width: "80px",
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return (
              <div className="w-12 h-12 bg-muted/30 rounded-sm overflow-hidden flex items-center justify-center">
                <RiFolderLine size="1.5em" className="text-muted-foreground" />
              </div>
            );
          }

          const media = record.data as MediaListItem;
          if (media.mediaType === "IMAGE" && media.width && media.height) {
            return (
              <div className="w-12 h-12 bg-muted rounded-sm overflow-hidden flex items-center justify-center">
                <CMSImage
                  src={`/p/${media.imageId}`}
                  alt={media.originalName}
                  width={96}
                  height={96}
                  blur={media.blur}
                  className="w-full h-full object-cover"
                />
              </div>
            );
          }
          return (
            <div className="w-12 h-12 bg-muted rounded-sm overflow-hidden flex items-center justify-center">
              {getFileTypeIcon(media.mediaType)}
            </div>
          );
        },
      },
      {
        key: "originalName",
        title: "名称",
        dataIndex: "data",
        align: "left" as const,
        sortable: true,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            const folder = record.data;
            return (
              <div className="max-w-[200px]">
                <div
                  className="truncate font-medium"
                  title={formatFolderName(folder)}
                >
                  {formatFolderName(folder)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {folder.fileCount !== undefined
                    ? `${folder.fileCount} 个文件`
                    : "文件夹"}
                </div>
              </div>
            );
          }

          const media = record.data as MediaListItem;
          return (
            <div className="max-w-[200px]">
              <div className="truncate" title={media.originalName}>
                {media.originalName}
              </div>
              <div
                className="text-xs text-muted-foreground truncate"
                title={media.fileName}
              >
                {media.fileName}
              </div>
            </div>
          );
        },
      },
      {
        key: "size",
        title: "大小",
        dataIndex: "data",
        align: "right" as const,
        sortable: true,
        mono: true,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          return formatFileSize((record.data as MediaListItem).size);
        },
      },
      {
        key: "dimensions",
        title: "尺寸",
        dataIndex: "data",
        mono: true,
        align: "center" as const,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          const media = record.data as MediaListItem;
          if (media.width && media.height) {
            return `${media.width} × ${media.height}`;
          }
          return "-";
        },
      },
      {
        key: "user",
        title: "上传者",
        dataIndex: "data",
        align: "center" as const,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          const media = record.data as MediaListItem;
          const user = media.user;
          if (!user) {
            return <span className="text-muted-foreground">-</span>;
          }
          return (
            <Link
              href={`/admin/users?uid=${user.uid}`}
              presets={["hover-underline"]}
              title={`@${user.username}`}
            >
              {user.nickname || `@${user.username}`}
            </Link>
          );
        },
      },
      {
        key: "inGallery",
        title: "图库",
        dataIndex: "data",
        align: "center" as const,
        sortable: true,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          const media = record.data as MediaListItem;
          return media.inGallery ? (
            <span className="text-success flex items-center justify-center">
              <RiCheckLine size="1.5em" />
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center justify-center">
              <RiCloseLine size="1.5em" />
            </span>
          );
        },
      },
      {
        key: "createdAt",
        title: "上传时间",
        dataIndex: "data",
        align: "center" as const,
        sortable: true,
        mono: true,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            const folder = record.data;
            return new Date(folder.createdAt).toLocaleString("zh-CN", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            });
          }
          const media = record.data as MediaListItem;
          return new Date(media.createdAt).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
        },
      },
      {
        key: "postsCount",
        title: "引用次数",
        dataIndex: "data",
        align: "center" as const,
        sortable: true,
        render: (_value: unknown, record: TableRowItem) => {
          if (record.type === "folder") {
            return <span className="text-muted-foreground">-</span>;
          }
          const media = record.data as MediaListItem;
          const count = media.postsCount || 0;
          return (
            <span
              className={count > 0 ? "text-primary" : "text-muted-foreground"}
            >
              {count}
            </span>
          );
        },
      },
    ],
    [formatFileSize, getFileTypeIcon, formatFolderName],
  );

  // 拖拽开始
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const idStr = String(active.id);
      const [type, idPart] = idStr.split("-");
      const id = Number(idPart);

      setIsDragging(true);

      const isSelected =
        type === "media"
          ? selectedItems.mediaIds.has(id)
          : selectedItems.folderIds.has(id);

      const count = isSelected
        ? selectedItems.mediaIds.size + selectedItems.folderIds.size
        : 1;

      // 收集预览图信息
      const previewItems: Array<{
        type: "media" | "folder";
        imageId?: string;
        rotation: number;
      }> = [];

      if (isSelected) {
        const selectedMediaItems = data.filter((item) =>
          selectedItems.mediaIds.has(item.id),
        );
        for (const item of selectedMediaItems.slice(0, 4)) {
          previewItems.push({
            type: "media",
            imageId: item.mediaType === "IMAGE" ? item.imageId : undefined,
            rotation: Math.random() * 48 - 24,
          });
        }
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

  // 拖拽结束
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setIsDragging(false);
      setActiveDragData(null);

      if (!over || !String(over.id).startsWith("drop-folder-")) return;

      const targetFolderId = Number(
        String(over.id).replace("drop-folder-", ""),
      );
      const idStr = String(active.id);
      const [type, idPart] = idStr.split("-");
      const draggedId = Number(idPart);

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
  }, []);

  // 新建文件夹相关
  const openCreateFolderDialog = useCallback(() => {
    setNewFolderName("");
    setNewFolderError("");
    setCreateFolderDialogOpen(true);
  }, []);

  const closeCreateFolderDialog = useCallback(() => {
    setCreateFolderDialogOpen(false);
    setNewFolderName("");
    setNewFolderError("");
  }, []);

  const handleCreateFolder = useCallback(async () => {
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

  // 自定义行组件（注入拖拽功能）
  const CustomRowComponent = useCallback(
    (props: RowComponentProps) => {
      return <DraggableTableRow {...props} isDragDisabled={isMobile} />;
    },
    [isMobile],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <GridTable<TableRowItem>
        title={
          <div className="flex items-center gap-4">
            <span>媒体文件管理</span>
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
        }
        contentHeader={
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
        }
        columns={columns}
        data={tableData}
        loading={loading}
        rowKey={getRowKey}
        page={page}
        totalPages={totalPages}
        totalRecords={totalRecords + folders.length}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onSortChange={onSortChange}
        onSearchChange={onSearchChange}
        onRowClick={handleRowClick}
        searchPlaceholder="搜索显示名称、原始文件名或替代文本..."
        filterConfig={filterConfig}
        onFilterChange={onFilterChange}
        striped
        hoverable
        bordered={false}
        size="sm"
        emptyText="暂无媒体文件"
        stickyHeader
        maxHeight="100%"
        padding={2.5}
        enableActions={true}
        batchActions={batchActions}
        rowActions={rowActions}
        onSelectionChange={handleSelectionChange}
        controlledSelectedKeys={controlledSelectedKeys}
        onRangeSelect={handleRangeSelect}
        rowComponent={CustomRowComponent}
      />

      {/* 拖拽覆盖层 */}
      {typeof document !== "undefined" &&
        createPortal(
          <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
            {activeDragData && (
              <div
                className="relative"
                style={{
                  width: 80,
                  height: 80,
                }}
              >
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
    </DndContext>
  );
}
