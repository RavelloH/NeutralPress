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
    onEnter,
    currentUserId,
  }: {
    folder: FolderItem;
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
        className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors duration-150 hover:bg-muted/50"
        onClick={() => onEnter(folder.id, folder.systemType)}
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

interface FolderPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (folderId: number | null, folderName: string) => void;
  userRole: string;
  userUid: number;
  title?: string;
}

export default function FolderPickerDialog({
  open,
  onClose,
  onSelect,
  userRole,
  userUid,
  title = "选择文件夹",
}: FolderPickerDialogProps) {
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
  // 用于触发重新加载的计数器
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
      // 返回上一级时重置 systemType（会在下次加载时更新）
      setCurrentFolderSystemType(null);
    }
  }, [breadcrumbItems]);

  // 跳转到面包屑项
  const handleNavigateToBreadcrumb = useCallback(
    (index: number) => {
      const item = breadcrumbItems[index];
      if (item) {
        setCurrentFolderId(item.id);
        setCurrentFolderSystemType(null);
      }
    },
    [breadcrumbItems],
  );

  // 确认选择
  const handleConfirm = useCallback(() => {
    // 使用当前浏览的文件夹作为目标
    // 如果当前在根目录，则使用公共空间根目录
    const finalFolderId =
      currentFolderId !== null ? currentFolderId : publicRootId;
    const folderName =
      currentFolderId !== null
        ? breadcrumbItems[breadcrumbItems.length - 1]?.name || "当前文件夹"
        : "公共空间";
    onSelect(finalFolderId, folderName);
    onClose();
  }, [currentFolderId, publicRootId, breadcrumbItems, onSelect, onClose]);

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

  return (
    <>
      <Dialog open={open} onClose={onClose} title={title} size="md">
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
                  暂无子文件夹
                </div>
              ) : (
                <div key={currentFolderId || "root"}>
                  {folders.map((folder) => (
                    <FolderListItem
                      key={folder.id}
                      folder={folder}
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
                    ? "text-error"
                    : "text-foreground"
                }`}
              >
                {currentFolderId === null
                  ? "请选择一个文件夹"
                  : currentFolderSystemType === "ROOT_USERS"
                    ? "不能上传到用户目录"
                    : breadcrumbItems[breadcrumbItems.length - 1]?.name ||
                      "当前文件夹"}
              </span>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-4 px-4 py-6 border-t border-muted">
            <Button label="取消" variant="ghost" onClick={onClose} size="sm" />
            <Button
              label="选择此文件夹"
              variant="primary"
              size="sm"
              onClick={handleConfirm}
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
