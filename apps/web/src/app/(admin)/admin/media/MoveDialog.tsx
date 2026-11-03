"use client";

import React, { memo, useCallback, useEffect, useState } from "react";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiFolderAddLine,
  RiFolderLine,
} from "@remixicon/react";

import { createFolder } from "@/actions/media";
import {
  getAccessibleFolders,
  getFolderBreadcrumb,
} from "@/lib/client/folder-utils";
import type { FolderItem } from "@/lib/shared/media-types";
import type { BreadcrumbItem } from "@/types/media-table";
import { AutoTransition } from "@/ui/AutoTransition";
import { Button } from "@/ui/Button";
import Clickable from "@/ui/Clickable";
import { Dialog } from "@/ui/Dialog";
import { Input } from "@/ui/Input";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { useToast } from "@/ui/Toast";
import { Tooltip } from "@/ui/Tooltip";

// 文件夹列表项组件
const FolderListItem = memo(
  ({
    folder,
    isDisabled,
    onEnter,
    currentUserId,
  }: {
    folder: FolderItem;
    isDisabled: boolean;
    onEnter: (folderId: number, systemType: string) => void;
    currentUserId: number;
  }) => {
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

    return (
      <div
        className={`
          flex items-center gap-3 px-4 py-3 cursor-pointer
          transition-colors duration-150
          hover:bg-muted/50
          ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        onClick={() => {
          if (!isDisabled) {
            onEnter(folder.id, folder.systemType);
          }
        }}
      >
        <RiFolderLine size="1.5em" className="text-muted-foreground" />
        <span className="flex-1">{formatFolderName()}</span>
        {folder.fileCount !== undefined && folder.fileCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {folder.fileCount}
          </span>
        )}
        <RiArrowRightSLine className="text-muted-foreground" size="1.2em" />
      </div>
    );
  },
);

FolderListItem.displayName = "FolderListItem";

interface MoveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (targetFolderId: number | null) => Promise<void>;
  userRole: string;
  userUid: number;
  // 被选中要移动的文件夹 ID（用于禁止移动到自身或子文件夹）
  selectedFolderIds: number[];
  loading: boolean;
}

export default function MoveDialog({
  open,
  onClose,
  onConfirm,
  userRole,
  userUid,
  selectedFolderIds,
  loading,
}: MoveDialogProps) {
  const toast = useToast();

  // 当前浏览的文件夹 ID
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  // 当前文件夹的 systemType（用于判断是否可选择）
  const [currentFolderSystemType, setCurrentFolderSystemType] = useState<
    string | null
  >(null);
  // 文件夹列表
  const [folders, setFolders] = useState<FolderItem[]>([]);
  // 面包屑
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([
    { id: null, name: "全部" },
  ]);
  // 加载状态
  const [foldersLoading, setFoldersLoading] = useState(false);
  // 新建文件夹状态
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState("");
  const [createFolderLoading, setCreateFolderLoading] = useState(false);
  // 公共空间根目录 ID
  const [publicRootId, setPublicRootId] = useState<number | null>(null);
  // 用于触发重新加载的计数器（解决 currentFolderId 为 null 时无法重新触发的问题）
  const [loadTrigger, setLoadTrigger] = useState(0);

  // 加载文件夹列表
  const loadFolders = useCallback(
    async (folderId: number | null) => {
      setFoldersLoading(true);
      try {
        const { folders: folderList, publicRootId: rootId } =
          await getAccessibleFolders(userRole, userUid, "", folderId);

        // 保存 publicRootId
        if (folderId === null && rootId !== null) {
          setPublicRootId(rootId);
        }

        let filteredFolders = folderList;

        if (folderId === null) {
          // 根目录时：显示 USER_HOME、ROOT_PUBLIC、ROOT_USERS（管理员/编辑可见）
          // 过滤掉：虚拟文件夹、公共空间的子文件夹（NORMAL 类型）
          filteredFolders = folderList.filter(
            (f) => f.id !== -1 && f.systemType !== "NORMAL",
          );
        } else {
          // 非根目录：过滤掉虚拟文件夹
          filteredFolders = folderList.filter((f) => f.id !== -1);
        }

        setFolders(filteredFolders);
      } catch (error) {
        console.error("Failed to load folders:", error);
      } finally {
        setFoldersLoading(false);
      }
    },
    [userRole, userUid],
  );

  // 加载面包屑
  const loadBreadcrumb = useCallback(async (folderId: number | null) => {
    if (folderId === null) {
      setBreadcrumbItems([{ id: null, name: "全部" }]);
      return;
    }
    try {
      const breadcrumb = await getFolderBreadcrumb(folderId, "");
      setBreadcrumbItems(breadcrumb);
    } catch (error) {
      console.error("Failed to load breadcrumb:", error);
    }
  }, []);

  // 打开对话框时重置状态并加载数据
  useEffect(() => {
    if (open) {
      setCurrentFolderId(null);
      setCurrentFolderSystemType(null);
      setBreadcrumbItems([{ id: null, name: "全部" }]);
      setFolders([]);
      setLoadTrigger((prev) => prev + 1);
    }
  }, [open]);

  // 加载文件夹和面包屑
  useEffect(() => {
    if (!open) return;

    loadFolders(currentFolderId);
    loadBreadcrumb(currentFolderId);
  }, [loadTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // 当 currentFolderId 变化时重新加载（进入子文件夹或返回）
  useEffect(() => {
    if (!open) return;
    // 初始加载由 loadTrigger 处理，这里只处理导航
    loadFolders(currentFolderId);
    loadBreadcrumb(currentFolderId);
  }, [currentFolderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 进入文件夹
  const handleEnterFolder = useCallback(
    (folderId: number, systemType?: string) => {
      setCurrentFolderId(folderId);
      setCurrentFolderSystemType(systemType || null);
    },
    [],
  );

  // 返回上一级
  const handleGoBack = useCallback(() => {
    if (breadcrumbItems.length <= 1) return;
    const parentItem = breadcrumbItems[breadcrumbItems.length - 2];
    if (parentItem) {
      setCurrentFolderId(parentItem.id);
    }
  }, [breadcrumbItems]);

  // 跳转到面包屑项
  const handleNavigateToBreadcrumb = useCallback(
    (index: number) => {
      const item = breadcrumbItems[index];
      if (item) {
        setCurrentFolderId(item.id);
      }
    },
    [breadcrumbItems],
  );

  // 确认移动
  const handleConfirm = useCallback(async () => {
    // 使用当前浏览的文件夹作为目标
    // 如果当前在根目录，则移动到公共空间根目录
    const finalTargetId =
      currentFolderId !== null ? currentFolderId : publicRootId;
    await onConfirm(finalTargetId);
  }, [currentFolderId, publicRootId, onConfirm]);

  // 创建文件夹
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

    setCreateFolderLoading(true);
    try {
      const result = await createFolder({
        access_token: "",
        name: newFolderName.trim(),
        parentId: currentFolderId,
      });

      if (result.success) {
        toast.success(`文件夹 "${newFolderName}" 创建成功`);
        setCreateFolderDialogOpen(false);
        setNewFolderName("");
        setNewFolderError("");
        // 刷新文件夹列表
        await loadFolders(currentFolderId);
      } else {
        setNewFolderError(result.message || "创建失败");
      }
    } catch (error) {
      console.error("Create folder error:", error);
      setNewFolderError("创建失败，请稍后重试");
    } finally {
      setCreateFolderLoading(false);
    }
  }, [currentFolderId, newFolderName, toast, loadFolders]);

  // 判断文件夹是否被禁用（不能移动到自身或其子文件夹）
  const isFolderDisabled = useCallback(
    (folder: FolderItem) => {
      // 检查是否是被选中的文件夹
      if (selectedFolderIds.includes(folder.id)) {
        return true;
      }
      // 检查是否是被选中文件夹的子文件夹
      for (const selectedId of selectedFolderIds) {
        if (folder.path.includes(`/${selectedId}/`)) {
          return true;
        }
      }
      return false;
    },
    [selectedFolderIds],
  );

  return (
    <>
      <Dialog open={open} onClose={onClose} title="移动到..." size="md">
        <div className="flex flex-col h-[60vh]">
          {/* 工具栏 */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-muted">
            <div className="flex items-center gap-2 text-sm overflow-x-auto">
              {breadcrumbItems.map((item, index) => (
                <React.Fragment key={item.id || "root"}>
                  {index > 0 && (
                    <RiArrowRightSLine
                      className="text-muted-foreground flex-shrink-0"
                      size="1.2em"
                    />
                  )}
                  <button
                    onClick={() => handleNavigateToBreadcrumb(index)}
                    className={`whitespace-nowrap transition-colors hover:text-foreground ${
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
            <div className="flex items-center gap-2 flex-shrink-0">
              {currentFolderId !== null && (
                <Tooltip content="返回上一级" placement="bottom">
                  <Clickable
                    onClick={handleGoBack}
                    className="p-2 rounded transition-colors hover:bg-muted"
                    hoverScale={1.05}
                  >
                    <RiArrowLeftSLine size="1.2em" />
                  </Clickable>
                </Tooltip>
              )}
              <Tooltip content="新建文件夹" placement="bottom">
                <Clickable
                  onClick={() => {
                    setNewFolderName("");
                    setNewFolderError("");
                    setCreateFolderDialogOpen(true);
                  }}
                  className="p-2 rounded transition-colors hover:bg-muted"
                  hoverScale={1.05}
                >
                  <RiFolderAddLine size="1.2em" />
                </Clickable>
              </Tooltip>
            </div>
          </div>

          {/* 文件夹列表 */}
          <div className="flex-1 overflow-auto">
            <AutoTransition type="fade" duration={0.2} className="h-full">
              {foldersLoading ? (
                <div
                  className="flex items-center justify-center h-full"
                  key="loading"
                >
                  <LoadingIndicator />
                </div>
              ) : folders.length === 0 ? (
                <div
                  className="flex items-center justify-center h-full text-muted-foreground"
                  key="empty"
                >
                  暂无文件夹
                </div>
              ) : (
                <div key={currentFolderId || "root"}>
                  {folders.map((folder) => (
                    <FolderListItem
                      key={folder.id}
                      folder={folder}
                      isDisabled={isFolderDisabled(folder)}
                      onEnter={handleEnterFolder}
                      currentUserId={userUid}
                    />
                  ))}
                </div>
              )}
            </AutoTransition>
          </div>

          {/* 当前位置提示 */}
          <div className="px-4 py-2 border-t border-muted bg-muted/30">
            <div className="text-sm text-muted-foreground">
              目标位置：
              <span
                className={`font-medium ml-1 ${
                  currentFolderSystemType === "ROOT_USERS"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }`}
              >
                {currentFolderId === null
                  ? "请选择一个文件夹"
                  : breadcrumbItems[breadcrumbItems.length - 1]?.name ||
                    "当前文件夹"}
              </span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-4 px-4 py-6 border-t border-muted">
            <Button
              label="取消"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={loading}
            />
            <Button
              label="移动到此处"
              size="sm"
              variant="primary"
              onClick={handleConfirm}
              loading={loading}
              disabled={
                currentFolderId === null ||
                currentFolderSystemType === "ROOT_USERS"
              }
            />
          </div>
        </div>
      </Dialog>

      {/* 新建文件夹对话框 */}
      <Dialog
        open={createFolderDialogOpen}
        onClose={() => setCreateFolderDialogOpen(false)}
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
              onClick={() => setCreateFolderDialogOpen(false)}
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
