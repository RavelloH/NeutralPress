import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
  PaginationMeta,
} from "@repo/shared-types/api/common";
import type {
  BatchUpdateMedia,
  DeleteMedia,
  GallerySize,
  GetMediaDetail,
  GetMediaList,
  GetMediaStats,
  GetMediaTrends,
  MediaDetail,
  MediaListItem,
  MediaStats,
  MediaTrendItem,
  UpdateMedia,
} from "@repo/shared-types/api/media";
import {
  BatchUpdateMediaSchema,
  DeleteMediaSchema,
  GetMediaDetailSchema,
  GetMediaListSchema,
  GetMediaStatsSchema,
  GetMediaTrendsSchema,
  UpdateMediaSchema,
} from "@repo/shared-types/api/media";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { parseExifBuffer } from "@/lib/client/media-exif";
import type { GalleryPhoto } from "@/lib/gallery-layout";
import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { generateCacheKey, getCache, setCache } from "@/lib/server/cache";
import { generateSignedImageId } from "@/lib/server/image-crypto";
import { expireCacheTag as updateTag } from "@/lib/server/isr-invalidation";
import { getGalleryPhotosData } from "@/lib/server/media";
import { deleteObject } from "@/lib/server/oss";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { slugify } from "@/lib/server/slugify";
import { validateData } from "@/lib/server/validator";
import { isVirtualStorage } from "@/lib/server/virtual-storage";
import type {
  BreadcrumbItem,
  CreateFolderParams,
  DeleteFoldersParams,
  DeleteFoldersResult,
  EnsureUserHomeFolderParams,
  FolderItem,
  GetAccessibleFoldersParams,
  GetFolderBreadcrumbParams,
  GetMediaExplorerPageParams,
  MediaExplorerPageData,
  MoveItemsParams,
  MoveItemsResult,
} from "@/lib/shared/media-types";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
// ... (rest of the type definitions)

/**
 * 内部辅助函数：从 Media 记录中提取拍摄时间
 */
function extractShotAtFromMedia(exif: unknown): Date | null {
  if (!exif || typeof exif !== "object") return null;

  const exifObj = exif as Record<string, unknown>;
  if (!exifObj.raw) return null;

  const raw = exifObj.raw as Record<string, unknown>;

  try {
    // Prisma 的 Json 字段会将 Buffer 序列化为 { type: 'Buffer', data: [...] }
    let buffer: Buffer;
    if (Buffer.isBuffer(raw)) {
      buffer = raw as unknown as Buffer;
    } else if (
      raw &&
      typeof raw === "object" &&
      raw.type === "Buffer" &&
      Array.isArray(raw.data)
    ) {
      buffer = Buffer.from(raw.data as number[]);
    } else {
      return null;
    }

    const parsed = parseExifBuffer(buffer);
    return parsed?.dateTimeOriginal || parsed?.dateTime || null;
  } catch (error) {
    console.error("Failed to extract shotAt from exif:", error);
    return null;
  }
}
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

interface ReferencedContentCacheTargets {
  postSlugs: Set<string>;
  projectSlugs: Set<string>;
  hasPublishedPost: boolean;
  hasPublishedProject: boolean;
}

async function collectReferencedContentCacheTargets(
  mediaIds: readonly number[],
): Promise<ReferencedContentCacheTargets> {
  if (mediaIds.length === 0) {
    return {
      postSlugs: new Set<string>(),
      projectSlugs: new Set<string>(),
      hasPublishedPost: false,
      hasPublishedProject: false,
    };
  }

  const references = await prisma.mediaReference.findMany({
    where: {
      mediaId: {
        in: Array.from(new Set(mediaIds)),
      },
      OR: [{ postId: { not: null } }, { projectId: { not: null } }],
    },
    select: {
      post: {
        select: {
          slug: true,
          status: true,
          deletedAt: true,
        },
      },
      project: {
        select: {
          slug: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  const postSlugs = new Set<string>();
  const projectSlugs = new Set<string>();
  let hasPublishedPost = false;
  let hasPublishedProject = false;

  for (const reference of references) {
    const post = reference.post;
    if (post && !post.deletedAt) {
      postSlugs.add(post.slug);
      if (post.status === "PUBLISHED") {
        hasPublishedPost = true;
      }
    }

    const project = reference.project;
    if (project && !project.deletedAt) {
      projectSlugs.add(project.slug);
      if (project.status === "PUBLISHED") {
        hasPublishedProject = true;
      }
    }
  }

  return {
    postSlugs,
    projectSlugs,
    hasPublishedPost,
    hasPublishedProject,
  };
}

function invalidateReferencedContentCaches(
  targets: ReferencedContentCacheTargets,
): void {
  for (const slug of targets.postSlugs) {
    updateTag(`posts/${slug}`);
  }

  for (const slug of targets.projectSlugs) {
    updateTag(`projects/${slug}`);
  }

  if (targets.hasPublishedPost) {
    updateTag("posts/list");
  }

  if (targets.hasPublishedProject) {
    updateTag("projects/list");
  }
}

interface SanitizeExifOptions {
  keepRaw?: boolean;
  keepGps?: boolean;
}

function sanitizeExifForClient(
  exif: unknown,
  options: SanitizeExifOptions = {},
): unknown {
  const { keepRaw = false, keepGps = false } = options;

  if (!exif || typeof exif !== "object" || Array.isArray(exif)) {
    return exif;
  }

  const exifObj = exif as Record<string, unknown>;
  const safeExif: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(exifObj)) {
    const lowered = key.toLowerCase();
    if (!keepRaw && lowered === "raw") {
      continue;
    }
    if (!keepGps && lowered.includes("gps")) {
      continue;
    }
    safeExif[key] = value;
  }

  return safeExif;
}

function extractObjectKeyFromStorageUrl(
  storageUrl: string,
  baseUrl: string,
): string | null {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (!normalizedBase || !storageUrl.startsWith(normalizedBase)) {
    return null;
  }

  const key = storageUrl.slice(normalizedBase.length).replace(/^\/+/, "");
  return key || null;
}

/*
  getGalleryPhotos - 获取画廊照片列表（公开）
*/
export async function getGalleryPhotos(
  params: { cursorId?: number },
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{ photos: GalleryPhoto[]; nextCursor?: number } | null>
  >
>;
export async function getGalleryPhotos(
  params?: { cursorId?: number },
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ photos: GalleryPhoto[]; nextCursor?: number } | null>>;
export async function getGalleryPhotos(
  params: { cursorId?: number } = {},
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{ photos: GalleryPhoto[]; nextCursor?: number } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // Server Action 仍然需要速率限制
  if (!(await limitControl(await headers(), "getGalleryPhotos"))) {
    return response.tooManyRequests();
  }

  try {
    const data = await getGalleryPhotosData(params);
    return response.ok({ data });
  } catch (error) {
    console.error("GetGalleryPhotos error:", error);
    return response.serverError();
  }
}

/*
  getMediaList - 获取媒体文件列表
*/
export async function getMediaList(
  params: GetMediaList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaListItem[] | null>>>;
export async function getMediaList(
  params: GetMediaList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaListItem[] | null>>;
export async function getMediaList(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
    mediaType,
    userUid,
    sizeMin,
    sizeMax,
    inGallery,
    isOptimized,
    createdAtStart,
    createdAtEnd,
    hasReferences,
    folderId,
  }: GetMediaList,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMediaList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      mediaType,
      userUid,
      sizeMin,
      sizeMax,
      inGallery,
      isOptimized,
      createdAtStart,
      createdAtEnd,
      hasReferences,
      folderId,
    },
    GetMediaListSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const skip = (page - 1) * pageSize;

    // 构建查询条件 - 使用更具体的类型
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: Record<string, any>[] = [];

    // 权限控制逻辑：
    // - 公共空间（ROOT_PUBLIC 及其子文件夹）：所有用户可查看
    // - 私有空间（USER_HOME 及其子文件夹）：仅所有者和管理员可查看
    // - 根目录（folderId 为 null）：显示公共空间的文件
    let isPublicFolder = false;

    if (folderId !== undefined && folderId !== null) {
      // 检查当前文件夹是否属于公共空间
      const currentFolder = await prisma.virtualFolder.findUnique({
        where: { id: folderId },
        select: { path: true, systemType: true },
      });

      if (currentFolder) {
        // 获取 ROOT_PUBLIC 的 id
        const publicRoot = await prisma.virtualFolder.findFirst({
          where: { systemType: "ROOT_PUBLIC" },
          select: { id: true },
        });

        if (publicRoot) {
          // 如果当前文件夹是 ROOT_PUBLIC 或其子文件夹（path 包含 ROOT_PUBLIC 的 id）
          isPublicFolder =
            currentFolder.systemType === "ROOT_PUBLIC" ||
            currentFolder.path.includes(`/${publicRoot.id}/`);
        }
      }
    } else {
      // folderId 为 null 时，在根目录显示公共空间的文件，属于公共区域
      isPublicFolder = true;
    }

    // 权限控制：根据角色和搜索模式决定可见范围
    if (user.role === "AUTHOR") {
      if (folderId === null || folderId === undefined) {
        // 搜索模式（不传 folderId）：AUTHOR 只能看到公共空间的文件或自己的文件
        const publicRoot = await prisma.virtualFolder.findFirst({
          where: { systemType: "ROOT_PUBLIC" },
          select: { id: true },
        });

        const folderConditions: Prisma.MediaWhereInput[] = [
          { folderId: null }, // 无文件夹的文件（根目录）
          { userUid: user.uid }, // 自己上传的文件
        ];

        if (publicRoot) {
          folderConditions.push({
            folder: {
              OR: [
                { systemType: "ROOT_PUBLIC" },
                { path: { startsWith: `/${publicRoot.id}/` } },
              ],
            },
          });
        }

        conditions.push({ OR: folderConditions });
      } else if (!isPublicFolder) {
        // 在私有空间中，AUTHOR 只能看到自己的文件
        conditions.push({ userUid: user.uid });
      }
    } else if (userUid) {
      // EDITOR 和 ADMIN 可以筛选指定用户的文件
      conditions.push({ userUid });
    }

    // 搜索条件
    if (search && search.trim()) {
      const searchCondition = {
        OR: [
          {
            originalName: {
              contains: search.trim(),
              mode: "insensitive" as const,
            },
          },
          {
            fileName: {
              contains: search.trim(),
              mode: "insensitive" as const,
            },
          },
          {
            altText: {
              contains: search.trim(),
              mode: "insensitive" as const,
            },
          },
        ],
      };
      conditions.push(searchCondition);
    }

    // 文件类型筛选
    if (mediaType) {
      conditions.push({ mediaType });
    }

    // 文件大小范围
    if (sizeMin !== undefined || sizeMax !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sizeCondition: Record<string, any> = { size: {} };
      if (sizeMin !== undefined) {
        sizeCondition.size.gte = sizeMin;
      }
      if (sizeMax !== undefined) {
        sizeCondition.size.lte = sizeMax;
      }
      conditions.push(sizeCondition);
    }

    // 是否在图库中显示 (使用 galleryPhoto 关系判断)
    if (inGallery !== undefined) {
      if (inGallery) {
        conditions.push({ galleryPhoto: { isNot: null } });
      } else {
        conditions.push({ galleryPhoto: { is: null } });
      }
    }

    // 是否已优化
    if (isOptimized !== undefined) {
      conditions.push({ isOptimized });
    }

    // 时间范围筛选
    if (createdAtStart || createdAtEnd) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createdAtCondition: Record<string, any> = { createdAt: {} };
      if (createdAtStart) {
        createdAtCondition.createdAt.gte = new Date(createdAtStart);
      }
      if (createdAtEnd) {
        createdAtCondition.createdAt.lte = new Date(createdAtEnd);
      }
      conditions.push(createdAtCondition);
    }

    // 引用筛选
    if (hasReferences !== undefined) {
      if (hasReferences) {
        // 只显示有引用的
        conditions.push({
          references: {
            some: {},
          },
        });
      } else {
        // 只显示无引用的
        conditions.push({
          references: {
            none: {},
          },
        });
      }
    }

    // 文件夹筛选
    if (folderId !== undefined && folderId !== null) {
      conditions.push({ folderId });
    }

    if (conditions.length > 0) {
      where.AND = conditions;
    }

    // 获取媒体文件列表
    const media = await prisma.media.findMany({
      where,
      skip,
      take: pageSize,
      select: {
        id: true,
        fileName: true,
        originalName: true,
        mimeType: true,
        shortHash: true,
        mediaType: true,
        size: true,
        width: true,
        height: true,
        altText: true,
        blur: true,
        galleryPhoto: {
          select: {
            id: true,
          },
        },
        createdAt: true,
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            references: true,
          },
        },
      },
      orderBy:
        sortBy === "referencesCount"
          ? [{ references: { _count: sortOrder } }, { id: "desc" }]
          : [{ [sortBy]: sortOrder }, { id: "desc" }],
    });

    // 转换为响应格式
    const mediaList: MediaListItem[] = media.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      originalName: item.originalName,
      mimeType: item.mimeType,
      imageId: generateSignedImageId(item.shortHash), // 生成带签名的12位ID
      shortHash: item.shortHash,
      mediaType: item.mediaType,
      size: item.size,
      width: item.width,
      height: item.height,
      altText: item.altText,
      blur: item.blur,
      inGallery: item.galleryPhoto !== null, // 根据 galleryPhoto 是否存在判断
      createdAt: item.createdAt.toISOString(),
      postsCount: item._count.references, // 使用 references 计数
      folderId: item.folder?.id || null,
      folder: item.folder
        ? {
            id: item.folder.id,
            name: item.folder.name,
          }
        : null,
      user: item.user,
    }));

    // 获取总数
    const total = await prisma.media.count({ where });

    return response.ok({
      data: mediaList,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasNext: page < Math.ceil(total / pageSize),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("GetMediaList error:", error);
    return response.serverError();
  }
}

/*
  getMediaDetail - 获取媒体文件详情
*/
export async function getMediaDetail(
  params: GetMediaDetail,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaDetail | null>>>;
export async function getMediaDetail(
  params: GetMediaDetail,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaDetail | null>>;
export async function getMediaDetail(
  { access_token, id }: GetMediaDetail,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaDetail | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMediaDetail"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
    },
    GetMediaDetailSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const media = await prisma.media.findUnique({
      where: { id },
      include: {
        galleryPhoto: true, // 获取图库信息
        user: {
          select: {
            uid: true,
            username: true,
            nickname: true,
          },
        },
        StorageProvider: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
        folder: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
        references: {
          select: {
            slot: true,
            postId: true,
            post: {
              select: {
                id: true,
                title: true,
                slug: true,
                deletedAt: true,
              },
            },
            pageId: true,
            page: {
              select: {
                id: true,
                title: true,
                slug: true,
                deletedAt: true,
              },
            },
            tagSlug: true,
            tag: {
              select: {
                slug: true,
                name: true,
              },
            },
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    if (!media) {
      return response.notFound({ message: `媒体文件不存在` });
    }

    // AUTHOR 只能查看自己的文件
    if (user.role === "AUTHOR" && media.userUid !== user.uid) {
      return response.forbidden({ message: "无权限访问此文件" });
    }

    // 按类型分类引用信息
    const postsReferences = media.references
      .filter((ref) => ref.post && !ref.post.deletedAt)
      .map((ref) => ({
        id: ref.post!.id,
        title: ref.post!.title,
        slug: ref.post!.slug,
        slot: ref.slot,
      }));

    const pagesReferences = media.references
      .filter((ref) => ref.page && !ref.page.deletedAt)
      .map((ref) => ({
        id: ref.page!.id,
        title: ref.page!.title,
        slug: ref.page!.slug,
        slot: ref.slot,
      }));

    const tagsReferences = media.references
      .filter((ref) => ref.tag)
      .map((ref) => ({
        slug: ref.tag!.slug,
        name: ref.tag!.name,
        slot: ref.slot,
      }));

    const categoriesReferences = media.references
      .filter((ref) => ref.category)
      .map((ref) => ({
        id: ref.category!.id,
        name: ref.category!.name,
        slug: ref.category!.slug,
        slot: ref.slot,
      }));

    // 解析完整的文件夹路径节点
    let pathNodes: { id: number; name: string }[] | undefined = undefined;
    if (media.folder && media.folder.path) {
      const pathIds = media.folder.path
        .split("/")
        .filter((id) => id !== "")
        .map(Number);

      if (pathIds.length > 0) {
        const ancestors = await prisma.virtualFolder.findMany({
          where: {
            id: { in: pathIds },
          },
          select: {
            id: true,
            name: true,
            path: true,
          },
        });

        // 按路径深度排序，确保顺序正确
        ancestors.sort(
          (a, b) =>
            a.path.split("/").filter(Boolean).length -
            b.path.split("/").filter(Boolean).length,
        );

        pathNodes = ancestors.map((a) => ({
          id: a.id,
          name: a.name,
        }));
      }
    }

    const mediaDetail: MediaDetail = {
      id: media.id,
      fileName: media.fileName,
      originalName: media.originalName,
      mimeType: media.mimeType,
      size: media.size,
      shortHash: media.shortHash,
      imageId: generateSignedImageId(media.shortHash), // 生成带签名的12位ID
      hash: media.hash,
      mediaType: media.mediaType,
      width: media.width,
      height: media.height,
      altText: media.altText,
      blur: media.blur,
      thumbnails: media.thumbnails,
      exif: sanitizeExifForClient(media.exif, {
        keepRaw: true,
        keepGps: true,
      }),
      inGallery: media.galleryPhoto !== null,
      galleryPhoto: media.galleryPhoto
        ? {
            ...media.galleryPhoto,
            createdAt: media.galleryPhoto.createdAt.toISOString(),
            updatedAt: media.galleryPhoto.updatedAt.toISOString(),
            shotAt: media.galleryPhoto.shotAt?.toISOString() || null,
            sortTime: media.galleryPhoto.sortTime.toISOString(),
          }
        : null,
      isOptimized: media.isOptimized,
      storageUrl: media.storageUrl,
      persistentPath: media.persistentPath,
      createdAt: media.createdAt.toISOString(),
      storageProviderId: media.storageProviderId,
      folderId: media.folderId,
      folder: media.folder
        ? {
            id: media.folder.id,
            name: media.folder.name,
            path: media.folder.path,
            pathNodes,
          }
        : null,
      user: media.user
        ? {
            uid: media.user.uid,
            username: media.user.username,
            nickname: media.user.nickname,
          }
        : null,
      storageProvider: media.StorageProvider
        ? {
            id: media.StorageProvider.id,
            name: media.StorageProvider.name,
            displayName: media.StorageProvider.displayName,
          }
        : null,
      references: {
        posts: postsReferences,
        pages: pagesReferences,
        tags: tagsReferences,
        categories: categoriesReferences,
      },
    };

    return response.ok({
      data: mediaDetail,
    });
  } catch (error) {
    console.error("GetMediaDetail error:", error);
    return response.serverError();
  }
}

/*
  updateMedia - 更新媒体文件信息
*/
export async function updateMedia(
  params: UpdateMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      id: number;
      originalName: string;
      altText: string | null;
      persistentPath: string | null;
      inGallery: boolean;
      updatedAt: string;
    } | null>
  >
>;
export async function updateMedia(
  params: UpdateMedia,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    id: number;
    originalName: string;
    altText: string | null;
    persistentPath: string | null;
    inGallery: boolean;
    updatedAt: string;
  } | null>
>;
export async function updateMedia(
  {
    access_token,
    id,
    originalName,
    altText,
    persistentPath,
    inGallery,
    name,
    slug,
    description,
    gallerySize,
    showExif,
    hideGPS,
    overrideExif,
  }: UpdateMedia,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    id: number;
    originalName: string;
    altText: string | null;
    persistentPath: string | null;
    inGallery: boolean;
    updatedAt: string;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "updateMedia"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      id,
      originalName,
      altText,
      persistentPath,
      inGallery,
      name,
      slug,
      description,
      gallerySize,
      showExif,
      hideGPS,
      overrideExif,
    },
    UpdateMediaSchema,
  );

  if (validationError) return response.badRequest(validationError);

  const normalizedPersistentPath =
    typeof persistentPath === "string" ? persistentPath.trim() : persistentPath;

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 检查文件是否存在
    const existingMedia = await prisma.media.findUnique({
      where: { id },
      include: {
        galleryPhoto: true,
      },
    });

    if (!existingMedia) {
      return response.notFound({ message: `媒体文件不存在` });
    }

    // AUTHOR 只能编辑自己的文件
    if (user.role === "AUTHOR" && existingMedia.userUid !== user.uid) {
      return response.forbidden({ message: "无权限编辑此文件" });
    }

    // 更新媒体文件信息
    const updateData: Record<string, unknown> = {
      ...(originalName !== undefined ? { originalName } : {}),
      ...(altText !== undefined ? { altText } : {}),
      ...(normalizedPersistentPath !== undefined
        ? { persistentPath: normalizedPersistentPath }
        : {}),
    };

    // 1. 如果用户指定了 slug，检查唯一性
    if (slug) {
      const collision = await prisma.photo.findUnique({
        where: { slug },
        select: { mediaId: true },
      });
      if (collision && collision.mediaId !== id) {
        return response.badRequest({
          message: "Slug 已被占用，请更换一个",
          error: { code: "SLUG_EXISTS", message: "Slug 已被占用" },
        });
      }
    }

    // 处理图库信息
    if (inGallery !== undefined) {
      if (inGallery) {
        // 如果开启图库显示，upsert GalleryPhoto

        // 提取拍摄时间
        const extractedShotAt = extractShotAtFromMedia(existingMedia.exif);

        // 计算 Photo Name (去除后缀)
        let photoName = name;
        if (!photoName) {
          const sourceName = originalName || existingMedia.originalName;
          const lastDotIndex = sourceName.lastIndexOf(".");
          photoName =
            lastDotIndex > 0
              ? sourceName.substring(0, lastDotIndex)
              : sourceName;
        }
        photoName = photoName || "Untitled";

        // 计算 Photo Slug
        let photoSlug = slug;
        if (!photoSlug) {
          const baseSlug = (await slugify(photoName)) || "photo";
          if (!existingMedia.galleryPhoto) {
            // 新增且未指定 slug，检查冲突
            const collision = await prisma.photo.findUnique({
              where: { slug: baseSlug },
              select: { id: true },
            });
            photoSlug = collision ? `${baseSlug}-${id}` : baseSlug;
          } else {
            // 更新且未指定 slug，upsert.create 需要一个值（虽然不会被使用）
            photoSlug = baseSlug;
          }
        }

        updateData.galleryPhoto = {
          upsert: {
            create: {
              slug: photoSlug,
              name: photoName,
              description: description || null,
              size: (gallerySize as GallerySize) || "AUTO",
              showExif: showExif ?? true,
              hideGPS: hideGPS ?? true,
              overrideExif: overrideExif ?? undefined,
              shotAt: extractedShotAt,
              sortTime: extractedShotAt || new Date(),
            },
            update: {
              // 只有提供了相应字段时才更新
              ...(slug ? { slug } : {}),
              ...(name ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
              ...(gallerySize ? { size: gallerySize as GallerySize } : {}),
              ...(showExif !== undefined ? { showExif } : {}),
              ...(hideGPS !== undefined ? { hideGPS } : {}),
              ...(overrideExif !== undefined ? { overrideExif } : {}),
              // 如果是从非图库状态转为图库状态，或者显式提供了拍摄时间相关信息（目前还没开放显式设置 shotAt）
              // 自动更新一次时间
              ...(!existingMedia.galleryPhoto
                ? {
                    shotAt: extractedShotAt,
                    sortTime: extractedShotAt || new Date(),
                  }
                : {}),
            },
          },
        };
      } else {
        // 如果关闭图库显示，删除 GalleryPhoto
        updateData.galleryPhoto = {
          delete: existingMedia.galleryPhoto ? true : undefined,
        };
        // 如果没有关联照片，delete: true 会报错吗？prisma delete: true for optional one-to-one expects relation to exist?
        // 文档说: If the record does not exist, the operation will fail.
        // 所以我们只在 existingMedia.galleryPhoto 存在时才添加 delete 指令
        if (!existingMedia.galleryPhoto) {
          delete updateData.galleryPhoto;
        }
      }
    } else if (existingMedia.galleryPhoto) {
      // 如果 inGallery 未定义，但存在图库照片，且有图库相关字段更新
      if (
        name ||
        slug ||
        description !== undefined ||
        gallerySize ||
        showExif !== undefined ||
        hideGPS !== undefined ||
        overrideExif !== undefined
      ) {
        updateData.galleryPhoto = {
          update: {
            ...(slug ? { slug } : {}),
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(gallerySize ? { size: gallerySize as GallerySize } : {}),
            ...(showExif !== undefined ? { showExif } : {}),
            ...(hideGPS !== undefined ? { hideGPS } : {}),
            ...(overrideExif !== undefined ? { overrideExif } : {}),
          },
        };
      }
    }

    const updatedMedia = await prisma.media.update({
      where: { id },
      data: updateData,
      include: {
        galleryPhoto: true,
      },
    });
    const referencedContentCacheTargets =
      await collectReferencedContentCacheTargets([id]);

    // 记录审计日志
    const auditOldValue: Record<string, string | boolean | null | object> = {};
    const auditNewValue: Record<string, string | boolean | null | object> = {};

    if (
      originalName !== undefined &&
      originalName !== existingMedia.originalName
    ) {
      auditOldValue.originalName = existingMedia.originalName;
      auditNewValue.originalName = originalName;
    }
    if (altText !== undefined && altText !== existingMedia.altText) {
      auditOldValue.altText = existingMedia.altText;
      auditNewValue.altText = altText;
    }
    if (
      normalizedPersistentPath !== undefined &&
      normalizedPersistentPath !== existingMedia.persistentPath
    ) {
      auditOldValue.persistentPath = existingMedia.persistentPath;
      auditNewValue.persistentPath = normalizedPersistentPath;
    }
    if (inGallery !== undefined) {
      auditOldValue.inGallery = !!existingMedia.galleryPhoto;
      auditNewValue.inGallery = inGallery;
    }

    // 记录图库相关变更
    if (updateData.galleryPhoto) {
      auditNewValue.galleryPhotoChange = true;
    }
    if (inGallery !== undefined || updateData.galleryPhoto) {
      updateTag("gallery/list");
    }
    invalidateReferencedContentCaches(referencedContentCacheTargets);

    const oldSlug = existingMedia.galleryPhoto?.slug;
    const newSlug = updatedMedia.galleryPhoto?.slug;

    if (Object.keys(auditNewValue).length > 0) {
      const { after } = await import("next/server");
      after(async () => {
        // 更新特定照片的缓存
        if (oldSlug) updateTag(`photos/${oldSlug}`);
        if (newSlug && newSlug !== oldSlug) updateTag(`photos/${newSlug}`);

        await logAuditEvent({
          user: {
            uid: String(user.uid),
          },
          details: {
            action: "UPDATE_MEDIA",
            resourceType: "Media",
            resourceId: String(id),
            value: {
              old: auditOldValue,
              new: auditNewValue,
            },
            description: "更新媒体文件信息",
          },
        });
      });
    }

    return response.ok({
      data: {
        id: updatedMedia.id,
        originalName: updatedMedia.originalName,
        altText: updatedMedia.altText,
        persistentPath: updatedMedia.persistentPath,
        inGallery: !!updatedMedia.galleryPhoto,
        updatedAt: new Date().toISOString(), // 使用当前时间作为更新时间
      },
      message: "媒体文件信息更新成功",
    });
  } catch (error) {
    console.error("UpdateMedia error:", error);
    return response.serverError();
  }
}

/*
  batchUpdateMedia - 批量更新媒体文件
*/
export async function batchUpdateMedia(
  params: BatchUpdateMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ updated: number; ids: number[] } | null>>
>;
export async function batchUpdateMedia(
  params: BatchUpdateMedia,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ updated: number; ids: number[] } | null>>;
export async function batchUpdateMedia(
  { access_token, ids, inGallery, isOptimized }: BatchUpdateMedia,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ updated: number; ids: number[] } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "batchUpdateMedia"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
      inGallery,
      isOptimized,
    },
    BatchUpdateMediaSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取要更新的文件信息用于权限检查
    const mediaToUpdate = await prisma.media.findMany({
      where: {
        id: { in: ids },
      },
      select: {
        id: true,
        userUid: true,
        originalName: true,
        exif: true,
        galleryPhoto: {
          select: {
            id: true,
            slug: true,
          },
        },
      },
    });

    if (mediaToUpdate.length === 0) {
      return response.notFound({ message: "没有找到可更新的媒体文件" });
    }

    // 权限检查：AUTHOR 只能更新自己的文件
    let updatableMedia = mediaToUpdate;
    if (user.role === "AUTHOR") {
      updatableMedia = mediaToUpdate.filter(
        (media) => media.userUid === user.uid,
      );

      if (updatableMedia.length === 0) {
        return response.forbidden({ message: "没有权限更新这些文件" });
      }
    }

    const updatableIds = updatableMedia.map((m) => m.id);

    // 执行更新
    await prisma.$transaction(async (tx) => {
      // 1. 更新普通字段 (isOptimized)
      if (isOptimized !== undefined) {
        await tx.media.updateMany({
          where: {
            id: { in: updatableIds },
          },
          data: {
            isOptimized,
          },
        });
      }

      // 2. 处理 inGallery
      if (inGallery !== undefined) {
        if (inGallery) {
          // 批量添加到图库
          // 找出还没有 galleryPhoto 的 media
          const mediaWithoutGallery = updatableMedia.filter(
            (m) => !m.galleryPhoto,
          );

          if (mediaWithoutGallery.length > 0) {
            // 准备数据候选集（异步处理 slug 生成）
            const candidates = await Promise.all(
              mediaWithoutGallery.map(async (media) => {
                // 去除后缀名
                const lastDotIndex = media.originalName.lastIndexOf(".");
                const nameWithoutExt =
                  lastDotIndex > 0 // 确保不是隐藏文件（如 .gitignore）且有后缀
                    ? media.originalName.substring(0, lastDotIndex)
                    : media.originalName;

                const cleanName = nameWithoutExt || "Untitled";
                const baseSlug = (await slugify(cleanName)) || "photo";

                return {
                  media,
                  name: cleanName,
                  baseSlug,
                };
              }),
            );

            // 检查数据库中已存在的 slug
            const baseSlugs = candidates.map((c) => c.baseSlug);
            const existingPhotos = await tx.photo.findMany({
              where: {
                slug: { in: baseSlugs },
              },
              select: { slug: true },
            });
            const existingSlugSet = new Set(existingPhotos.map((p) => p.slug));
            const usedSlugsInBatch = new Set<string>();

            await tx.photo.createMany({
              data: candidates.map((c) => {
                let slug = c.baseSlug;
                // 如果 slug 已存在于数据库或当前批次中，追加 ID
                if (existingSlugSet.has(slug) || usedSlugsInBatch.has(slug)) {
                  slug = `${slug}-${c.media.id}`;
                }
                usedSlugsInBatch.add(slug);

                // 提取拍摄时间
                const extractedShotAt = extractShotAtFromMedia(c.media.exif);

                return {
                  mediaId: c.media.id,
                  slug,
                  name: c.name,
                  size: "AUTO",
                  showExif: true,
                  hideGPS: true,
                  shotAt: extractedShotAt,
                  sortTime: extractedShotAt || new Date(),
                };
              }),
            });
          }
        } else {
          // 批量从图库移除
          await tx.photo.deleteMany({
            where: {
              mediaId: { in: updatableIds },
            },
          });
        }
      }
    });

    // 记录审计日志
    const { after } = await import("next/server");
    const referencedContentCacheTargets =
      await collectReferencedContentCacheTargets(updatableIds);
    if (inGallery !== undefined) {
      updateTag("gallery/list");
    }
    invalidateReferencedContentCaches(referencedContentCacheTargets);
    after(async () => {
      // 如果是从图库移除，需要更新对应照片页面的缓存
      if (inGallery === false) {
        updatableMedia.forEach((media) => {
          if (media.galleryPhoto?.slug) {
            updateTag(`photos/${media.galleryPhoto.slug}`);
          }
        });
      }

      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "BATCH_UPDATE_MEDIA",
          resourceType: "Media",
          resourceId: updatableIds.join(", "),
          value: {
            old: null,
            new: {
              count: updatableIds.length,
              inGallery,
              isOptimized,
            },
          },
          description: `批量更新 ${updatableIds.length} 个媒体文件`,
        },
      });
    });

    return response.ok({
      data: {
        updated: updatableIds.length,
        ids: updatableIds,
      },
      message: `成功更新 ${updatableIds.length} 个媒体文件`,
    });
  } catch (error) {
    console.error("BatchUpdateMedia error:", error);
    return response.serverError();
  }
}

/*
  deleteMedia - 批量删除媒体文件
*/
export async function deleteMedia(
  params: DeleteMedia,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<{ deleted: number; ids: number[] } | null>>
>;
export async function deleteMedia(
  params: DeleteMedia,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ deleted: number; ids: number[] } | null>>;
export async function deleteMedia(
  { access_token, ids }: DeleteMedia,
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ deleted: number; ids: number[] } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteMedia"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      ids,
    },
    DeleteMediaSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 获取要删除的文件信息用于权限检查和审计日志
    const mediaToDelete = await prisma.media.findMany({
      where: {
        id: { in: ids },
      },
      select: {
        id: true,
        originalName: true,
        userUid: true,
        storageUrl: true,
        StorageProvider: {
          select: {
            name: true,
            type: true,
            baseUrl: true,
            pathTemplate: true,
            config: true,
          },
        },
        galleryPhoto: {
          select: { id: true, slug: true },
        },
      },
    });

    if (mediaToDelete.length === 0) {
      return response.notFound({ message: "没有找到可删除的媒体文件" });
    }

    // 权限检查：AUTHOR 只能删除自己的文件
    let deletableIds: number[] = [];
    let hasPhotosInBatch = false;
    if (user.role === "AUTHOR") {
      const deletableMedia = mediaToDelete.filter(
        (media) => media.userUid === user.uid,
      );
      deletableIds = deletableMedia.map((media) => media.id);
      hasPhotosInBatch = deletableMedia.some((m) => !!m.galleryPhoto);

      if (deletableIds.length === 0) {
        return response.forbidden({ message: "没有权限删除这些文件" });
      }
    } else {
      deletableIds = ids;
      hasPhotosInBatch = mediaToDelete.some((m) => !!m.galleryPhoto);
    }

    // 删除存储后端对象（虚拟存储 EXTERNAL_URL 跳过）
    const deletableMedia = mediaToDelete.filter((media) =>
      deletableIds.includes(media.id),
    );
    const referencedContentCacheTargets =
      await collectReferencedContentCacheTargets(deletableIds);
    await Promise.all(
      deletableMedia.map(async (media) => {
        const provider = media.StorageProvider;
        if (!provider || isVirtualStorage(provider.name)) {
          return;
        }

        const objectKey = extractObjectKeyFromStorageUrl(
          media.storageUrl,
          provider.baseUrl,
        );
        if (!objectKey) {
          return;
        }

        try {
          switch (provider.type) {
            case "LOCAL":
              await deleteObject({
                type: "LOCAL",
                baseUrl: provider.baseUrl,
                pathTemplate: provider.pathTemplate,
                config: provider.config as {
                  rootDir: string;
                  createDirIfNotExists?: boolean;
                  fileMode?: string | number;
                  dirMode?: string | number;
                },
                key: objectKey,
              });
              break;
            case "AWS_S3":
              await deleteObject({
                type: "AWS_S3",
                baseUrl: provider.baseUrl,
                pathTemplate: provider.pathTemplate,
                config: provider.config as {
                  accessKeyId: string;
                  secretAccessKey: string;
                  region: string;
                  bucket: string;
                  endpoint?: string;
                  basePath?: string;
                  forcePathStyle?: boolean | string;
                  acl?: string;
                },
                key: objectKey,
              });
              break;
            case "VERCEL_BLOB":
              await deleteObject({
                type: "VERCEL_BLOB",
                baseUrl: provider.baseUrl,
                pathTemplate: provider.pathTemplate,
                config: provider.config as {
                  token: string;
                  basePath?: string;
                  access?: "public" | "private";
                  cacheControl?: string;
                },
                key: objectKey,
              });
              break;
            case "GITHUB_PAGES":
              await deleteObject({
                type: "GITHUB_PAGES",
                baseUrl: provider.baseUrl,
                pathTemplate: provider.pathTemplate,
                config: provider.config as {
                  owner: string;
                  repo: string;
                  branch: string;
                  token: string;
                  basePath?: string;
                  committerName?: string;
                  committerEmail?: string;
                  apiBaseUrl?: string;
                  commitMessageTemplate?: string;
                },
                key: objectKey,
              });
              break;
            case "EXTERNAL_URL":
              break;
          }
        } catch (error) {
          console.error("Delete media object from storage failed:", {
            mediaId: media.id,
            storageUrl: media.storageUrl,
            error,
          });
        }
      }),
    );

    // 删除媒体文件（Prisma 会自动处理关系）
    const result = await prisma.media.deleteMany({
      where: {
        id: {
          in: deletableIds,
        },
      },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    if (hasPhotosInBatch) {
      updateTag("gallery/list");
    }
    invalidateReferencedContentCaches(referencedContentCacheTargets);
    after(async () => {
      // 刷新被删除照片的页面缓存
      mediaToDelete.forEach((media) => {
        if (deletableIds.includes(media.id) && media.galleryPhoto?.slug) {
          updateTag(`photos/${media.galleryPhoto.slug}`);
        }
      });

      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "DELETE_MEDIA",
          resourceType: "Media",
          resourceId: deletableIds.join(", "),
          value: {
            old: {
              ids: deletableIds,
              files: mediaToDelete
                .filter((m) => deletableIds.includes(m.id))
                .map((m) => m.originalName),
            },
            new: null,
          },
          description: "删除媒体文件",
        },
      });
    });

    return response.ok({
      data: {
        deleted: result.count,
        ids: deletableIds,
      },
      message: `成功删除 ${result.count} 个媒体文件`,
    });
  } catch (error) {
    console.error("DeleteMedia error:", error);
    return response.serverError();
  }
}

/*
  getMediaStats - 获取媒体文件统计信息
*/
export async function getMediaStats(
  params: GetMediaStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaStats | null>>>;
export async function getMediaStats(
  params: GetMediaStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaStats | null>>;
export async function getMediaStats(
  { access_token, days = 30, force = false }: GetMediaStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaStats | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMediaStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      force,
    },
    GetMediaStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "media", String(days));
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<MediaStats>(CACHE_KEY, {
        ttl: CACHE_TTL,
      });

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 获取总体统计
    const [totalStats, typeStats] = await Promise.all([
      // 总文件数和总大小
      prisma.media.aggregate({
        _count: { id: true },
        _sum: { size: true },
      }),
      // 按类型统计
      prisma.media.groupBy({
        by: ["mediaType"],
        _count: { id: true },
        _sum: { size: true },
      }),
    ]);

    // 获取每日统计
    const dailyStats = (await prisma.$queryRaw`
      SELECT
        DATE("createdAt") as date,
        COUNT(*) as total_files,
        COUNT(*) FILTER (WHERE "createdAt" >= ${startDate}) as new_files,
        COALESCE(SUM("size"), 0) as total_size
      FROM "Media"
      WHERE "createdAt" >= ${startDate}
      GROUP BY DATE("createdAt")
      ORDER BY date DESC
    `) as Array<{
      date: string;
      total_files: number;
      new_files: number;
      total_size: number;
    }>;

    // 构建类型分布（确保数字类型）
    const typeDistribution = typeStats.map((stat) => ({
      type: stat.mediaType as "IMAGE" | "VIDEO" | "AUDIO" | "FILE",
      count: Number(stat._count.id),
      size: Number(stat._sum.size || 0),
    }));

    // 构建每日统计（确保按日期顺序，确保数字类型）
    const formattedDailyStats = dailyStats.reverse().map((stat) => ({
      date: stat.date,
      totalFiles: Number(stat.total_files),
      newFiles: Number(stat.new_files),
      totalSize: Number(stat.total_size),
    }));

    const mediaStats: MediaStats = {
      updatedAt: now.toISOString(),
      cache: false,
      totalFiles: Number(totalStats._count.id),
      totalSize: Number(totalStats._sum.size || 0),
      typeDistribution,
      dailyStats: formattedDailyStats,
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...mediaStats, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data: mediaStats,
    });
  } catch (error) {
    console.error("GetMediaStats error:", error);
    return response.serverError();
  }
}

/*
  getMediaTrends - 获取媒体文件趋势数据
*/
export async function getMediaTrends(
  params: GetMediaTrends,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaTrendItem[] | null>>>;
export async function getMediaTrends(
  params: GetMediaTrends,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaTrendItem[] | null>>;
export async function getMediaTrends(
  { access_token, days = 30, count = 30 }: GetMediaTrends,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaTrendItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMediaTrends"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      days,
      count,
    },
    GetMediaTrendsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // 获取每日新增文件统计
    const dailyTrends = (await prisma.$queryRaw`
      WITH daily_counts AS (
        SELECT
          DATE("createdAt") as date,
          COUNT(*) as new_files
        FROM "Media"
        WHERE "createdAt" >= ${startDate}
        GROUP BY DATE("createdAt")
      ),
      cumulative_counts AS (
        SELECT
          date,
          new_files,
          SUM(new_files) OVER (ORDER BY date ASC) as total_files
        FROM daily_counts
        ORDER BY date ASC
        LIMIT ${count}
      )
      SELECT
        date as time,
        new_files,
        total_files
      FROM cumulative_counts
      ORDER BY time ASC
    `) as Array<{
      time: string;
      new_files: number;
      total_files: number;
    }>;

    // 转换为响应格式（确保数字类型和完整 ISO 时间字符串）
    const trends: MediaTrendItem[] = dailyTrends.map((trend) => {
      const date = new Date(trend.time);
      // 返回完整 ISO 8601 时间戳（标准化格式）
      return {
        time: date.toISOString(),
        data: {
          total: Number(trend.total_files),
          new: Number(trend.new_files),
        },
      };
    });

    return response.ok({
      data: trends,
    });
  } catch (error) {
    console.error("GetMediaTrends error:", error);
    return response.serverError();
  }
}

function normalizeFoldersForMediaExplorer(
  folders: FolderItem[],
  currentFolderId: number | null,
  currentUserUid: number,
): FolderItem[] {
  let processedFolders = [...folders];

  // 根目录：隐藏 ROOT_PUBLIC（其文件会在媒体列表中显示）
  if (currentFolderId === null) {
    processedFolders = processedFolders
      .filter((folder) => folder.systemType !== "ROOT_PUBLIC")
      .map((folder) => {
        if (
          folder.systemType === "USER_HOME" &&
          folder.userUid === currentUserUid
        ) {
          return { ...folder, name: "我的文件夹" };
        }
        return folder;
      });

    // 根目录保底展示“我的文件夹”入口（虚拟）
    const hasUserHome = processedFolders.some(
      (folder) =>
        folder.systemType === "USER_HOME" && folder.userUid === currentUserUid,
    );

    if (!hasUserHome) {
      processedFolders.unshift({
        id: -1,
        name: "我的文件夹",
        systemType: "USER_HOME",
        userUid: currentUserUid,
        parentId: null,
        path: "",
        depth: 0,
        order: -1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        fileCount: 0,
      });
    }

    processedFolders.sort((a, b) => {
      const aIsMyHome =
        a.systemType === "USER_HOME" && a.userUid === currentUserUid;
      const bIsMyHome =
        b.systemType === "USER_HOME" && b.userUid === currentUserUid;
      if (aIsMyHome && !bIsMyHome) return -1;
      if (bIsMyHome && !aIsMyHome) return 1;

      if (
        a.systemType === "ROOT_USERS" &&
        b.systemType !== "ROOT_USERS" &&
        !bIsMyHome
      ) {
        return -1;
      }
      if (
        b.systemType === "ROOT_USERS" &&
        a.systemType !== "ROOT_USERS" &&
        !aIsMyHome
      ) {
        return 1;
      }

      return a.order - b.order;
    });

    return processedFolders;
  }

  processedFolders.sort((a, b) => a.order - b.order);
  return processedFolders;
}

// ============================================================================
// 文件夹相关 Server Actions
// ============================================================================

/**
 * 批量查询文件夹的文件计数（包括子孙文件夹中的文件）
 * 使用物化路径实现高效查询
 */
async function batchGetFolderFileCounts(
  folderIds: number[],
): Promise<Map<number, number>> {
  if (folderIds.length === 0) return new Map();

  // path 格式：包含自己的 ID，格式如 "2/3/4"（与 Comment 一致）
  // 查找子孙节点：df.path LIKE fi.path || '/%'
  const counts = (await prisma.$queryRaw`
    WITH folder_descendants AS (
      SELECT fi.id as root_id, df.id as descendant_id
      FROM "VirtualFolder" fi
      JOIN "VirtualFolder" df ON (
        df."path" LIKE fi."path" || '/' || '%'
        OR df.id = fi.id
      )
      WHERE fi.id = ANY(${folderIds}::int[])
    )
    SELECT fd.root_id as "folderId", COUNT(m.id)::int as "fileCount"
    FROM folder_descendants fd
    LEFT JOIN "Media" m ON m."folderId" = fd.descendant_id
    GROUP BY fd.root_id
  `) as Array<{ folderId: number; fileCount: number }>;

  const map = new Map<number, number>();
  for (const row of counts) {
    map.set(row.folderId, row.fileCount);
  }
  return map;
}

/*
  getAccessibleFolders - 获取用户可访问的文件夹列表
*/
export async function getAccessibleFolders(
  params: GetAccessibleFoldersParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem[] | null>>>;
export async function getAccessibleFolders(
  params: GetAccessibleFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem[] | null>>;
export async function getAccessibleFolders(
  {
    access_token,
    userRole: _userRole,
    userUid: _userUid,
    parentId,
  }: GetAccessibleFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getAccessibleFolders"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const isPrivilegedUser = user.role === "ADMIN" || user.role === "EDITOR";

    // 构建查询条件
    const where: Record<string, unknown> = {};

    // 如果指定了 parentId，获取该文件夹下的子文件夹
    if (parentId !== undefined && parentId !== null) {
      if (!isPrivilegedUser) {
        const parentFolder = await prisma.virtualFolder.findUnique({
          where: { id: parentId },
          select: { id: true, path: true },
        });

        if (!parentFolder) {
          return response.notFound({ message: "父文件夹不存在" });
        }

        const pathIds = parentFolder.path
          .split("/")
          .filter(Boolean)
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id));

        const ancestors = pathIds.length
          ? await prisma.virtualFolder.findMany({
              where: { id: { in: pathIds } },
              select: { systemType: true, userUid: true },
            })
          : [];

        const hasPublicAccess = ancestors.some(
          (folder) => folder.systemType === "ROOT_PUBLIC",
        );
        const hasOwnHomeAccess = ancestors.some(
          (folder) =>
            folder.systemType === "USER_HOME" && folder.userUid === user.uid,
        );
        const hasOtherUserHome = ancestors.some(
          (folder) =>
            folder.systemType === "USER_HOME" &&
            folder.userUid !== null &&
            folder.userUid !== user.uid,
        );

        if ((!hasPublicAccess && !hasOwnHomeAccess) || hasOtherUserHome) {
          return response.forbidden({ message: "无权访问该文件夹" });
        }
      }

      where.parentId = parentId;

      const folders = await prisma.virtualFolder.findMany({
        where,
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          systemType: true,
          userUid: true,
          parentId: true,
          path: true,
          depth: true,
          order: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 批量获取文件计数
      const folderIds = folders.map((f) => f.id);
      const fileCountMap = await batchGetFolderFileCounts(folderIds);

      // 转换为响应格式
      const folderList: FolderItem[] = folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        systemType: folder.systemType as
          | "NORMAL"
          | "ROOT_PUBLIC"
          | "ROOT_USERS"
          | "USER_HOME",
        userUid: folder.userUid,
        parentId: folder.parentId,
        path: folder.path,
        depth: folder.depth,
        order: folder.order,
        createdAt: folder.createdAt.toISOString(),
        updatedAt: folder.updatedAt.toISOString(),
        fileCount: fileCountMap.get(folder.id) ?? 0,
      }));

      return response.ok({
        data: folderList,
      });
    }

    // 根目录的特殊处理：
    // 1. 显示"我的文件夹"（USER_HOME）
    // 2. 显示"用户目录"（ROOT_USERS）- 仅管理员/编辑
    // 3. 显示"公共空间"（ROOT_PUBLIC）
    // 4. 显示公共空间的直接子文件夹（用于 MediaGridView 展开显示）

    // 先查找 ROOT_PUBLIC 的 id
    const publicRoot = await prisma.virtualFolder.findFirst({
      where: { systemType: "ROOT_PUBLIC" },
      select: { id: true },
    });

    const publicRootId = publicRoot?.id || null;

    // 构建根目录的查询条件
    const conditions: Array<Record<string, unknown>> = [];

    // 1. 用户的 USER_HOME
    conditions.push({
      systemType: "USER_HOME",
      userUid: user.uid,
    });

    // 2. ROOT_USERS - 仅管理员/编辑可见
    if (isPrivilegedUser) {
      conditions.push({
        systemType: "ROOT_USERS",
      });
    }

    // 3. 公共空间本身（ROOT_PUBLIC）
    conditions.push({
      systemType: "ROOT_PUBLIC",
    });

    // 4. 公共空间的直接子文件夹
    if (publicRootId) {
      conditions.push({
        parentId: publicRootId,
      });
    }

    where.OR = conditions;

    const folders = await prisma.virtualFolder.findMany({
      where,
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        systemType: true,
        userUid: true,
        parentId: true,
        path: true,
        depth: true,
        order: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // 批量获取文件计数
    const rootFolderIds = folders.map((f) => f.id);
    const rootFileCountMap = await batchGetFolderFileCounts(rootFolderIds);

    // 转换为响应格式
    const folderList: FolderItem[] = folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      systemType: folder.systemType as
        | "NORMAL"
        | "ROOT_PUBLIC"
        | "ROOT_USERS"
        | "USER_HOME",
      userUid: folder.userUid,
      parentId: folder.parentId,
      path: folder.path,
      depth: folder.depth,
      order: folder.order,
      createdAt: folder.createdAt.toISOString(),
      updatedAt: folder.updatedAt.toISOString(),
      fileCount: rootFileCountMap.get(folder.id) ?? 0,
    }));

    // 返回结果，在 meta 中包含 publicRootId
    return response.ok({
      data: folderList,
      meta: {
        publicRootId,
      } as unknown as PaginationMeta,
    });
  } catch (error) {
    console.error("GetAccessibleFolders error:", error);
    return response.serverError();
  }
}

/*
  getFolderBreadcrumb - 获取文件夹的面包屑导航
*/
export async function getFolderBreadcrumb(
  params: GetFolderBreadcrumbParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<BreadcrumbItem[] | null>>>;
export async function getFolderBreadcrumb(
  params: GetFolderBreadcrumbParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<BreadcrumbItem[] | null>>;
export async function getFolderBreadcrumb(
  { access_token, folderId }: GetFolderBreadcrumbParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<BreadcrumbItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getFolderBreadcrumb"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 如果没有指定文件夹，返回根节点
    if (!folderId) {
      return response.ok({
        data: [{ id: null, name: "全部" }],
      });
    }

    // 查找当前文件夹
    const folder = await prisma.virtualFolder.findUnique({
      where: { id: folderId },
      select: {
        id: true,
        name: true,
        systemType: true,
        userUid: true,
        path: true,
        parentId: true,
      },
    });

    if (!folder) {
      return response.notFound({ message: "文件夹不存在" });
    }

    let ancestors: Array<{
      id: number;
      name: string;
      systemType: string;
      userUid: number | null;
    }> = [];

    if (user.role === "AUTHOR") {
      const reversedAncestors: typeof ancestors = [];
      const visitedIds = new Set([folder.id]);
      let parentId = folder.parentId ?? null;

      while (parentId !== null) {
        if (visitedIds.size >= 128 || visitedIds.has(parentId)) {
          return response.notFound({ message: "文件夹不存在" });
        }
        visitedIds.add(parentId);

        const parent = await prisma.virtualFolder.findUnique({
          where: { id: parentId },
          select: {
            id: true,
            name: true,
            systemType: true,
            userUid: true,
            parentId: true,
          },
        });
        if (!parent) {
          return response.notFound({ message: "文件夹不存在" });
        }

        reversedAncestors.push(parent);
        parentId = parent.parentId;
      }

      ancestors = reversedAncestors.reverse();
    } else {
      // 管理员和编辑可访问任意文件夹，沿存储路径构造面包屑。
      const pathIds = folder.path
        ? folder.path
            .split("/")
            .filter((id) => id !== "")
            .map(Number)
            .slice(0, -1)
        : [];

      ancestors = pathIds.length
        ? await prisma.virtualFolder.findMany({
            where: {
              id: { in: pathIds },
            },
            orderBy: { depth: "asc" },
            select: {
              id: true,
              name: true,
              systemType: true,
              userUid: true,
            },
          })
        : [];
    }

    if (user.role === "AUTHOR") {
      const accessChain = [...ancestors, folder];
      const hasPublicAccess = accessChain.some(
        (item) => item.systemType === "ROOT_PUBLIC",
      );
      const hasOwnHomeAccess = accessChain.some(
        (item) => item.systemType === "USER_HOME" && item.userUid === user.uid,
      );
      const hasOtherUserHome = accessChain.some(
        (item) => item.systemType === "USER_HOME" && item.userUid !== user.uid,
      );

      if ((!hasPublicAccess && !hasOwnHomeAccess) || hasOtherUserHome) {
        return response.notFound({ message: "文件夹不存在" });
      }
    }

    // 构建面包屑（包括当前文件夹本身）
    const breadcrumb: BreadcrumbItem[] = [
      { id: null, name: "全部" },
      ...ancestors.map((item) => ({
        id: item.id,
        name: item.name,
        systemType: item.systemType,
        userUid: item.userUid,
      })),
      // 添加当前文件夹
      {
        id: folder.id,
        name: folder.name,
        systemType: folder.systemType,
        userUid: folder.userUid,
      },
    ];

    return response.ok({
      data: breadcrumb,
    });
  } catch (error) {
    console.error("GetFolderBreadcrumb error:", error);
    return response.serverError();
  }
}

/*
  getMediaExplorerPage - 聚合获取媒体页数据（文件夹 + 面包屑 + 媒体列表）
*/
export async function getMediaExplorerPage(
  params: GetMediaExplorerPageParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MediaExplorerPageData | null>>>;
export async function getMediaExplorerPage(
  params: GetMediaExplorerPageParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MediaExplorerPageData | null>>;
export async function getMediaExplorerPage(
  {
    access_token,
    page = 1,
    pageSize = 25,
    sortBy = "createdAt",
    sortOrder = "desc",
    search,
    mediaType,
    userUid,
    sizeMin,
    sizeMax,
    inGallery,
    isOptimized,
    createdAtStart,
    createdAtEnd,
    hasReferences,
    currentFolderId = null,
  }: GetMediaExplorerPageParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MediaExplorerPageData | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getMediaExplorerPage"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      sortBy,
      sortOrder,
      search,
      mediaType,
      userUid,
      sizeMin,
      sizeMax,
      inGallery,
      isOptimized,
      createdAtStart,
      createdAtEnd,
      hasReferences,
      folderId: currentFolderId,
    },
    GetMediaListSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const foldersResult = await getAccessibleFolders({
      access_token: access_token || "",
      userRole: user.role,
      userUid: user.uid,
      parentId: currentFolderId,
    });

    if (!foldersResult.success) {
      return response.serverError({
        message: foldersResult.message || "获取文件夹信息失败",
      });
    }

    const rawFolders = foldersResult.data || [];
    const publicRootId =
      currentFolderId === null
        ? ((foldersResult.meta as { publicRootId?: number } | undefined)
            ?.publicRootId ?? null)
        : null;

    const folders = normalizeFoldersForMediaExplorer(
      rawFolders,
      currentFolderId,
      user.uid,
    );

    const shouldSearchGlobal = Boolean(search?.trim());
    const mediaFolderId =
      currentFolderId === null ? publicRootId : currentFolderId;
    const effectiveFolderId = shouldSearchGlobal ? undefined : mediaFolderId;

    if (
      !shouldSearchGlobal &&
      currentFolderId === null &&
      mediaFolderId === null
    ) {
      return response.ok({
        data: {
          media: [],
          folders,
          breadcrumb: [{ id: null, name: "全部" }],
          currentFolderId,
          mediaFolderId,
          publicRootId,
        },
        meta: {
          total: 0,
          page,
          pageSize,
          totalPages: 1,
          hasNext: false,
          hasPrev: page > 1,
        },
      });
    }

    const [breadcrumbResult, mediaResult] = await Promise.all([
      getFolderBreadcrumb({
        access_token: access_token || "",
        folderId: currentFolderId,
      }),
      getMediaList({
        access_token,
        page,
        pageSize,
        sortBy,
        sortOrder,
        search,
        mediaType,
        userUid,
        sizeMin,
        sizeMax,
        inGallery,
        isOptimized,
        createdAtStart,
        createdAtEnd,
        hasReferences,
        folderId: effectiveFolderId,
      }),
    ]);

    if (!mediaResult.success) {
      return response.serverError({
        message: mediaResult.message || "获取媒体数据失败",
      });
    }

    const fallbackBreadcrumb: BreadcrumbItem[] = [{ id: null, name: "全部" }];
    const breadcrumb = breadcrumbResult.success
      ? (breadcrumbResult.data ?? fallbackBreadcrumb)
      : fallbackBreadcrumb;

    return response.ok({
      data: {
        media: mediaResult.data || [],
        folders: shouldSearchGlobal ? [] : folders,
        breadcrumb,
        currentFolderId,
        mediaFolderId,
        publicRootId,
      },
      meta: mediaResult.meta as PaginationMeta,
    });
  } catch (error) {
    console.error("GetMediaExplorerPage error:", error);
    return response.serverError();
  }
}

export async function createFolder(
  params: CreateFolderParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem | null>>>;
export async function createFolder(
  params: CreateFolderParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem | null>>;
export async function createFolder(
  { access_token, name, parentId, description }: CreateFolderParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "createFolder"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  // 验证文件夹名称
  if (!name || name.trim().length === 0) {
    return response.badRequest({ message: "文件夹名称不能为空" });
  }

  if (name.length > 100) {
    return response.badRequest({ message: "文件夹名称不能超过 100 个字符" });
  }

  // 检查名称是否包含非法字符
  const invalidChars = /[/\\:*?"<>|]/;
  if (invalidChars.test(name)) {
    return response.badRequest({
      message: '文件夹名称不能包含以下字符: / \\ : * ? " < > |',
    });
  }

  try {
    let actualParentId: number | null = parentId;
    let parentFolder: {
      id: number;
      path: string;
      depth: number;
      systemType: string;
      userUid: number | null;
    } | null = null;

    // 如果 parentId 为 null，需要确定实际的父文件夹
    if (parentId === null) {
      // 默认创建在公共空间根目录
      const publicRoot = await prisma.virtualFolder.findFirst({
        where: { systemType: "ROOT_PUBLIC" },
        select: {
          id: true,
          path: true,
          depth: true,
          systemType: true,
          userUid: true,
        },
      });

      if (!publicRoot) {
        return response.serverError({ message: "公共空间不存在" });
      }

      parentFolder = publicRoot;
      actualParentId = publicRoot.id;
    } else {
      // 获取父文件夹信息
      parentFolder = await prisma.virtualFolder.findUnique({
        where: { id: parentId },
        select: {
          id: true,
          path: true,
          depth: true,
          systemType: true,
          userUid: true,
        },
      });

      if (!parentFolder) {
        return response.notFound({ message: "父文件夹不存在" });
      }
    }

    // 权限检查
    // ROOT_USERS 只有管理员可以在其下创建文件夹（用于创建用户目录）
    if (parentFolder.systemType === "ROOT_USERS" && user.role !== "ADMIN") {
      return response.forbidden({ message: "无权限在用户目录下创建文件夹" });
    }

    // USER_HOME 文件夹只有所有者或管理员可以在其下创建
    if (parentFolder.systemType === "USER_HOME") {
      if (parentFolder.userUid !== user.uid && user.role !== "ADMIN") {
        return response.forbidden({
          message: "无权限在其他用户的文件夹中创建子文件夹",
        });
      }
    }

    // AUTHOR 只能在自己的 USER_HOME 或其子文件夹下创建
    if (user.role === "AUTHOR") {
      // 检查父文件夹是否属于当前用户
      const isOwnFolder = parentFolder.userUid === user.uid;
      const isPublicRoot = parentFolder.systemType === "ROOT_PUBLIC";

      if (!isOwnFolder && !isPublicRoot) {
        return response.forbidden({
          message: "无权限在此文件夹下创建子文件夹",
        });
      }
    }

    // 检查同级文件夹是否存在同名文件夹
    const existingFolder = await prisma.virtualFolder.findFirst({
      where: {
        parentId: actualParentId,
        name: name.trim(),
      },
    });

    if (existingFolder) {
      return response.badRequest({ message: "同级目录下已存在同名文件夹" });
    }

    // 获取同级文件夹的最大 order
    const maxOrder = await prisma.virtualFolder.aggregate({
      where: { parentId: actualParentId },
      _max: { order: true },
    });

    const newOrder = (maxOrder._max.order || 0) + 1;
    const newDepth = parentFolder.depth + 1;

    // 创建文件夹（先使用临时 path）
    // path 格式：包含自己的 ID，格式如 "2/3/4"（与 Comment 一致）
    // 但创建时还不知道自己的 ID，所以先设为空，创建后更新
    const newFolder = await prisma.virtualFolder.create({
      data: {
        name: name.trim(),
        systemType: "NORMAL",
        parentId: actualParentId,
        path: "", // 临时空值，稍后更新
        depth: newDepth,
        order: newOrder,
        description: description || null,
        userUid: user.uid, // 文件夹所有者
      },
    });

    // 更新 path（现在知道了新文件夹的 ID）
    const correctPath = parentFolder.path
      ? `${parentFolder.path}/${newFolder.id}`
      : `${newFolder.id}`;

    await prisma.virtualFolder.update({
      where: { id: newFolder.id },
      data: { path: correctPath },
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: {
          uid: String(user.uid),
        },
        details: {
          action: "CREATE_FOLDER",
          resourceType: "VirtualFolder",
          resourceId: String(newFolder.id),
          value: {
            old: null,
            new: {
              id: newFolder.id,
              name: newFolder.name,
              parentId: actualParentId,
              path: correctPath,
            },
          },
          description: `创建文件夹: ${newFolder.name}`,
        },
      });
    });

    return response.ok({
      data: {
        id: newFolder.id,
        name: newFolder.name,
        systemType: newFolder.systemType as
          | "NORMAL"
          | "ROOT_PUBLIC"
          | "ROOT_USERS"
          | "USER_HOME",
        userUid: newFolder.userUid,
        parentId: newFolder.parentId,
        path: correctPath,
        depth: newFolder.depth,
        order: newFolder.order,
        createdAt: newFolder.createdAt.toISOString(),
        updatedAt: newFolder.updatedAt.toISOString(),
      },
      message: "文件夹创建成功",
    });
  } catch (error) {
    console.error("CreateFolder error:", error);
    return response.serverError();
  }
}

/*
  ensureUserHomeFolder - 确保用户主文件夹存在（不存在则创建）
*/
export async function ensureUserHomeFolder(
  params: EnsureUserHomeFolderParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<FolderItem | null>>>;
export async function ensureUserHomeFolder(
  params: EnsureUserHomeFolderParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<FolderItem | null>>;
export async function ensureUserHomeFolder(
  { access_token, userUid, username }: EnsureUserHomeFolderParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<FolderItem | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "ensureUserHomeFolder"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  // 只能为当前用户创建主文件夹
  if (user.uid !== userUid && user.role !== "ADMIN") {
    return response.forbidden({ message: "无权限为其他用户创建主文件夹" });
  }

  try {
    // 检查用户主文件夹是否已存在
    const existingFolder = await prisma.virtualFolder.findFirst({
      where: {
        systemType: "USER_HOME",
        userUid: userUid,
      },
    });

    if (existingFolder) {
      // 已存在，直接返回
      return response.ok({
        data: {
          id: existingFolder.id,
          name: existingFolder.name,
          systemType: existingFolder.systemType as
            | "NORMAL"
            | "ROOT_PUBLIC"
            | "ROOT_USERS"
            | "USER_HOME",
          userUid: existingFolder.userUid,
          parentId: existingFolder.parentId,
          path: existingFolder.path,
          depth: existingFolder.depth,
          order: existingFolder.order,
          createdAt: existingFolder.createdAt.toISOString(),
          updatedAt: existingFolder.updatedAt.toISOString(),
        },
      });
    }

    // 查找用户目录（ROOT_USERS）
    const usersFolder = await prisma.virtualFolder.findFirst({
      where: {
        systemType: "ROOT_USERS",
      },
      select: { id: true, path: true },
    });

    if (!usersFolder) {
      return response.serverError({ message: "用户目录不存在" });
    }

    // 创建用户主文件夹
    // path 格式：包含自己的 ID，格式如 "2/3"（与 Comment 一致）
    const userHomePath = usersFolder.path
      ? `${usersFolder.path}/${usersFolder.id}`
      : `${usersFolder.id}`;
    const newFolder = await prisma.virtualFolder.create({
      data: {
        name: username,
        systemType: "USER_HOME",
        parentId: usersFolder.id,
        userUid: userUid,
        path: userHomePath,
        depth: 1,
        order: 0,
      },
    });

    return response.ok({
      data: {
        id: newFolder.id,
        name: newFolder.name,
        systemType: newFolder.systemType,
        userUid: newFolder.userUid,
        parentId: newFolder.parentId,
        path: newFolder.path,
        depth: newFolder.depth,
        order: newFolder.order,
        createdAt: newFolder.createdAt.toISOString(),
        updatedAt: newFolder.updatedAt.toISOString(),
      },
      message: "用户主文件夹创建成功",
    });
  } catch (error) {
    console.error("EnsureUserHomeFolder error:", error);
    return response.serverError();
  }
}

export async function moveItems(
  params: MoveItemsParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<MoveItemsResult | null>>>;
export async function moveItems(
  params: MoveItemsParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<MoveItemsResult | null>>;
export async function moveItems(
  { access_token, mediaIds, folderIds, targetFolderId }: MoveItemsParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<MoveItemsResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "moveItems"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  // 验证输入
  if (
    (!mediaIds || mediaIds.length === 0) &&
    (!folderIds || folderIds.length === 0)
  ) {
    return response.badRequest({ message: "请选择要移动的文件或文件夹" });
  }

  try {
    // 获取目标文件夹信息
    let targetFolder: {
      id: number;
      path: string;
      depth: number;
      systemType: string;
      userUid: number | null;
    } | null = null;

    if (targetFolderId !== null) {
      targetFolder = await prisma.virtualFolder.findUnique({
        where: { id: targetFolderId },
        select: {
          id: true,
          path: true,
          depth: true,
          systemType: true,
          userUid: true,
        },
      });

      if (!targetFolder) {
        return response.notFound({ message: "目标文件夹不存在" });
      }

      // 禁止移动到 ROOT_USERS 文件夹
      if (targetFolder.systemType === "ROOT_USERS") {
        return response.badRequest({
          message: "不能将文件移动到用户目录，请选择具体的用户文件夹",
        });
      }
    } else {
      // 目标是公共空间根目录
      const publicRoot = await prisma.virtualFolder.findFirst({
        where: { systemType: "ROOT_PUBLIC" },
        select: {
          id: true,
          path: true,
          depth: true,
          systemType: true,
          userUid: true,
        },
      });

      if (!publicRoot) {
        return response.serverError({ message: "公共空间不存在" });
      }

      targetFolder = publicRoot;
    }

    // 权限检查：AUTHOR 只能移动到自己的文件夹或公共空间
    if (user.role === "AUTHOR") {
      const isPublicTarget =
        targetFolder.systemType === "ROOT_PUBLIC" ||
        targetFolder.path.includes(`/${targetFolder.id}/`);
      const isOwnFolder = targetFolder.userUid === user.uid;

      if (!isPublicTarget && !isOwnFolder) {
        return response.forbidden({
          message: "无权限移动到此文件夹",
        });
      }
    }

    let movedMedia = 0;
    let movedFolders = 0;

    await prisma.$transaction(async (tx) => {
      // 移动媒体文件
      if (mediaIds && mediaIds.length > 0) {
        // 检查权限：AUTHOR 只能移动自己的文件
        if (user.role === "AUTHOR") {
          const ownedMedia = await tx.media.findMany({
            where: { id: { in: mediaIds }, userUid: user.uid },
            select: { id: true },
          });
          const ownedIds = ownedMedia.map((m) => m.id);

          if (ownedIds.length > 0) {
            const result = await tx.media.updateMany({
              where: { id: { in: ownedIds } },
              data: { folderId: targetFolder!.id },
            });
            movedMedia = result.count;
          }
        } else {
          const result = await tx.media.updateMany({
            where: { id: { in: mediaIds } },
            data: { folderId: targetFolder!.id },
          });
          movedMedia = result.count;
        }
      }

      // 移动文件夹
      if (folderIds && folderIds.length > 0) {
        // 获取要移动的文件夹信息
        const foldersToMove = await tx.virtualFolder.findMany({
          where: { id: { in: folderIds } },
          select: {
            id: true,
            name: true,
            path: true,
            depth: true,
            systemType: true,
            userUid: true,
          },
        });

        for (const folder of foldersToMove) {
          // 不允许移动系统文件夹
          if (
            folder.systemType === "ROOT_PUBLIC" ||
            folder.systemType === "ROOT_USERS" ||
            folder.systemType === "USER_HOME"
          ) {
            continue;
          }

          // AUTHOR 只能移动自己的文件夹
          if (user.role === "AUTHOR" && folder.userUid !== user.uid) {
            continue;
          }

          // 不能移动到自身或其子文件夹
          if (
            folder.id === targetFolder!.id ||
            targetFolder!.path.includes(`/${folder.id}/`)
          ) {
            continue;
          }

          // 检查目标文件夹下是否存在同名文件夹
          const existing = await tx.virtualFolder.findFirst({
            where: {
              parentId: targetFolder!.id,
              name: folder.name,
            },
          });

          if (existing) {
            continue; // 跳过同名文件夹
          }

          // 计算新路径
          // path 格式：包含自己的 ID，格式如 "2/3/4"（与 Comment 一致）
          const newPath = targetFolder!.path
            ? `${targetFolder!.path}/${folder.id}`
            : `${folder.id}`;
          const newDepth = targetFolder!.depth + 1;
          const oldPathPrefix = `${folder.path}/`;
          const depthDiff = newDepth - folder.depth;

          // 更新文件夹本身
          await tx.virtualFolder.update({
            where: { id: folder.id },
            data: {
              parentId: targetFolder!.id,
              path: newPath,
              depth: newDepth,
            },
          });

          // 更新所有子文件夹的路径
          // 找到所有以旧路径开头的子文件夹
          const descendants = await tx.virtualFolder.findMany({
            where: {
              path: { startsWith: oldPathPrefix },
            },
            select: { id: true, path: true, depth: true },
          });

          for (const desc of descendants) {
            // 提取子文件夹相对于被移动文件夹的路径部分
            // 例如：desc.path="2/3/4/5/6", folder.path="2/3/4"
            // oldPathPrefix="2/3/4/"
            // relativePart="5/6"
            const relativePart = desc.path.substring(oldPathPrefix.length);
            // 拼接新路径：newPath + "/" + relativePart
            // 例如：newPath="1/9/4", relativePart="5/6"
            // newDescPath="1/9/4/5/6"
            const newDescPath = relativePart
              ? `${newPath}/${relativePart}`
              : newPath;
            await tx.virtualFolder.update({
              where: { id: desc.id },
              data: {
                path: newDescPath,
                depth: desc.depth + depthDiff,
              },
            });
          }

          movedFolders++;
        }
      }
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "MOVE_ITEMS",
          resourceType: "Media/VirtualFolder",
          resourceId: `media:${mediaIds?.join(",") || ""};folders:${folderIds?.join(",") || ""}`,
          value: {
            old: null,
            new: {
              targetFolderId,
              movedMedia,
              movedFolders,
            },
          },
          description: `移动 ${movedMedia} 个文件和 ${movedFolders} 个文件夹`,
        },
      });
    });

    return response.ok({
      data: { movedMedia, movedFolders },
      message: `成功移动 ${movedMedia} 个文件和 ${movedFolders} 个文件夹`,
    });
  } catch (error) {
    console.error("MoveItems error:", error);
    return response.serverError();
  }
}

export async function deleteFolders(
  params: DeleteFoldersParams,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<DeleteFoldersResult | null>>>;
export async function deleteFolders(
  params: DeleteFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<DeleteFoldersResult | null>>;
export async function deleteFolders(
  { access_token, ids }: DeleteFoldersParams,
  serverConfig?: ActionConfig,
): Promise<ActionResult<DeleteFoldersResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "deleteFolders"))) {
    return response.tooManyRequests();
  }

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR", "AUTHOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  if (!ids || ids.length === 0) {
    return response.badRequest({ message: "请选择要删除的文件夹" });
  }

  try {
    // 获取要删除的文件夹信息
    const foldersToDelete = await prisma.virtualFolder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        path: true,
        systemType: true,
        userUid: true,
      },
    });

    if (foldersToDelete.length === 0) {
      return response.notFound({ message: "没有找到要删除的文件夹" });
    }

    // 过滤掉系统文件夹和无权限的文件夹
    const deletableFolder = foldersToDelete.filter((folder) => {
      // 不允许删除系统文件夹
      if (
        folder.systemType === "ROOT_PUBLIC" ||
        folder.systemType === "ROOT_USERS" ||
        folder.systemType === "USER_HOME"
      ) {
        return false;
      }

      // AUTHOR 只能删除自己的文件夹
      if (user.role === "AUTHOR" && folder.userUid !== user.uid) {
        return false;
      }

      return true;
    });

    if (deletableFolder.length === 0) {
      return response.forbidden({
        message: "没有权限删除选中的文件夹，或文件夹为系统文件夹",
      });
    }

    let deleted = 0;
    let deletedMediaCount = 0;

    // 执行删除
    await prisma.$transaction(async (tx) => {
      for (const folder of deletableFolder) {
        // 获取此文件夹及其所有子文件夹
        // path 格式：包含自己的 ID，格式如 "2/3/4"（与 Comment 一致）
        const folderPath = `${folder.path}/`;
        const descendantFolders = await tx.virtualFolder.findMany({
          where: {
            OR: [{ id: folder.id }, { path: { startsWith: folderPath } }],
          },
          select: { id: true },
        });

        const folderIdsToDelete = descendantFolders.map((f) => f.id);

        // 先将这些文件夹中的媒体文件的 folderId 设为 null（移到根目录）
        // 或者直接删除媒体文件（根据业务需求）
        // 这里选择将媒体文件移到公共空间根目录
        const publicRoot = await tx.virtualFolder.findFirst({
          where: { systemType: "ROOT_PUBLIC" },
          select: { id: true },
        });

        if (publicRoot) {
          // 统计被影响的媒体文件数量
          const affectedMedia = await tx.media.count({
            where: { folderId: { in: folderIdsToDelete } },
          });
          deletedMediaCount += affectedMedia;

          // 将媒体文件移到公共空间
          await tx.media.updateMany({
            where: { folderId: { in: folderIdsToDelete } },
            data: { folderId: publicRoot.id },
          });
        }

        // 删除文件夹（级联删除会自动删除子文件夹）
        await tx.virtualFolder.delete({
          where: { id: folder.id },
        });

        deleted++;
      }
    });

    // 记录审计日志
    const { after } = await import("next/server");
    after(async () => {
      await logAuditEvent({
        user: { uid: String(user.uid) },
        details: {
          action: "DELETE_FOLDERS",
          resourceType: "VirtualFolder",
          resourceId: deletableFolder.map((f) => f.id).join(","),
          value: {
            old: {
              folders: deletableFolder.map((f) => ({
                id: f.id,
                name: f.name,
              })),
            },
            new: null,
          },
          description: `删除 ${deleted} 个文件夹，${deletedMediaCount} 个文件被移至公共空间`,
        },
      });
    });

    return response.ok({
      data: { deleted, deletedMediaCount },
      message:
        deletedMediaCount > 0
          ? `成功删除 ${deleted} 个文件夹，${deletedMediaCount} 个文件已移至公共空间`
          : `成功删除 ${deleted} 个文件夹`,
    });
  } catch (error) {
    console.error("DeleteFolders error:", error);
    return response.serverError();
  }
}

export type {
  UploadMediaFile,
  UploadMediaParams,
  UploadMediaResult,
  FolderItem,
  BreadcrumbItem,
  GetAccessibleFoldersParams,
  GetFolderBreadcrumbParams,
  EnsureUserHomeFolderParams,
  GetMediaExplorerPageParams,
  MediaExplorerPageData,
  CreateFolderParams,
  MoveItemsParams,
  MoveItemsResult,
  DeleteFoldersParams,
  DeleteFoldersResult,
} from "@/lib/shared/media-types";
