import type { GetMediaList, MediaListItem } from "@repo/shared-types/api/media";

import type { ProcessMode } from "@/lib/server/image-processor";

export interface UploadMediaFile {
  /** 文件 buffer */
  buffer: Buffer;
  /** 原始文件名 */
  originalName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 原始文件大小 */
  originalSize: number;
}

export interface UploadMediaParams {
  /** 访问令牌 */
  access_token: string;
  /** 文件列表 */
  files: UploadMediaFile[];
  /** 处理模式 */
  mode: ProcessMode;
  /** 存储提供商 ID（可选，不传则使用默认） */
  storageProviderId?: string;
}

export interface UploadMediaResult {
  /** 媒体 ID */
  id: number;
  /** 原始文件名 */
  originalName: string;
  /** 短哈希 */
  shortHash: string;
  /** 图片 ID（用于访问） */
  imageId: string;
  /** 访问 URL */
  url: string;
  /** 原始文件大小 */
  originalSize: number;
  /** 处理后文件大小 */
  processedSize: number;
  /** 是否为去重复用 */
  isDuplicate: boolean;
  /** 宽度 */
  width: number | null;
  /** 高度 */
  height: number | null;
}

export interface FolderItem {
  id: number;
  name: string;
  systemType: "NORMAL" | "ROOT_PUBLIC" | "ROOT_USERS" | "USER_HOME";
  userUid?: number | null;
  parentId?: number | null;
  path: string;
  depth: number;
  order: number;
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
}

export interface BreadcrumbItem {
  id: number | null;
  name: string;
  systemType?: string;
  userUid?: number | null;
}

export interface GetAccessibleFoldersParams {
  access_token: string;
  userRole: string;
  userUid: number;
  parentId?: number | null; // 获取指定父文件夹下的子文件夹
}

export interface GetFolderBreadcrumbParams {
  access_token: string;
  folderId: number | null;
}

export interface EnsureUserHomeFolderParams {
  access_token: string;
  userUid: number;
  username: string;
}

export interface GetMediaExplorerPageParams
  extends Omit<GetMediaList, "folderId"> {
  currentFolderId?: number | null;
}

export interface MediaExplorerPageData {
  media: MediaListItem[];
  folders: FolderItem[];
  breadcrumb: BreadcrumbItem[];
  currentFolderId: number | null;
  mediaFolderId: number | null;
  publicRootId: number | null;
}

export interface CreateFolderParams {
  access_token: string;
  name: string;
  parentId: number | null; // 父文件夹 ID，null 表示创建在公共空间根目录
  description?: string;
}

export interface MoveItemsParams {
  access_token: string;
  mediaIds?: number[]; // 要移动的媒体文件 ID
  folderIds?: number[]; // 要移动的文件夹 ID
  targetFolderId: number | null; // 目标文件夹 ID，null 表示移动到公共空间根目录
}

export interface MoveItemsResult {
  movedMedia: number;
  movedFolders: number;
}

export interface DeleteFoldersParams {
  access_token: string;
  ids: number[];
}

export interface DeleteFoldersResult {
  deleted: number;
  deletedMediaCount: number;
}
