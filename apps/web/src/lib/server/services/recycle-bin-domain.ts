import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
  PaginationMeta,
} from "@repo/shared-types/api/common";
import type {
  ClearRecycleBin,
  GetRecycleBinList,
  GetRecycleBinStats,
  PurgeRecycleBinItems,
  RecycleBinListItem,
  RecycleBinMutationItem,
  RecycleBinResourceType,
  RecycleBinStatsData,
  RestoreAllProjectsFromRecycleBin,
  RestoreRecycleBinItems,
} from "@repo/shared-types/api/recycle-bin";
import {
  ClearRecycleBinSchema,
  GetRecycleBinListSchema,
  GetRecycleBinStatsSchema,
  PurgeRecycleBinItemsSchema,
  RestoreAllProjectsFromRecycleBinSchema,
  RestoreRecycleBinItemsSchema,
} from "@repo/shared-types/api/recycle-bin";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify, type UserRole } from "@/lib/server/auth-verify";
import { expireCacheTag as updateTag } from "@/lib/server/isr-invalidation";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

type GroupedMutationItems = {
  projectIds: number[];
  friendLinkIds: number[];
  postIds: number[];
  pageIds: string[];
  commentIds: string[];
  userIds: number[];
  messageIds: string[];
};

type ProjectCacheSnapshot = {
  id: number;
  slug: string;
  title: string;
  status: string;
  tags: Array<{ slug: string }>;
  categories: Array<{ fullSlug: string }>;
};

type PostCacheSnapshot = {
  id: number;
  slug: string;
  title: string;
  status: string;
  tags: Array<{ slug: string }>;
  categories: Array<{ fullSlug: string }>;
};

const RESOURCE_TYPES: RecycleBinResourceType[] = [
  "PROJECT",
  "FRIEND_LINK",
  "POST",
  "PAGE",
  "COMMENT",
  "USER",
  "MESSAGE",
];

const RESOURCE_TYPE_LABEL: Record<RecycleBinResourceType, string> = {
  PROJECT: "项目",
  FRIEND_LINK: "友情链接",
  POST: "文章",
  PAGE: "页面",
  COMMENT: "评论",
  USER: "用户",
  MESSAGE: "私信",
};

const ADMIN_PANEL_ROLES: UserRole[] = ["ADMIN", "EDITOR", "AUTHOR"];

const ROLE_VISIBLE_RESOURCE_TYPES: Record<UserRole, RecycleBinResourceType[]> =
  {
    ADMIN: RESOURCE_TYPES,
    EDITOR: ["PROJECT", "POST", "COMMENT"],
    AUTHOR: ["PROJECT", "POST", "COMMENT"],
    USER: [],
  };

const AUDIT_RESOURCE_ALIASES: Record<RecycleBinResourceType, string[]> = {
  PROJECT: ["PROJECT"],
  FRIEND_LINK: ["FRIEND_LINK", "FRIENDLINK", "FRIEND"],
  POST: ["POST"],
  PAGE: ["PAGE"],
  COMMENT: ["COMMENT"],
  USER: ["USER"],
  MESSAGE: ["MESSAGE"],
};

const DELETE_AUDIT_ACTIONS = [
  "DELETE",
  "SOFT_DELETE",
  "BULK_DELETE",
  "PURGE",
  "PURGE_ALL",
] as const;

function createTypeCounter(): Record<RecycleBinResourceType, number> {
  return {
    PROJECT: 0,
    FRIEND_LINK: 0,
    POST: 0,
    PAGE: 0,
    COMMENT: 0,
    USER: 0,
    MESSAGE: 0,
  };
}

function toByTypeResult(
  counter: Record<RecycleBinResourceType, number>,
): Array<{ resourceType: RecycleBinResourceType; count: number }> {
  return RESOURCE_TYPES.map((resourceType) => ({
    resourceType,
    count: counter[resourceType],
  })).filter((item) => item.count > 0);
}

function getVisibleResourceTypes(role: UserRole): RecycleBinResourceType[] {
  return ROLE_VISIBLE_RESOURCE_TYPES[role] ?? [];
}

function normalizeRequestedResourceTypes(
  role: UserRole,
  requested?: RecycleBinResourceType[],
): RecycleBinResourceType[] {
  const visible = getVisibleResourceTypes(role);
  if (!requested || requested.length === 0) {
    return visible;
  }
  const visibleSet = new Set(visible);
  return requested.filter((resourceType) => visibleSet.has(resourceType));
}

function parseDateAtBoundary(
  dateString: string | undefined,
  boundary: "start" | "end",
): Date | undefined {
  if (!dateString) {
    return undefined;
  }
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  if (boundary === "start") {
    parsed.setHours(0, 0, 0, 0);
  } else {
    parsed.setHours(23, 59, 59, 999);
  }
  return parsed;
}

function buildDeletedAtFilter(
  start?: Date,
  end?: Date,
): Prisma.DateTimeNullableFilter {
  const filter: Prisma.DateTimeNullableFilter = { not: null };
  if (start) filter.gte = start;
  if (end) filter.lte = end;
  return filter;
}

function buildCreatedAtFilter(
  start?: Date,
  end?: Date,
): Prisma.DateTimeFilter | undefined {
  if (!start && !end) {
    return undefined;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (start) filter.gte = start;
  if (end) filter.lte = end;
  return filter;
}

function toPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

function summarizeText(
  text: string | null | undefined,
  maxLength = 48,
): string {
  const normalized = text?.replace(/\s+/g, " ").trim() || "";
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function resolveCommentResourceReference(item: {
  post: { slug: string } | null;
  page?: { slug: string } | null;
}): string {
  if (item.post?.slug) return item.post.slug;
  if (item.page?.slug) {
    return item.page.slug.startsWith("/")
      ? item.page.slug
      : `/${item.page.slug}`;
  }
  return "";
}

function normalizeAuditIds(rawIds: unknown): string[] {
  if (typeof rawIds === "string") {
    return rawIds
      .split(",")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }
  if (typeof rawIds === "number") {
    return [String(rawIds)];
  }
  if (Array.isArray(rawIds)) {
    const ids: string[] = [];
    for (const segment of rawIds) {
      if (typeof segment === "number" || typeof segment === "string") {
        ids.push(...normalizeAuditIds(segment));
      }
    }
    return ids;
  }
  return [];
}

function extractIdsFromAuditLog(
  resourceId: string,
  metadata: Prisma.JsonValue | null,
): string[] {
  const idSet = new Set<string>(normalizeAuditIds(resourceId));
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    "ids" in metadata
  ) {
    const ids = normalizeAuditIds((metadata as Record<string, unknown>).ids);
    for (const id of ids) {
      idSet.add(id);
    }
  }
  return Array.from(idSet);
}

function toOperatorName(
  user: {
    uid: number;
    username: string;
    nickname: string | null;
  } | null,
): string {
  if (!user) {
    return "未知";
  }
  const nickname = user.nickname?.trim();
  return nickname && nickname.length > 0 ? nickname : user.username;
}

function dedupeMutationItems(
  items: RecycleBinMutationItem[],
): RecycleBinMutationItem[] {
  const map = new Map<string, RecycleBinMutationItem>();
  for (const item of items) {
    const key = `${item.resourceType}:${String(item.id)}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function groupMutationItems(
  items: RecycleBinMutationItem[],
): GroupedMutationItems {
  const grouped: GroupedMutationItems = {
    projectIds: [],
    friendLinkIds: [],
    postIds: [],
    pageIds: [],
    commentIds: [],
    userIds: [],
    messageIds: [],
  };

  for (const item of items) {
    if (item.resourceType === "PROJECT" && typeof item.id === "number") {
      grouped.projectIds.push(item.id);
      continue;
    }
    if (item.resourceType === "FRIEND_LINK" && typeof item.id === "number") {
      grouped.friendLinkIds.push(item.id);
      continue;
    }
    if (item.resourceType === "POST" && typeof item.id === "number") {
      grouped.postIds.push(item.id);
      continue;
    }
    if (item.resourceType === "PAGE" && typeof item.id === "string") {
      grouped.pageIds.push(item.id);
      continue;
    }
    if (item.resourceType === "COMMENT" && typeof item.id === "string") {
      grouped.commentIds.push(item.id);
      continue;
    }
    if (item.resourceType === "USER" && typeof item.id === "number") {
      grouped.userIds.push(item.id);
      continue;
    }
    if (item.resourceType === "MESSAGE" && typeof item.id === "string") {
      grouped.messageIds.push(item.id);
    }
  }

  return grouped;
}

function collectProjectCacheTags(
  projects: ProjectCacheSnapshot[],
  options?: {
    includeCategoryAndTagDetail?: boolean;
  },
): void {
  if (projects.length === 0) {
    return;
  }
  const includeDetail = options?.includeCategoryAndTagDetail ?? true;
  const tagSlugs = new Set<string>();
  const categoryPaths = new Set<string>();

  for (const project of projects) {
    updateTag(`projects/${project.slug}`);
    if (project.status !== "PUBLISHED") continue;
    for (const tag of project.tags) {
      if (tag.slug) tagSlugs.add(tag.slug);
    }
    for (const category of project.categories) {
      const segments = category.fullSlug
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      for (let i = 1; i <= segments.length; i += 1) {
        categoryPaths.add(segments.slice(0, i).join("/"));
      }
    }
  }

  updateTag("projects/list");
  if (!includeDetail) return;
  updateTag("tags/list");
  updateTag("categories/list");
  for (const slug of tagSlugs) updateTag(`tags/${slug}`);
  for (const path of categoryPaths) updateTag(`categories/${path}`);
}

function collectPostCacheTags(posts: PostCacheSnapshot[]): void {
  if (posts.length === 0) {
    return;
  }
  const tagSlugs = new Set<string>();
  const categoryPaths = new Set<string>();

  for (const post of posts) {
    updateTag(`posts/${post.slug}`);
    for (const tag of post.tags) {
      if (tag.slug) tagSlugs.add(tag.slug);
    }
    for (const category of post.categories) {
      const segments = category.fullSlug
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);
      for (let i = 1; i <= segments.length; i += 1) {
        categoryPaths.add(segments.slice(0, i).join("/"));
      }
    }
  }

  updateTag("posts/list");
  updateTag("tags/list");
  updateTag("categories/list");
  for (const slug of tagSlugs) updateTag(`tags/${slug}`);
  for (const path of categoryPaths) updateTag(`categories/${path}`);
}

function invalidateFriendLinkCache(): void {
  updateTag("friend-links");
}

function invalidatePageCache(pageIds: string[]): void {
  if (pageIds.length === 0) return;
  updateTag("pages");
  for (const pageId of pageIds) updateTag(`pages/${pageId}`);
}

function invalidateUserCache(userIds: number[]): void {
  if (userIds.length === 0) return;
  updateTag("users");
  for (const userId of userIds) updateTag(`users/${userId}`);
}

async function resolveDeleteOperators(
  items: RecycleBinListItem[],
): Promise<Map<string, { uid: number | null; name: string }>> {
  const operatorMap = new Map<string, { uid: number | null; name: string }>();
  if (items.length === 0) {
    return operatorMap;
  }

  const missingByType: Record<RecycleBinResourceType, Set<string>> = {
    PROJECT: new Set(),
    FRIEND_LINK: new Set(),
    POST: new Set(),
    PAGE: new Set(),
    COMMENT: new Set(),
    USER: new Set(),
    MESSAGE: new Set(),
  };

  for (const item of items) {
    missingByType[item.resourceType].add(String(item.id));
  }

  const aliasToType = new Map<string, RecycleBinResourceType>();
  for (const resourceType of RESOURCE_TYPES) {
    for (const alias of AUDIT_RESOURCE_ALIASES[resourceType]) {
      aliasToType.set(alias, resourceType);
    }
  }

  const hasMissing = () =>
    RESOURCE_TYPES.some((resourceType) => missingByType[resourceType].size > 0);

  const logs = await prisma.auditLog.findMany({
    where: {
      action: {
        in: [...DELETE_AUDIT_ACTIONS],
      },
      resource: {
        in: Array.from(aliasToType.keys()),
      },
    },
    orderBy: {
      timestamp: "desc",
    },
    take: 8000,
    select: {
      resource: true,
      resourceId: true,
      metadata: true,
      user: {
        select: {
          uid: true,
          username: true,
          nickname: true,
        },
      },
    },
  });

  for (const log of logs) {
    if (!hasMissing()) break;
    const resourceType = aliasToType.get(log.resource);
    if (!resourceType) continue;
    const missingIds = missingByType[resourceType];
    if (missingIds.size === 0) continue;

    const ids = extractIdsFromAuditLog(log.resourceId, log.metadata);
    for (const id of ids) {
      if (!missingIds.has(id)) continue;
      operatorMap.set(`${resourceType}:${id}`, {
        uid: log.user?.uid ?? null,
        name: toOperatorName(log.user),
      });
      missingIds.delete(id);
    }
  }

  return operatorMap;
}

async function safeLogAuditEvent(params: {
  userUid: number;
  action: string;
  resourceType: string;
  resourceId?: string;
  oldValue: unknown;
  newValue: unknown;
  description: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<void> {
  try {
    await logAuditEvent({
      user: {
        uid: String(params.userUid),
      },
      details: {
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        value: {
          old: params.oldValue as string | number | boolean | object | null,
          new: params.newValue as string | number | boolean | object | null,
        },
        description: params.description,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 写入审计日志失败:", error);
  }
}

export async function getRecycleBinList(
  params: GetRecycleBinList,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RecycleBinListItem[] | null>>>;
export async function getRecycleBinList(
  params?: GetRecycleBinList,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RecycleBinListItem[] | null>>;
export async function getRecycleBinList(
  {
    access_token,
    page = 1,
    pageSize = 25,
    search,
    sortBy = "deletedAt",
    sortOrder = "desc",
    resourceTypes,
    createdAtStart,
    createdAtEnd,
    deletedAtStart,
    deletedAtEnd,
  }: GetRecycleBinList = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<RecycleBinListItem[] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getRecycleBinList"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      page,
      pageSize,
      search,
      sortBy,
      sortOrder,
      resourceTypes,
      createdAtStart,
      createdAtEnd,
      deletedAtStart,
      deletedAtEnd,
    },
    GetRecycleBinListSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const visibleTypes = normalizeRequestedResourceTypes(
      user.role as UserRole,
      resourceTypes,
    );

    if (visibleTypes.length === 0) {
      return response.ok({
        data: [],
        meta: toPaginationMeta(page, pageSize, 0),
      });
    }

    const visibleTypeSet = new Set(visibleTypes);
    const normalizedSearch = search?.trim();
    const createdAtFilter = buildCreatedAtFilter(
      parseDateAtBoundary(createdAtStart, "start"),
      parseDateAtBoundary(createdAtEnd, "end"),
    );
    const deletedAtFilter = buildDeletedAtFilter(
      parseDateAtBoundary(deletedAtStart, "start"),
      parseDateAtBoundary(deletedAtEnd, "end"),
    );

    const [projects, friendLinks, posts, pages, comments, users, messages] =
      await Promise.all([
        visibleTypeSet.has("PROJECT")
          ? prisma.project.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(user.role === "AUTHOR" ? [{ userUid: user.uid }] : []),
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              title: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              slug: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                title: true,
                slug: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("FRIEND_LINK")
          ? prisma.friendLink.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              name: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              url: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                name: true,
                url: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("POST")
          ? prisma.post.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(user.role === "AUTHOR" ? [{ userUid: user.uid }] : []),
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              title: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              slug: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                title: true,
                slug: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("PAGE")
          ? prisma.page.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              title: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              slug: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                title: true,
                slug: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("COMMENT")
          ? prisma.comment.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(user.role === "AUTHOR"
                    ? [
                        {
                          OR: [
                            { userUid: user.uid },
                            { post: { userUid: user.uid } },
                          ],
                        },
                      ]
                    : []),
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              content: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              authorName: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              authorEmail: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                content: true,
                authorName: true,
                createdAt: true,
                deletedAt: true,
                post: {
                  select: {
                    slug: true,
                  },
                },
                page: {
                  select: {
                    slug: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("USER")
          ? prisma.user.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(normalizedSearch
                    ? [
                        {
                          OR: [
                            {
                              username: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              nickname: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                            {
                              email: {
                                contains: normalizedSearch,
                                mode: "insensitive" as const,
                              },
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                uid: true,
                username: true,
                nickname: true,
                email: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
        visibleTypeSet.has("MESSAGE")
          ? prisma.message.findMany({
              where: {
                AND: [
                  { deletedAt: deletedAtFilter },
                  ...(normalizedSearch
                    ? [
                        {
                          content: {
                            contains: normalizedSearch,
                            mode: "insensitive" as const,
                          },
                        },
                      ]
                    : []),
                  ...(createdAtFilter ? [{ createdAt: createdAtFilter }] : []),
                ],
              },
              select: {
                id: true,
                content: true,
                conversationId: true,
                createdAt: true,
                deletedAt: true,
              },
            })
          : Promise.resolve([]),
      ]);

    const rows: RecycleBinListItem[] = [
      ...projects
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `PROJECT:${item.id}`,
          resourceType: "PROJECT" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.PROJECT,
          id: item.id,
          resourceName: item.title,
          resourceReference: item.slug,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...friendLinks
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `FRIEND_LINK:${item.id}`,
          resourceType: "FRIEND_LINK" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.FRIEND_LINK,
          id: item.id,
          resourceName: item.name,
          resourceReference: item.url,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...posts
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `POST:${item.id}`,
          resourceType: "POST" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.POST,
          id: item.id,
          resourceName: item.title,
          resourceReference: item.slug,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...pages
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `PAGE:${item.id}`,
          resourceType: "PAGE" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.PAGE,
          id: item.id,
          resourceName: item.title,
          resourceReference: item.slug,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...comments
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `COMMENT:${item.id}`,
          resourceType: "COMMENT" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.COMMENT,
          id: item.id,
          resourceName:
            summarizeText(item.content, 48) ||
            `${item.authorName || "匿名"} 的评论`,
          resourceReference: resolveCommentResourceReference(item),
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...users
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `USER:${item.uid}`,
          resourceType: "USER" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.USER,
          id: item.uid,
          resourceName:
            item.nickname?.trim() || item.username || `用户 ${item.uid}`,
          resourceReference: item.email,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
      ...messages
        .filter((item) => item.deletedAt)
        .map((item) => ({
          key: `MESSAGE:${item.id}`,
          resourceType: "MESSAGE" as const,
          resourceTypeLabel: RESOURCE_TYPE_LABEL.MESSAGE,
          id: item.id,
          resourceName:
            summarizeText(item.content, 48) ||
            `私信 ${String(item.id).slice(0, 8)}`,
          resourceReference: item.conversationId,
          createdAt: item.createdAt.toISOString(),
          deletedAt:
            item.deletedAt?.toISOString() || item.createdAt.toISOString(),
          deletedByUid: null,
          deletedByName: "未知",
        })),
    ];

    const direction = sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortBy === "createdAt") {
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          direction
        );
      }

      if (sortBy === "resourceType") {
        const typeCompare = a.resourceType.localeCompare(
          b.resourceType,
          "zh-CN",
        );
        if (typeCompare !== 0) {
          return typeCompare * direction;
        }
      }

      if (sortBy === "resourceName") {
        const nameCompare = a.resourceName.localeCompare(
          b.resourceName,
          "zh-CN",
        );
        if (nameCompare !== 0) {
          return nameCompare * direction;
        }
      }

      return (
        (new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime()) *
        direction
      );
    });

    const safePageSize = Math.max(1, Math.min(pageSize, 100));
    const total = rows.length;
    const startIndex = Math.max(0, (page - 1) * safePageSize);
    const pagedRows = rows.slice(startIndex, startIndex + safePageSize);

    const operatorMap = await resolveDeleteOperators(pagedRows);
    for (const item of pagedRows) {
      const operator = operatorMap.get(item.key);
      if (!operator) continue;
      item.deletedByUid = operator.uid;
      item.deletedByName = operator.name;
    }

    return response.ok({
      data: pagedRows,
      meta: toPaginationMeta(page, safePageSize, total),
    });
  } catch (error) {
    console.error("[RecycleBin] 获取回收站列表失败:", error);
    return response.serverError({
      message: "获取回收站列表失败",
    });
  }
}

export async function getRecycleBinStats(
  params: GetRecycleBinStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<RecycleBinStatsData | null>>>;
export async function getRecycleBinStats(
  params?: GetRecycleBinStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<RecycleBinStatsData | null>>;
export async function getRecycleBinStats(
  { access_token, force: _force, resourceTypes }: GetRecycleBinStats = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<RecycleBinStatsData | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getRecycleBinStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force: _force,
      resourceTypes,
    },
    GetRecycleBinStatsSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const visibleTypes = normalizeRequestedResourceTypes(
      user.role as UserRole,
      resourceTypes,
    );

    if (visibleTypes.length === 0) {
      return response.ok({
        data: {
          updatedAt: new Date().toISOString(),
          total: 0,
          recent: {
            last7Days: 0,
            last30Days: 0,
          },
          types: [],
        },
      });
    }

    const visibleTypeSet = new Set(visibleTypes);
    const counter = createTypeCounter();
    const recent7Counter = createTypeCounter();
    const recent30Counter = createTypeCounter();
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (visibleTypeSet.has("PROJECT")) {
      const buildWhere = (since?: Date): Prisma.ProjectWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
        ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
      });
      const [total, last7, last30] = await Promise.all([
        prisma.project.count({ where: buildWhere() }),
        prisma.project.count({ where: buildWhere(last7Days) }),
        prisma.project.count({ where: buildWhere(last30Days) }),
      ]);
      counter.PROJECT = total;
      recent7Counter.PROJECT = last7;
      recent30Counter.PROJECT = last30;
    }

    if (visibleTypeSet.has("FRIEND_LINK")) {
      const buildWhere = (since?: Date): Prisma.FriendLinkWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
      });
      const [total, last7, last30] = await Promise.all([
        prisma.friendLink.count({ where: buildWhere() }),
        prisma.friendLink.count({ where: buildWhere(last7Days) }),
        prisma.friendLink.count({ where: buildWhere(last30Days) }),
      ]);
      counter.FRIEND_LINK = total;
      recent7Counter.FRIEND_LINK = last7;
      recent30Counter.FRIEND_LINK = last30;
    }

    if (visibleTypeSet.has("POST")) {
      const buildWhere = (since?: Date): Prisma.PostWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
        ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
      });
      const [total, last7, last30] = await Promise.all([
        prisma.post.count({ where: buildWhere() }),
        prisma.post.count({ where: buildWhere(last7Days) }),
        prisma.post.count({ where: buildWhere(last30Days) }),
      ]);
      counter.POST = total;
      recent7Counter.POST = last7;
      recent30Counter.POST = last30;
    }

    if (visibleTypeSet.has("PAGE")) {
      const buildWhere = (since?: Date): Prisma.PageWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
      });
      const [total, last7, last30] = await Promise.all([
        prisma.page.count({ where: buildWhere() }),
        prisma.page.count({ where: buildWhere(last7Days) }),
        prisma.page.count({ where: buildWhere(last30Days) }),
      ]);
      counter.PAGE = total;
      recent7Counter.PAGE = last7;
      recent30Counter.PAGE = last30;
    }

    if (visibleTypeSet.has("COMMENT")) {
      const buildWhere = (since?: Date): Prisma.CommentWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
        ...(user.role === "AUTHOR"
          ? {
              OR: [{ userUid: user.uid }, { post: { userUid: user.uid } }],
            }
          : {}),
      });
      const [total, last7, last30] = await Promise.all([
        prisma.comment.count({ where: buildWhere() }),
        prisma.comment.count({ where: buildWhere(last7Days) }),
        prisma.comment.count({ where: buildWhere(last30Days) }),
      ]);
      counter.COMMENT = total;
      recent7Counter.COMMENT = last7;
      recent30Counter.COMMENT = last30;
    }

    if (visibleTypeSet.has("USER")) {
      const buildWhere = (since?: Date): Prisma.UserWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
      });
      const [total, last7, last30] = await Promise.all([
        prisma.user.count({ where: buildWhere() }),
        prisma.user.count({ where: buildWhere(last7Days) }),
        prisma.user.count({ where: buildWhere(last30Days) }),
      ]);
      counter.USER = total;
      recent7Counter.USER = last7;
      recent30Counter.USER = last30;
    }

    if (visibleTypeSet.has("MESSAGE")) {
      const buildWhere = (since?: Date): Prisma.MessageWhereInput => ({
        deletedAt: since ? { not: null, gte: since } : { not: null },
      });
      const [total, last7, last30] = await Promise.all([
        prisma.message.count({ where: buildWhere() }),
        prisma.message.count({ where: buildWhere(last7Days) }),
        prisma.message.count({ where: buildWhere(last30Days) }),
      ]);
      counter.MESSAGE = total;
      recent7Counter.MESSAGE = last7;
      recent30Counter.MESSAGE = last30;
    }

    const total = visibleTypes.reduce(
      (sum, resourceType) => sum + counter[resourceType],
      0,
    );

    return response.ok({
      data: {
        updatedAt: new Date().toISOString(),
        total,
        recent: {
          last7Days: visibleTypes.reduce(
            (sum, resourceType) => sum + recent7Counter[resourceType],
            0,
          ),
          last30Days: visibleTypes.reduce(
            (sum, resourceType) => sum + recent30Counter[resourceType],
            0,
          ),
        },
        types: visibleTypes.map((resourceType) => ({
          resourceType,
          label: RESOURCE_TYPE_LABEL[resourceType],
          count: counter[resourceType],
          percentage:
            total > 0
              ? Number(((counter[resourceType] / total) * 100).toFixed(2))
              : 0,
        })),
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 获取回收站统计失败:", error);
    return response.serverError({
      message: "获取回收站统计失败",
    });
  }
}

export async function restoreRecycleBinItems(
  params: RestoreRecycleBinItems,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      restored: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;
export async function restoreRecycleBinItems(
  params: RestoreRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    restored: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;
export async function restoreRecycleBinItems(
  { access_token, items }: RestoreRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    restored: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "restoreRecycleBinItems"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      items,
    },
    RestoreRecycleBinItemsSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const visibleTypeSet = new Set(
      getVisibleResourceTypes(user.role as UserRole),
    );
    const dedupedItems = dedupeMutationItems(items).filter((item) =>
      visibleTypeSet.has(item.resourceType),
    );

    if (dedupedItems.length === 0) {
      return response.forbidden({
        message: "当前角色无权恢复所选资源",
      });
    }

    const grouped = groupMutationItems(dedupedItems);
    const counter = createTypeCounter();

    if (grouped.projectIds.length > 0) {
      const rows = await prisma.project.findMany({
        where: {
          id: { in: grouped.projectIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.project.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.PROJECT = result.count;
        collectProjectCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "PROJECT",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          description: `从回收站恢复 ${result.count} 个项目`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.friendLinkIds.length > 0) {
      const rows = await prisma.friendLink.findMany({
        where: {
          id: { in: grouped.friendLinkIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          url: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.friendLink.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.FRIEND_LINK = result.count;
        invalidateFriendLinkCache();
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "FRIEND_LINK",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows,
          description: `从回收站恢复 ${result.count} 条友情链接`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.postIds.length > 0) {
      const rows = await prisma.post.findMany({
        where: {
          id: { in: grouped.postIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.post.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.POST = result.count;
        collectPostCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "POST",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          description: `从回收站恢复 ${result.count} 篇文章`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.pageIds.length > 0) {
      const rows = await prisma.page.findMany({
        where: {
          id: { in: grouped.pageIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          slug: true,
          title: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.page.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.PAGE = result.count;
        invalidatePageCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "PAGE",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows,
          description: `从回收站恢复 ${result.count} 个页面`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.commentIds.length > 0) {
      const rows = await prisma.comment.findMany({
        where: {
          id: { in: grouped.commentIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR"
            ? {
                OR: [{ userUid: user.uid }, { post: { userUid: user.uid } }],
              }
            : {}),
        },
        select: {
          id: true,
          content: true,
          post: {
            select: {
              slug: true,
            },
          },
          page: {
            select: {
              slug: true,
            },
          },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.comment.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.COMMENT = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "COMMENT",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows.map((item) => ({
            id: item.id,
            postSlug: resolveCommentResourceReference(item),
            content: summarizeText(item.content, 80),
          })),
          description: `从回收站恢复 ${result.count} 条评论`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.userIds.length > 0) {
      const rows = await prisma.user.findMany({
        where: {
          uid: { in: grouped.userIds },
          deletedAt: { not: null },
        },
        select: {
          uid: true,
          username: true,
          nickname: true,
          email: true,
        },
      });
      const ids = rows.map((item) => item.uid);
      if (ids.length > 0) {
        const result = await prisma.user.updateMany({
          where: { uid: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.USER = result.count;
        invalidateUserCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "USER",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows,
          description: `从回收站恢复 ${result.count} 个用户`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.messageIds.length > 0) {
      const rows = await prisma.message.findMany({
        where: {
          id: { in: grouped.messageIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          content: true,
          conversationId: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.message.updateMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
          data: { deletedAt: null },
        });
        counter.MESSAGE = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "RESTORE",
          resourceType: "MESSAGE",
          resourceId: ids.join(","),
          oldValue: null,
          newValue: rows.map((item) => ({
            id: item.id,
            conversationId: item.conversationId,
            content: summarizeText(item.content, 80),
          })),
          description: `从回收站恢复 ${result.count} 条私信`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    const restored = RESOURCE_TYPES.reduce(
      (sum, resourceType) => sum + counter[resourceType],
      0,
    );

    return response.ok({
      data: {
        restored,
        byType: toByTypeResult(counter),
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 恢复资源失败:", error);
    return response.serverError({
      message: "恢复失败，请稍后重试",
    });
  }
}

export async function purgeRecycleBinItems(
  params: PurgeRecycleBinItems,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;
export async function purgeRecycleBinItems(
  params: PurgeRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;
export async function purgeRecycleBinItems(
  { access_token, items }: PurgeRecycleBinItems,
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "purgeRecycleBinItems"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      items,
    },
    PurgeRecycleBinItemsSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const visibleTypeSet = new Set(
      getVisibleResourceTypes(user.role as UserRole),
    );
    const dedupedItems = dedupeMutationItems(items).filter((item) =>
      visibleTypeSet.has(item.resourceType),
    );

    if (dedupedItems.length === 0) {
      return response.forbidden({
        message: "当前角色无权删除所选资源",
      });
    }

    const grouped = groupMutationItems(dedupedItems);
    const counter = createTypeCounter();

    if (grouped.projectIds.length > 0) {
      const rows = await prisma.project.findMany({
        where: {
          id: { in: grouped.projectIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.project.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.PROJECT = result.count;
        collectProjectCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "PROJECT",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 个项目`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.friendLinkIds.length > 0) {
      const rows = await prisma.friendLink.findMany({
        where: {
          id: { in: grouped.friendLinkIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          url: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.friendLink.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.FRIEND_LINK = result.count;
        invalidateFriendLinkCache();
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "FRIEND_LINK",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 条友情链接`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.postIds.length > 0) {
      const rows = await prisma.post.findMany({
        where: {
          id: { in: grouped.postIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.post.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.POST = result.count;
        collectPostCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "POST",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 篇文章`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.pageIds.length > 0) {
      const rows = await prisma.page.findMany({
        where: {
          id: { in: grouped.pageIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          slug: true,
          title: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.page.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.PAGE = result.count;
        invalidatePageCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "PAGE",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 个页面`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.commentIds.length > 0) {
      const rows = await prisma.comment.findMany({
        where: {
          id: { in: grouped.commentIds },
          deletedAt: { not: null },
          ...(user.role === "AUTHOR"
            ? {
                OR: [{ userUid: user.uid }, { post: { userUid: user.uid } }],
              }
            : {}),
        },
        select: {
          id: true,
          content: true,
          post: {
            select: {
              slug: true,
            },
          },
          page: {
            select: {
              slug: true,
            },
          },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.comment.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.COMMENT = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "COMMENT",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            postSlug: resolveCommentResourceReference(item),
            content: summarizeText(item.content, 80),
          })),
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 条评论`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.userIds.length > 0) {
      const rows = await prisma.user.findMany({
        where: {
          uid: { in: grouped.userIds },
          deletedAt: { not: null },
        },
        select: {
          uid: true,
          username: true,
          nickname: true,
          email: true,
        },
      });
      const ids = rows.map((item) => item.uid);
      if (ids.length > 0) {
        const result = await prisma.user.deleteMany({
          where: { uid: { in: ids }, deletedAt: { not: null } },
        });
        counter.USER = result.count;
        invalidateUserCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "USER",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 个用户`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (grouped.messageIds.length > 0) {
      const rows = await prisma.message.findMany({
        where: {
          id: { in: grouped.messageIds },
          deletedAt: { not: null },
        },
        select: {
          id: true,
          content: true,
          conversationId: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.message.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.MESSAGE = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE",
          resourceType: "MESSAGE",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            conversationId: item.conversationId,
            content: summarizeText(item.content, 80),
          })),
          newValue: null,
          description: `从回收站彻底删除 ${result.count} 条私信`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    const deleted = RESOURCE_TYPES.reduce(
      (sum, resourceType) => sum + counter[resourceType],
      0,
    );

    return response.ok({
      data: {
        deleted,
        byType: toByTypeResult(counter),
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 彻底删除资源失败:", error);
    return response.serverError({
      message: "删除失败，请稍后重试",
    });
  }
}

export async function restoreAllProjectsFromRecycleBin(
  params: RestoreAllProjectsFromRecycleBin,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<{ restored: number } | null>>>;
export async function restoreAllProjectsFromRecycleBin(
  params?: RestoreAllProjectsFromRecycleBin,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<{ restored: number } | null>>;
export async function restoreAllProjectsFromRecycleBin(
  { access_token }: RestoreAllProjectsFromRecycleBin = {},
  serverConfig?: ActionConfig,
): Promise<ActionResult<{ restored: number } | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (
    !(await limitControl(await headers(), "restoreAllProjectsFromRecycleBin"))
  ) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
    },
    RestoreAllProjectsFromRecycleBinSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const rows = await prisma.project.findMany({
      where: {
        deletedAt: { not: null },
        ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
      },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        tags: { select: { slug: true } },
        categories: { select: { fullSlug: true } },
      },
    });

    const ids = rows.map((item) => item.id);
    if (ids.length === 0) {
      return response.ok({
        data: {
          restored: 0,
        },
      });
    }

    const result = await prisma.project.updateMany({
      where: {
        id: { in: ids },
        deletedAt: { not: null },
      },
      data: {
        deletedAt: null,
      },
    });

    collectProjectCacheTags(rows);

    await safeLogAuditEvent({
      userUid: user.uid,
      action: "RESTORE_ALL",
      resourceType: "PROJECT",
      resourceId: ids.join(","),
      oldValue: null,
      newValue: rows.map((item) => ({
        id: item.id,
        slug: item.slug,
        title: item.title,
      })),
      description: `从回收站恢复全部项目，共 ${result.count} 个`,
      metadata: {
        count: result.count,
      },
    });

    return response.ok({
      data: {
        restored: result.count,
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 恢复全部项目失败:", error);
    return response.serverError({
      message: "恢复失败，请稍后重试",
    });
  }
}

export async function clearRecycleBin(
  params: ClearRecycleBin,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<
    ApiResponse<{
      deleted: number;
      byType: Array<{
        resourceType: RecycleBinResourceType;
        count: number;
      }>;
    } | null>
  >
>;
export async function clearRecycleBin(
  params?: ClearRecycleBin,
  serverConfig?: ActionConfig,
): Promise<
  ApiResponse<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
>;
export async function clearRecycleBin(
  { access_token, resourceTypes }: ClearRecycleBin = {},
  serverConfig?: ActionConfig,
): Promise<
  ActionResult<{
    deleted: number;
    byType: Array<{
      resourceType: RecycleBinResourceType;
      count: number;
    }>;
  } | null>
> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "clearRecycleBin"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      resourceTypes,
    },
    ClearRecycleBinSchema,
  );
  if (validationError) {
    return response.badRequest(validationError);
  }

  const user = await authVerify({
    allowedRoles: ADMIN_PANEL_ROLES,
    accessToken: access_token,
  });
  if (!user) {
    return response.unauthorized();
  }

  try {
    const effectiveResourceTypes = normalizeRequestedResourceTypes(
      user.role as UserRole,
      resourceTypes,
    );
    if (effectiveResourceTypes.length === 0) {
      return response.forbidden({
        message: "当前角色无权清空所选回收站资源",
      });
    }

    const effectiveTypeSet = new Set(effectiveResourceTypes);
    const counter = createTypeCounter();

    if (effectiveTypeSet.has("PROJECT")) {
      const rows = await prisma.project.findMany({
        where: {
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.project.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.PROJECT = result.count;
        collectProjectCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "PROJECT",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          newValue: null,
          description: `清空回收站中的项目，共 ${result.count} 个`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("FRIEND_LINK")) {
      const rows = await prisma.friendLink.findMany({
        where: {
          deletedAt: { not: null },
        },
        select: {
          id: true,
          name: true,
          url: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.friendLink.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.FRIEND_LINK = result.count;
        invalidateFriendLinkCache();
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "FRIEND_LINK",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `清空回收站中的友情链接，共 ${result.count} 条`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("POST")) {
      const rows = await prisma.post.findMany({
        where: {
          deletedAt: { not: null },
          ...(user.role === "AUTHOR" ? { userUid: user.uid } : {}),
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          tags: { select: { slug: true } },
          categories: { select: { fullSlug: true } },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.post.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.POST = result.count;
        collectPostCacheTags(rows);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "POST",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            slug: item.slug,
            title: item.title,
          })),
          newValue: null,
          description: `清空回收站中的文章，共 ${result.count} 篇`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("PAGE")) {
      const rows = await prisma.page.findMany({
        where: {
          deletedAt: { not: null },
        },
        select: {
          id: true,
          slug: true,
          title: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.page.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.PAGE = result.count;
        invalidatePageCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "PAGE",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `清空回收站中的页面，共 ${result.count} 个`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("COMMENT")) {
      const rows = await prisma.comment.findMany({
        where: {
          deletedAt: { not: null },
          ...(user.role === "AUTHOR"
            ? {
                OR: [{ userUid: user.uid }, { post: { userUid: user.uid } }],
              }
            : {}),
        },
        select: {
          id: true,
          content: true,
          post: {
            select: {
              slug: true,
            },
          },
          page: {
            select: {
              slug: true,
            },
          },
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.comment.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.COMMENT = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "COMMENT",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            postSlug: resolveCommentResourceReference(item),
            content: summarizeText(item.content, 80),
          })),
          newValue: null,
          description: `清空回收站中的评论，共 ${result.count} 条`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("USER")) {
      const rows = await prisma.user.findMany({
        where: {
          deletedAt: { not: null },
        },
        select: {
          uid: true,
          username: true,
          nickname: true,
          email: true,
        },
      });
      const ids = rows.map((item) => item.uid);
      if (ids.length > 0) {
        const result = await prisma.user.deleteMany({
          where: { uid: { in: ids }, deletedAt: { not: null } },
        });
        counter.USER = result.count;
        invalidateUserCache(ids);
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "USER",
          resourceId: ids.join(","),
          oldValue: rows,
          newValue: null,
          description: `清空回收站中的用户，共 ${result.count} 个`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    if (effectiveTypeSet.has("MESSAGE")) {
      const rows = await prisma.message.findMany({
        where: {
          deletedAt: { not: null },
        },
        select: {
          id: true,
          content: true,
          conversationId: true,
        },
      });
      const ids = rows.map((item) => item.id);
      if (ids.length > 0) {
        const result = await prisma.message.deleteMany({
          where: { id: { in: ids }, deletedAt: { not: null } },
        });
        counter.MESSAGE = result.count;
        await safeLogAuditEvent({
          userUid: user.uid,
          action: "PURGE_ALL",
          resourceType: "MESSAGE",
          resourceId: ids.join(","),
          oldValue: rows.map((item) => ({
            id: item.id,
            conversationId: item.conversationId,
            content: summarizeText(item.content, 80),
          })),
          newValue: null,
          description: `清空回收站中的私信，共 ${result.count} 条`,
          metadata: {
            count: result.count,
            ids: ids.join(","),
          },
        });
      }
    }

    const deleted = RESOURCE_TYPES.reduce(
      (sum, resourceType) => sum + counter[resourceType],
      0,
    );

    return response.ok({
      data: {
        deleted,
        byType: toByTypeResult(counter),
      },
    });
  } catch (error) {
    console.error("[RecycleBin] 清空回收站失败:", error);
    return response.serverError({
      message: "清空回收站失败",
    });
  }
}
