import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetPagesStats,
  GetPagesStatsSuccessResponse,
} from "@repo/shared-types/api/page";
import { GetPagesStatsSchema } from "@repo/shared-types/api/page";
import type {
  GetAuditStats,
  GetAuditStatsSuccessResponse,
  GetCategoriesStats,
  GetCategoriesStatsSuccessResponse,
  GetPostsStats,
  GetPostsStatsSuccessResponse,
  GetProjectsStats,
  GetProjectsStatsSuccessResponse,
  GetTagsStats,
  GetTagsStatsSuccessResponse,
  GetUsersStats,
  GetUsersStatsSuccessResponse,
  GetVisitStats,
  GetVisitStatsSuccessResponse,
} from "@repo/shared-types/api/stats";
import {
  GetAuditStatsSchema,
  GetCategoriesStatsSchema,
  GetPostsStatsSchema,
  GetProjectsStatsSchema,
  GetTagsStatsSchema,
  GetUsersStatsSchema,
  GetVisitStatsSchema,
} from "@repo/shared-types/api/stats";
import type {
  GetStorageStats,
  GetStorageStatsSuccessResponse,
} from "@repo/shared-types/api/storage";
import { GetStorageStatsSchema } from "@repo/shared-types/api/storage";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import { generateCacheKey, getCache, setCache } from "@/lib/server/cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

export async function getUsersStats(
  params: GetUsersStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetUsersStatsSuccessResponse["data"]>>>;
export async function getUsersStats(
  params: GetUsersStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetUsersStatsSuccessResponse["data"]>>;
export async function getUsersStats(
  { access_token, force }: GetUsersStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetUsersStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "getUsersStats"))) {
    return response.tooManyRequests();
  }
  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetUsersStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "users");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetUsersStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 使用一次原生 SQL 查询获取所有统计数据
    // 优化：从 7 次查询减少到 1 次查询
    const stats = await prisma.$queryRaw<
      Array<{
        role: string;
        total_count: bigint;
        active_1d: bigint;
        active_7d: bigint;
        active_30d: bigint;
        new_1d: bigint;
        new_7d: bigint;
        new_30d: bigint;
      }>
    >`
      SELECT
        role,
        COUNT(*) as total_count,
        COUNT(CASE WHEN "lastUseAt" >= ${oneDayAgo} THEN 1 END) as active_1d,
        COUNT(CASE WHEN "lastUseAt" >= ${sevenDaysAgo} THEN 1 END) as active_7d,
        COUNT(CASE WHEN "lastUseAt" >= ${thirtyDaysAgo} THEN 1 END) as active_30d,
        COUNT(CASE WHEN "createdAt" >= ${oneDayAgo} THEN 1 END) as new_1d,
        COUNT(CASE WHEN "createdAt" >= ${sevenDaysAgo} THEN 1 END) as new_7d,
        COUNT(CASE WHEN "createdAt" >= ${thirtyDaysAgo} THEN 1 END) as new_30d
      FROM "User"
      WHERE "deletedAt" IS NULL
      GROUP BY role
    `;

    // 初始化统计数据
    const total = {
      total: 0,
      user: 0,
      admin: 0,
      editor: 0,
      author: 0,
    };

    let activeLastDay = 0;
    let activeLast7Days = 0;
    let activeLast30Days = 0;
    let newLastDay = 0;
    let newLast7Days = 0;
    let newLast30Days = 0;

    // 聚合统计结果
    stats.forEach((stat) => {
      const count = Number(stat.total_count);
      total.total += count;

      // 按角色分类
      switch (stat.role) {
        case "USER":
          total.user = count;
          break;
        case "ADMIN":
          total.admin = count;
          break;
        case "EDITOR":
          total.editor = count;
          break;
        case "AUTHOR":
          total.author = count;
          break;
      }

      // 累加活跃用户数
      activeLastDay += Number(stat.active_1d);
      activeLast7Days += Number(stat.active_7d);
      activeLast30Days += Number(stat.active_30d);

      // 累加新增用户数
      newLastDay += Number(stat.new_1d);
      newLast7Days += Number(stat.new_7d);
      newLast30Days += Number(stat.new_30d);
    });

    // 构建响应数据
    const data: GetUsersStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total,
      active: {
        lastDay: activeLastDay,
        last7Days: activeLast7Days,
        last30Days: activeLast30Days,
      },
      new: {
        lastDay: newLastDay,
        last7Days: newLast7Days,
        last30Days: newLast30Days,
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetUsersStats error:", error);
    return response.serverError();
  }
}

export async function getAuditStats(
  params: GetAuditStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetAuditStatsSuccessResponse["data"]>>>;
export async function getAuditStats(
  params: GetAuditStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetAuditStatsSuccessResponse["data"]>>;
export async function getAuditStats(
  { access_token, force }: GetAuditStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetAuditStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "getAuditStats"))) {
    return response.tooManyRequests();
  }
  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetAuditStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "audit");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetAuditStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 使用单次查询获取所有统计数据
    const [totalLogs, activeUsers, recentLogs] = await Promise.all([
      // 总日志数
      prisma.auditLog.count(),

      // 活跃用户数（产生过日志的用户数）
      prisma.auditLog.findMany({
        select: { userUid: true },
        distinct: ["userUid"],
      }),

      // 最近的日志数量（按时间段）
      prisma.$queryRaw<
        Array<{
          last_1d: bigint;
          last_7d: bigint;
          last_30d: bigint;
        }>
      >`
        SELECT
          COUNT(CASE WHEN "timestamp" >= ${oneDayAgo} THEN 1 END) as last_1d,
          COUNT(CASE WHEN "timestamp" >= ${sevenDaysAgo} THEN 1 END) as last_7d,
          COUNT(CASE WHEN "timestamp" >= ${thirtyDaysAgo} THEN 1 END) as last_30d
        FROM "AuditLog"
      `,
    ]);

    const recentStats = recentLogs[0];

    // 构建响应数据
    const data: GetAuditStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total: {
        logs: totalLogs,
        activeUsers: activeUsers.length,
      },
      recent: {
        lastDay: Number(recentStats?.last_1d || 0),
        last7Days: Number(recentStats?.last_7d || 0),
        last30Days: Number(recentStats?.last_30d || 0),
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetAuditStats error:", error);
    return response.serverError();
  }
}

export async function getPostsStats(
  params: GetPostsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetPostsStatsSuccessResponse["data"]>>>;
export async function getPostsStats(
  params: GetPostsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetPostsStatsSuccessResponse["data"]>>;
export async function getPostsStats(
  { access_token, force }: GetPostsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetPostsStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "getPostsStats"))) {
    return response.tooManyRequests();
  }
  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetPostsStatsSchema,
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
    const CACHE_KEY = generateCacheKey("stat", "posts");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetPostsStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 使用一次原生 SQL 查询获取所有统计数据
    const stats = await prisma.$queryRaw<
      Array<{
        status: string;
        total_count: bigint;
        new_7d: bigint;
        new_30d: bigint;
        new_1y: bigint;
      }>
    >`
      SELECT
        status,
        COUNT(*) as total_count,
        COUNT(CASE WHEN "createdAt" >= ${sevenDaysAgo} THEN 1 END) as new_7d,
        COUNT(CASE WHEN "createdAt" >= ${thirtyDaysAgo} THEN 1 END) as new_30d,
        COUNT(CASE WHEN "createdAt" >= ${oneYearAgo} THEN 1 END) as new_1y
      FROM "Post"
      WHERE "deletedAt" IS NULL
      GROUP BY status
    `;

    // 初始化统计数据
    const total = {
      total: 0,
      published: 0,
      draft: 0,
      archived: 0,
    };

    let newLast7Days = 0;
    let newLast30Days = 0;
    let newLastYear = 0;

    // 聚合统计结果
    stats.forEach((stat) => {
      const count = Number(stat.total_count);
      total.total += count;

      // 按状态分类
      switch (stat.status) {
        case "PUBLISHED":
          total.published = count;
          break;
        case "DRAFT":
          total.draft = count;
          break;
        case "ARCHIVED":
          total.archived = count;
          break;
      }

      // 累加新增文章数
      newLast7Days += Number(stat.new_7d);
      newLast30Days += Number(stat.new_30d);
      newLastYear += Number(stat.new_1y);
    });

    // 获取最后发布的文章时间和第一篇文章时间
    const [lastPublishedPost, firstPublishedPost] = await Promise.all([
      prisma.post.findFirst({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
        },
        orderBy: {
          publishedAt: "desc",
        },
        select: {
          publishedAt: true,
        },
      }),
      prisma.post.findFirst({
        where: {
          status: "PUBLISHED",
          deletedAt: null,
        },
        orderBy: {
          publishedAt: "asc",
        },
        select: {
          publishedAt: true,
        },
      }),
    ]);

    // 计算平均发布间隔（天）
    let averageDaysBetweenPosts = null;
    if (
      firstPublishedPost?.publishedAt &&
      lastPublishedPost?.publishedAt &&
      total.published > 1
    ) {
      const firstDate = firstPublishedPost.publishedAt.getTime();
      const lastDate = lastPublishedPost.publishedAt.getTime();
      const daysDiff = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
      averageDaysBetweenPosts = daysDiff / (total.published - 1);
    }

    // 构建响应数据
    const data: GetPostsStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total,
      new: {
        last7Days: newLast7Days,
        last30Days: newLast30Days,
        lastYear: newLastYear,
      },
      lastPublished: lastPublishedPost?.publishedAt?.toISOString() || null,
      firstPublished: firstPublishedPost?.publishedAt?.toISOString() || null,
      averageDaysBetweenPosts,
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetPostsStats error:", error);
    return response.serverError();
  }
}

export async function getTagsStats(
  params: GetTagsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetTagsStatsSuccessResponse["data"]>>>;
export async function getTagsStats(
  params: GetTagsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetTagsStatsSuccessResponse["data"]>>;
export async function getTagsStats(
  { access_token, force }: GetTagsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetTagsStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "getTagsStats"))) {
    return response.tooManyRequests();
  }
  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetTagsStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "tags");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetTagsStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 使用一次原生 SQL 查询获取标签统计数据
    const [totalTags, tagsWithPosts, newTagsStats] = await Promise.all([
      // 总标签数
      prisma.tag.count(),

      // 有文章关联的标签数（只统计未删除的文章）
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT pt."B") as count
        FROM "_PostToTag" pt
        INNER JOIN "Post" p ON pt."A" = p.id
        WHERE p."deletedAt" IS NULL
      `,

      // 新增标签统计
      prisma.$queryRaw<
        Array<{
          new_7d: bigint;
          new_30d: bigint;
          new_1y: bigint;
        }>
      >`
        SELECT
          COUNT(CASE WHEN "createdAt" >= ${sevenDaysAgo} THEN 1 END) as new_7d,
          COUNT(CASE WHEN "createdAt" >= ${thirtyDaysAgo} THEN 1 END) as new_30d,
          COUNT(CASE WHEN "createdAt" >= ${oneYearAgo} THEN 1 END) as new_1y
        FROM "Tag"
      `,
    ]);

    const tagsWithPostsCount = Number(tagsWithPosts[0]?.count || 0);
    const newStats = newTagsStats[0];

    // 构建响应数据
    const data: GetTagsStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total: {
        total: totalTags,
        withPosts: tagsWithPostsCount,
        withoutPosts: totalTags - tagsWithPostsCount,
      },
      new: {
        last7Days: Number(newStats?.new_7d || 0),
        last30Days: Number(newStats?.new_30d || 0),
        lastYear: Number(newStats?.new_1y || 0),
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetTagsStats error:", error);
    return response.serverError();
  }
}

export async function getCategoriesStats(
  params: GetCategoriesStats,
  serverConfig: { environment: "serverless" },
): Promise<
  NextResponse<ApiResponse<GetCategoriesStatsSuccessResponse["data"]>>
>;
export async function getCategoriesStats(
  params: GetCategoriesStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetCategoriesStatsSuccessResponse["data"]>>;
export async function getCategoriesStats(
  { access_token, force }: GetCategoriesStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetCategoriesStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );
  if (!(await limitControl(await headers(), "getCategoriesStats"))) {
    return response.tooManyRequests();
  }
  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetCategoriesStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "categories");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<
        GetCategoriesStatsSuccessResponse["data"]
      >(CACHE_KEY, {
        ttl: CACHE_TTL,
      });

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 获取所有分类及其关联信息
    const [
      totalCategories,
      topLevelCategories,
      categoriesWithPosts,
      newCategoriesStats,
    ] = await Promise.all([
      // 总分类数
      prisma.category.count(),

      // 顶级分类数（无父分类）
      prisma.category.count({
        where: {
          parentId: null,
        },
      }),

      // 有文章关联的分类数
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT pc."B") as count
        FROM "_CategoryToPost" pc
        INNER JOIN "Post" p ON pc."A" = p.id
        WHERE p."deletedAt" IS NULL
      `,

      // 新增分类统计
      prisma.$queryRaw<
        Array<{
          new_7d: bigint;
          new_30d: bigint;
          new_1y: bigint;
        }>
      >`
        SELECT
          COUNT(CASE WHEN "createdAt" >= ${sevenDaysAgo} THEN 1 END) as new_7d,
          COUNT(CASE WHEN "createdAt" >= ${thirtyDaysAgo} THEN 1 END) as new_30d,
          COUNT(CASE WHEN "createdAt" >= ${oneYearAgo} THEN 1 END) as new_1y
        FROM "Category"
      `,
    ]);

    const categoriesWithPostsCount = Number(categoriesWithPosts[0]?.count || 0);
    const newStats = newCategoriesStats[0];

    // 获取所有分类以计算深度和热门分类
    const allCategories = await prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        parentId: true,
        _count: {
          select: {
            posts: {
              where: {
                deletedAt: null,
              },
            },
          },
        },
      },
    });

    // 使用 Map 缓存深度计算结果，避免重复计算
    const depthCache = new Map<number, number>();

    const calculateDepth = (
      categoryId: number,
      visited = new Set<number>(),
    ): number => {
      // 检查缓存
      if (depthCache.has(categoryId)) {
        return depthCache.get(categoryId)!;
      }

      // 防止循环引用
      if (visited.has(categoryId)) return 0;
      visited.add(categoryId);

      const category = allCategories.find((c) => c.id === categoryId);
      if (!category || category.parentId === null) {
        depthCache.set(categoryId, 0);
        return 0;
      }

      const depth = 1 + calculateDepth(category.parentId, visited);
      depthCache.set(categoryId, depth);
      return depth;
    };

    let maxDepth = 0;
    let totalDepth = 0;

    for (const category of allCategories) {
      const depth = calculateDepth(category.id);
      if (depth > maxDepth) maxDepth = depth;
      totalDepth += depth;
    }

    const avgDepth =
      allCategories.length > 0 ? totalDepth / allCategories.length : 0;

    // 构建响应数据
    const data: GetCategoriesStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total: {
        total: totalCategories,
        topLevel: topLevelCategories,
        withPosts: categoriesWithPostsCount,
        withoutPosts: totalCategories - categoriesWithPostsCount,
      },
      depth: {
        maxDepth,
        avgDepth,
      },
      new: {
        last7Days: Number(newStats?.new_7d || 0),
        last30Days: Number(newStats?.new_30d || 0),
        lastYear: Number(newStats?.new_1y || 0),
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetCategoriesStats error:", error);
    return response.serverError();
  }
}

export async function getPagesStats(
  params: GetPagesStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetPagesStatsSuccessResponse["data"]>>>;
export async function getPagesStats(
  params: GetPagesStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetPagesStatsSuccessResponse["data"]>>;
export async function getPagesStats(
  { access_token, force }: GetPagesStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetPagesStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getPagesStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetPagesStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 验证用户身份（仅管理员）
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized({ message: "需要管理员权限" });
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "pages");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetPagesStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 获取页面统计数据
    const [totalStats, statusStats, systemPageStats] = await Promise.all([
      // 总数统计
      prisma.page.count({
        where: {
          deletedAt: null,
        },
      }),
      // 状态统计
      prisma.page.groupBy({
        by: ["status"],
        where: {
          deletedAt: null,
        },
        _count: {
          status: true,
        },
      }),
      // 系统页面统计
      prisma.page.groupBy({
        by: ["isSystemPage"],
        where: {
          deletedAt: null,
        },
        _count: {
          isSystemPage: true,
        },
      }),
    ]);

    // 统计各状态数量
    const statusCounts = statusStats.reduce(
      (acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      },
      {} as Record<string, number>,
    );

    // 统计系统/自定义页面数量
    const systemCounts = systemPageStats.reduce(
      (acc, item) => {
        acc[item.isSystemPage ? "system" : "custom"] = item._count.isSystemPage;
        return acc;
      },
      {} as Record<string, number>,
    );

    const now = new Date();
    const statsData = {
      updatedAt: now.toISOString(),
      cache: false, // 实时查询
      total: {
        total: totalStats,
        active: statusCounts.ACTIVE || 0,
        suspended: statusCounts.SUSPENDED || 0,
        system: systemCounts.system || 0,
        custom: systemCounts.custom || 0,
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...statsData, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data: statsData,
    });
  } catch (error) {
    console.error("获取页面统计失败:", error);
    return response.serverError({ message: "获取页面统计失败" });
  }
}

export async function getStorageStats(
  params: GetStorageStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetStorageStatsSuccessResponse["data"]>>>;
export async function getStorageStats(
  params: GetStorageStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetStorageStatsSuccessResponse["data"]>>;
export async function getStorageStats(
  { access_token, force }: GetStorageStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetStorageStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getStorageStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetStorageStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "storage");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetStorageStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    const now = new Date();

    // 使用原生 SQL 查询获取所有存储统计数据
    const [storageStats, mediaStats] = await Promise.all([
      // 存储提供商统计
      prisma.$queryRaw<
        Array<{
          type: string;
          total_count: bigint;
          active_count: bigint;
          default_count: bigint;
        }>
      >`
        SELECT
          type,
          COUNT(*) as total_count,
          COUNT(CASE WHEN "isActive" = true THEN 1 END) as active_count,
          COUNT(CASE WHEN "isDefault" = true THEN 1 END) as default_count
        FROM "StorageProvider"
        GROUP BY type
      `,

      // 媒体文件统计
      prisma.$queryRaw<
        Array<{
          storage_provider_type: string;
          media_count: bigint;
          total_size: bigint;
          average_size: bigint;
        }>
      >`
        SELECT
          sp.type as storage_provider_type,
          COUNT(m.id) as media_count,
          COALESCE(SUM(m.size), 0) as total_size,
          COALESCE(AVG(m.size), 0) as average_size
        FROM "StorageProvider" sp
        LEFT JOIN "Media" m ON sp.id = m."storageProviderId"
        GROUP BY sp.type
        ORDER BY sp.type
      `,
    ]);

    // 计算总计数据
    const totalStats = {
      total: 0,
      active: 0,
      inactive: 0,
      default: 0,
    };

    // 构建 byType 数据
    const byType: Array<{
      type:
        | "LOCAL"
        | "AWS_S3"
        | "GITHUB_PAGES"
        | "VERCEL_BLOB"
        | "EXTERNAL_URL";
      count: number;
      active: number;
      mediaCount: number;
    }> = [];

    // 创建媒体统计映射
    const mediaStatsMap = new Map(
      mediaStats.map((stat) => [
        stat.storage_provider_type,
        {
          mediaCount: Number(stat.media_count),
          totalSize: Number(stat.total_size),
        },
      ]),
    );

    // 聚合存储统计结果
    storageStats.forEach((stat) => {
      const totalCount = Number(stat.total_count);
      const activeCount = Number(stat.active_count);
      const defaultCount = Number(stat.default_count);

      totalStats.total += totalCount;
      totalStats.active += activeCount;
      totalStats.inactive += totalCount - activeCount;
      totalStats.default += defaultCount;

      const mediaInfo = mediaStatsMap.get(stat.type) || {
        mediaCount: 0,
        totalSize: 0,
      };

      byType.push({
        type: stat.type as
          | "LOCAL"
          | "AWS_S3"
          | "GITHUB_PAGES"
          | "VERCEL_BLOB"
          | "EXTERNAL_URL",
        count: totalCount,
        active: activeCount,
        mediaCount: mediaInfo.mediaCount,
      });
    });

    // 计算存储统计数据
    const storage = {
      totalProviders: totalStats.total,
      activeProviders: totalStats.active,
      totalMediaFiles: Array.from(mediaStatsMap.values()).reduce(
        (sum, info) => sum + info.mediaCount,
        0,
      ),
      averageFileSize:
        Array.from(mediaStatsMap.values()).length > 0
          ? Array.from(mediaStatsMap.values()).reduce(
              (sum, info) => sum + info.totalSize,
              0,
            ) /
            Array.from(mediaStatsMap.values()).reduce(
              (sum, info) => sum + info.mediaCount,
              1,
            )
          : 0,
    };

    // 构建响应数据
    const data: GetStorageStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total: totalStats,
      byType,
      storage,
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetStorageStats error:", error);
    return response.serverError({ message: "获取存储统计失败" });
  }
}

export async function getVisitStats(
  params: GetVisitStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetVisitStatsSuccessResponse["data"]>>>;
export async function getVisitStats(
  params: GetVisitStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetVisitStatsSuccessResponse["data"]>>;
export async function getVisitStats(
  { access_token, force }: GetVisitStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetVisitStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getVisitStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetVisitStatsSchema,
  );

  if (validationError) return response.badRequest(validationError);

  // 身份验证
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "visit");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<GetVisitStatsSuccessResponse["data"]>(
        CACHE_KEY,
        {
          ttl: CACHE_TTL,
        },
      );

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7DaysStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30DaysStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 使用数据库聚合查询替代将所有数据加载到内存
    const [
      last24hAgg,
      totalPageViews,
      totalVisitorsAgg,
      totalArchive,
      last7DaysAgg,
      last7DaysArchive,
      last30DaysAgg,
      last30DaysArchive,
    ] = await Promise.all([
      // 最近24小时聚合统计
      prisma.$queryRaw<
        Array<{
          total_views: bigint;
          unique_visitors: bigint;
        }>
      >`
        SELECT
          COUNT(*) as total_views,
          COUNT(DISTINCT "visitorId") as unique_visitors
        FROM "PageView"
        WHERE "timestamp" >= ${last24Hours}
          AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      `,

      // 精确数据的总数
      prisma.pageView.count({
        where: {
          OR: [{ deviceType: { not: "bot" } }, { deviceType: null }],
        },
      }),

      // 总独立访客数
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT "visitorId") as count
        FROM "PageView"
        WHERE ("deviceType" IS NULL OR "deviceType" <> 'bot')
      `,

      // 所有归档数据
      prisma.pageViewArchive.aggregate({
        _sum: {
          totalViews: true,
          uniqueVisitors: true,
        },
      }),

      // 最近7天精确数据聚合
      prisma.$queryRaw<
        Array<{
          total_views: bigint;
          unique_visitors: bigint;
        }>
      >`
        SELECT
          COUNT(*) as total_views,
          COUNT(DISTINCT "visitorId") as unique_visitors
        FROM "PageView"
        WHERE "timestamp" >= ${last7DaysStart}
          AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      `,

      // 最近7天归档数据
      prisma.pageViewArchive.aggregate({
        where: {
          date: {
            gte: last7DaysStart,
          },
        },
        _sum: {
          totalViews: true,
          uniqueVisitors: true,
        },
      }),

      // 最近30天精确数据聚合
      prisma.$queryRaw<
        Array<{
          total_views: bigint;
          unique_visitors: bigint;
        }>
      >`
        SELECT
          COUNT(*) as total_views,
          COUNT(DISTINCT "visitorId") as unique_visitors
        FROM "PageView"
        WHERE "timestamp" >= ${last30DaysStart}
          AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      `,

      // 最近30天归档数据
      prisma.pageViewArchive.aggregate({
        where: {
          date: {
            gte: last30DaysStart,
          },
        },
        _sum: {
          totalViews: true,
          uniqueVisitors: true,
        },
      }),
    ]);

    const uniqueVisitors24h = Number(last24hAgg[0]?.unique_visitors ?? 0);
    const totalViews24h = Number(last24hAgg[0]?.total_views ?? 0);

    // 计算会话/跳出率：使用数据库分组查询而非全量加载
    const sessionData = await prisma.$queryRaw<
      Array<{
        visitorId: string;
        view_count: bigint;
        first_view: Date;
        last_view: Date;
      }>
    >`
      SELECT
        "visitorId",
        COUNT(*) as view_count,
        MIN("timestamp") as first_view,
        MAX("timestamp") as last_view
      FROM "PageView"
      WHERE "timestamp" >= ${last24Hours}
        AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      GROUP BY "visitorId"
    `;

    let totalSessions24h = 0;
    let bounces24h = 0;
    let totalDuration24h = 0;
    let sessionsWithDuration24h = 0;

    // 简化会话计算：每个访客至少算一个会话
    for (const visitor of sessionData) {
      const viewCount = Number(visitor.view_count);
      totalSessions24h++;

      if (viewCount === 1) {
        bounces24h++;
      } else {
        const duration =
          visitor.last_view.getTime() - visitor.first_view.getTime();
        totalDuration24h += duration;
        sessionsWithDuration24h++;
      }
    }

    const bounceRate24h =
      totalSessions24h > 0 ? (bounces24h / totalSessions24h) * 100 : 0;
    const averageDuration24h =
      sessionsWithDuration24h > 0
        ? Math.round(totalDuration24h / sessionsWithDuration24h / 1000)
        : 0;

    // 合并精确数据和归档数据
    const totalVisitorsFromDb = Number(totalVisitorsAgg[0]?.count ?? 0);
    const totalViewsCount =
      totalPageViews + (totalArchive._sum.totalViews || 0);
    const totalVisitorsCount =
      totalVisitorsFromDb + (totalArchive._sum.uniqueVisitors || 0);

    const last7DaysViewsCount =
      Number(last7DaysAgg[0]?.total_views ?? 0) +
      (last7DaysArchive._sum.totalViews || 0);
    const last7DaysVisitorsCount =
      Number(last7DaysAgg[0]?.unique_visitors ?? 0) +
      (last7DaysArchive._sum.uniqueVisitors || 0);

    const last30DaysViewsCount =
      Number(last30DaysAgg[0]?.total_views ?? 0) +
      (last30DaysArchive._sum.totalViews || 0);
    const last30DaysVisitorsCount =
      Number(last30DaysAgg[0]?.unique_visitors ?? 0) +
      (last30DaysArchive._sum.uniqueVisitors || 0);

    // 获取第一条记录的日期来计算平均值
    const firstRecord = await prisma.pageViewArchive.findFirst({
      orderBy: {
        date: "asc",
      },
      select: {
        date: true,
      },
    });

    const firstPageView = await prisma.pageView.findFirst({
      where: {
        OR: [{ deviceType: { not: "bot" } }, { deviceType: null }],
      },
      orderBy: {
        timestamp: "asc",
      },
      select: {
        timestamp: true,
      },
    });

    // 计算总天数（从第一条记录到现在）
    let totalDays = 1;
    if (firstRecord || firstPageView) {
      const earliestDate = [firstRecord?.date, firstPageView?.timestamp].filter(
        Boolean,
      ) as Date[];

      if (earliestDate.length > 0) {
        const earliest = new Date(
          Math.min(...earliestDate.map((d) => d.getTime())),
        );
        totalDays = Math.max(
          1,
          Math.ceil(
            (now.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24),
          ),
        );
      }
    }

    // 构建响应数据
    const data: GetVisitStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      last24Hours: {
        visitors: uniqueVisitors24h,
        views: totalViews24h,
        averageDuration: Math.round(averageDuration24h),
        bounceRate: Math.round(bounceRate24h * 10) / 10,
      },
      totalViews: {
        total: totalViewsCount,
        last7Days: last7DaysViewsCount,
        last30Days: last30DaysViewsCount,
        averagePerDay: Math.round((totalViewsCount / totalDays) * 10) / 10,
      },
      totalVisitors: {
        total: totalVisitorsCount,
        last7Days: last7DaysVisitorsCount,
        last30Days: last30DaysVisitorsCount,
        averagePerDay: Math.round((totalVisitorsCount / totalDays) * 10) / 10,
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetVisitStats error:", error);
    return response.serverError({ message: "获取访问统计失败" });
  }
}

export async function getProjectsStats(
  params: GetProjectsStats,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<GetProjectsStatsSuccessResponse["data"]>>>;
export async function getProjectsStats(
  params: GetProjectsStats,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<GetProjectsStatsSuccessResponse["data"]>>;
export async function getProjectsStats(
  { access_token, force }: GetProjectsStats,
  serverConfig?: ActionConfig,
): Promise<ActionResult<GetProjectsStatsSuccessResponse["data"] | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getProjectsStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    {
      access_token,
      force,
    },
    GetProjectsStatsSchema,
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
    const CACHE_KEY = generateCacheKey("stat", "projects");
    const CACHE_TTL = 60 * 60; // 1小时

    // 如果不是强制刷新，尝试从缓存获取
    if (!force) {
      const cachedData = await getCache<
        GetProjectsStatsSuccessResponse["data"]
      >(CACHE_KEY, {
        ttl: CACHE_TTL,
      });

      if (cachedData) {
        return response.ok({
          data: cachedData,
        });
      }
    }

    // 计算时间边界
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // 使用原生 SQL 查询获取所有统计数据
    const stats = await prisma.$queryRaw<
      Array<{
        status: string;
        total_count: bigint;
        new_7d: bigint;
        new_30d: bigint;
        new_1y: bigint;
      }>
    >`
      SELECT
        status,
        COUNT(*) as total_count,
        COUNT(CASE WHEN "createdAt" >= ${sevenDaysAgo} THEN 1 END) as new_7d,
        COUNT(CASE WHEN "createdAt" >= ${thirtyDaysAgo} THEN 1 END) as new_30d,
        COUNT(CASE WHEN "createdAt" >= ${oneYearAgo} THEN 1 END) as new_1y
      FROM "Project"
      WHERE "deletedAt" IS NULL
      GROUP BY status
    `;

    // 初始化统计数据
    const total = {
      total: 0,
      published: 0,
      draft: 0,
      archived: 0,
      developing: 0,
    };

    let newLast7Days = 0;
    let newLast30Days = 0;
    let newLastYear = 0;

    // 聚合统计结果
    stats.forEach((stat) => {
      const count = Number(stat.total_count);
      total.total += count;

      // 按状态分类
      switch (stat.status) {
        case "PUBLISHED":
          total.published = count;
          break;
        case "DRAFT":
          total.draft = count;
          break;
        case "ARCHIVED":
          total.archived = count;
          break;
        case "Developing":
          total.developing = count;
          break;
      }

      // 累加新增项目数
      newLast7Days += Number(stat.new_7d);
      newLast30Days += Number(stat.new_30d);
      newLastYear += Number(stat.new_1y);
    });

    // 获取 GitHub 相关统计
    const githubStats = await prisma.$queryRaw<
      Array<{
        sync_enabled: bigint;
        total_stars: bigint;
        total_forks: bigint;
      }>
    >`
      SELECT
        COUNT(CASE WHEN "enableGithubSync" = true THEN 1 END) as sync_enabled,
        COALESCE(SUM(stars), 0) as total_stars,
        COALESCE(SUM(forks), 0) as total_forks
      FROM "Project"
      WHERE "deletedAt" IS NULL
    `;

    const githubData = githubStats[0];

    // 构建响应数据
    const data: GetProjectsStatsSuccessResponse["data"] = {
      updatedAt: now.toISOString(),
      cache: false,
      total,
      github: {
        syncEnabled: Number(githubData?.sync_enabled || 0),
        totalStars: Number(githubData?.total_stars || 0),
        totalForks: Number(githubData?.total_forks || 0),
      },
      new: {
        last7Days: newLast7Days,
        last30Days: newLast30Days,
        lastYear: newLastYear,
      },
    };

    // 保存到缓存（缓存1小时）
    const cacheData = { ...data, cache: true };
    const { after } = await import("next/server");
    after(async () => {
      await setCache(CACHE_KEY, cacheData, {
        ttl: CACHE_TTL,
      });
    });

    return response.ok({
      data,
    });
  } catch (error) {
    console.error("GetProjectsStats error:", error);
    return response.serverError({ message: "获取项目统计失败" });
  }
}
