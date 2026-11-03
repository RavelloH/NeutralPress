// 文件夹相关工具函数
import {
  getAccessibleFolders as getAccessibleFoldersAction,
  getFolderBreadcrumb as getFolderBreadcrumbAction,
} from "@/lib/client/api/media-read";
import type { BreadcrumbItem, FolderItem } from "@/lib/shared/media-types";

// 重新导出类型
export type { FolderItem, BreadcrumbItem };

// 获取文件夹结果类型
export interface GetFoldersResult {
  folders: FolderItem[];
  publicRootId: number | null;
}

/**
 * 根据用户角色获取可访问的文件夹列表
 */
export async function getAccessibleFolders(
  _userRole: string,
  _userUid: number,
  _accessToken: string,
  parentId?: number | null,
): Promise<GetFoldersResult> {
  try {
    const result = await getAccessibleFoldersAction({
      parentId,
    });

    if (!result.success) {
      console.error("Failed to fetch folders:", result.message);
      return { folders: [], publicRootId: null };
    }

    return {
      folders: result.data || [],
      publicRootId:
        (result.meta as { publicRootId?: number })?.publicRootId ?? null,
    };
  } catch (error) {
    console.error("Error fetching folders:", error);
    return { folders: [], publicRootId: null };
  }
}

/**
 * 获取文件夹的面包屑导航
 */
export async function getFolderBreadcrumb(
  folderId: number | null,
  _accessToken: string,
): Promise<BreadcrumbItem[]> {
  if (!folderId) {
    return [{ id: null, name: "全部" }];
  }

  try {
    const result = await getFolderBreadcrumbAction({
      folderId,
    });

    if (!result.success) {
      return [{ id: null, name: "全部" }];
    }

    return result.data || [{ id: null, name: "全部" }];
  } catch (error) {
    console.error("Error fetching breadcrumb:", error);
    return [{ id: null, name: "全部" }];
  }
}

/**
 * 格式化文件夹名称用于显示
 */
export function formatFolderName(
  folder: FolderItem,
  userRole: string,
  currentUserId: number,
): string {
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
}

/**
 * 判断是否可以进入某个文件夹
 */
export function canEnterFolder(
  folder: FolderItem,
  userRole: string,
  currentUserId: number,
): boolean {
  switch (folder.systemType) {
    case "ROOT_PUBLIC":
      return true; // 所有人可以进入公共空间
    case "ROOT_USERS":
      return userRole === "ADMIN" || userRole === "EDITOR"; // 仅管理员/编辑可以进入用户目录
    case "USER_HOME":
      return (
        folder.userUid === currentUserId ||
        userRole === "ADMIN" ||
        userRole === "EDITOR"
      );
    default:
      return folder.userUid === currentUserId || userRole === "ADMIN";
  }
}
