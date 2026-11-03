import "server-only";

import type {
  ApiResponse,
  ApiResponseData,
} from "@repo/shared-types/api/common";
import type {
  GetSearchIndexStats,
  GetSearchLogStats,
  SearchIndexStatsResult,
  SearchLogDailyTrend,
  SearchLogStatsResult,
} from "@repo/shared-types/api/search";
import { GetSearchLogStatsSchema } from "@repo/shared-types/api/search";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";

import { authVerify } from "@/lib/server/auth-verify";
import { generateCacheKey } from "@/lib/server/cache";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import ResponseBuilder from "@/lib/server/response";
import { getLocalDateString } from "@/lib/server/search";
import { validateData } from "@/lib/server/validator";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/*
  getSearchIndexStats - 获取搜索索引统计信息
*/
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchIndexStatsResult | null>>>;
export async function getSearchIndexStats(
  params: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchIndexStatsResult | null>>;
export async function getSearchIndexStats(
  { force = false }: Omit<GetSearchIndexStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchIndexStatsResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getSearchIndexStats"))) {
    return response.tooManyRequests();
  }

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 缓存键
    const cacheKey = generateCacheKey("stat", "search", "index");

    // 如果不强制刷新，先尝试从缓存获取
    if (!force) {
      const { getCache } = await import("@/lib/server/cache");
      const cached = await getCache<SearchIndexStatsResult>(cacheKey);
      if (cached) {
        // 标记为来自缓存，并确保 topWords 字段存在（向后兼容）
        return response.ok({
          data: {
            ...cached,
            cached: true,
            topWords: cached.topWords || [],
          },
        });
      }
    }

    // 1. 获取总文章数
    const totalPosts = await prisma.post.count({
      where: { deletedAt: null },
    });

    // 2. 统计各种状态的文章数量
    const posts = await prisma.post.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        updatedAt: true,
        tokenizedAt: true,
      },
    });

    let upToDatePosts = 0;
    let outdatedPosts = 0;
    let neverIndexedPosts = 0;

    for (const post of posts) {
      if (!post.tokenizedAt) {
        neverIndexedPosts++;
      } else if (post.tokenizedAt < post.updatedAt) {
        outdatedPosts++;
      } else {
        upToDatePosts++;
      }
    }

    const indexedPosts = upToDatePosts + outdatedPosts;

    // 3. 统计词元数和索引体积
    const postIds = posts.filter((p) => p.tokenizedAt).map((p) => p.id);

    let totalTokenCount = 0;
    let totalTokenSize = 0;
    let topWords: Array<{ word: string; count: number }> = [];

    if (postIds.length > 0) {
      const tokenData = await prisma.$queryRaw<
        Array<{
          titleSearchVector: string | null;
          contentSearchVector: string | null;
        }>
      >`SELECT "titleSearchVector"::text as "titleSearchVector", "contentSearchVector"::text as "contentSearchVector" FROM "Post" WHERE id = ANY(${postIds}::int[])`;

      // 词频统计 Map
      const wordFrequency = new Map<string, number>();

      for (const data of tokenData) {
        const titleSearchVectorStr = data.titleSearchVector || "";
        const contentSearchVectorStr = data.contentSearchVector || "";

        // 计算字节大小
        totalTokenSize +=
          new Blob([titleSearchVectorStr]).size +
          new Blob([contentSearchVectorStr]).size;

        // 计算词元数并统计词频
        const titleTokenMatches = titleSearchVectorStr.match(/'[^']+'/g) || [];
        const contentTokenMatches =
          contentSearchVectorStr.match(/'[^']+'/g) || [];
        totalTokenCount +=
          titleTokenMatches.length + contentTokenMatches.length;

        // 提取词元并统计频率（标题和内容合并统计）
        const allMatches = [
          ...titleSearchVectorStr.matchAll(/'([^']+)':([\d,]+)/g),
          ...contentSearchVectorStr.matchAll(/'([^']+)':([\d,]+)/g),
        ];

        for (const match of allMatches) {
          if (match[1] && match[2]) {
            const word = match[1];
            // 只统计长度大于1的词（过滤单字）
            if (word.length > 1) {
              const positions = match[2].split(",");
              const count = positions.length; // 该词在这篇文章中出现的次数
              wordFrequency.set(word, (wordFrequency.get(word) || 0) + count);
            }
          }
        }
      }

      // 获取 Top 500 高频词
      topWords = Array.from(wordFrequency.entries())
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);
    }

    // 4. 统计近期索引活动
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const recentIndexed7Days = await prisma.post.count({
      where: {
        deletedAt: null,
        tokenizedAt: {
          gte: sevenDaysAgo,
        },
      },
    });

    const recentIndexed30Days = await prisma.post.count({
      where: {
        deletedAt: null,
        tokenizedAt: {
          gte: thirtyDaysAgo,
        },
      },
    });

    // 5. 获取自定义词典数量
    const customWordCount = await prisma.customDictionary.count();

    // 6. 计算平均值和比率
    const avgTokenCount = indexedPosts > 0 ? totalTokenCount / indexedPosts : 0;
    const avgTokenSize = indexedPosts > 0 ? totalTokenSize / indexedPosts : 0;
    const indexRate = totalPosts > 0 ? (indexedPosts / totalPosts) * 100 : 0;
    const upToDateRate =
      indexedPosts > 0 ? (upToDatePosts / indexedPosts) * 100 : 0;

    // 7. 构建统计结果
    const stats: SearchIndexStatsResult = {
      totalPosts,
      indexedPosts,
      upToDatePosts,
      outdatedPosts,
      neverIndexedPosts,
      totalTokenCount,
      totalTokenSize,
      avgTokenCount: Math.round(avgTokenCount),
      avgTokenSize: Math.round(avgTokenSize),
      recentIndexed7Days,
      recentIndexed30Days,
      customWordCount,
      indexRate: Math.round(indexRate * 100) / 100,
      upToDateRate: Math.round(upToDateRate * 100) / 100,
      topWords,
      cached: false,
      generatedAt: new Date().toISOString(),
    };

    // 8. 缓存统计结果（1小时）
    const { setCache } = await import("@/lib/server/cache");
    await setCache(cacheKey, stats, { ttl: 3600 });

    return response.ok({ data: stats });
  } catch (error) {
    console.error("获取搜索索引统计失败:", error);
    return response.serverError({ message: "获取搜索索引统计失败" });
  }
}

/*
  getSearchLogStats - 获取搜索日志统计信息
*/
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<ApiResponse<SearchLogStatsResult | null>>>;
export async function getSearchLogStats(
  params: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ApiResponse<SearchLogStatsResult | null>>;
export async function getSearchLogStats(
  { days = 30, force = false }: Omit<GetSearchLogStats, "access_token">,
  serverConfig?: ActionConfig,
): Promise<ActionResult<SearchLogStatsResult | null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  if (!(await limitControl(await headers(), "getSearchLogStats"))) {
    return response.tooManyRequests();
  }

  const validationError = validateData(
    { days, force },
    GetSearchLogStatsSchema.omit({ access_token: true }),
  );

  if (validationError) return response.badRequest(validationError);

  // 从 cookies 获取 access token
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const access_token = cookieStore.get("ACCESS_TOKEN")?.value;

  if (!access_token) {
    return response.unauthorized({ message: "请先登录" });
  }

  // 身份验证 - 仅管理员和编辑可以查看
  const user = await authVerify({
    allowedRoles: ["ADMIN", "EDITOR"],
    accessToken: access_token,
  });

  if (!user) {
    return response.unauthorized();
  }

  try {
    // 缓存键
    const cacheKey = generateCacheKey("stat", "search", "log", days);

    // 如果不强制刷新，先尝试从缓存获取
    if (!force) {
      const { getCache } = await import("@/lib/server/cache");
      const cached = await getCache<SearchLogStatsResult>(cacheKey);
      if (cached) {
        return response.ok({
          data: {
            ...cached,
            cached: true,
          },
        });
      }
    }

    // 计算日期范围
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);
    now.setHours(23, 59, 59, 999);

    // 1. 获取日期范围内的所有搜索日志
    const searchLogs = await prisma.searchLog.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: now,
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // 2. 统计基础数据
    const totalSearches = searchLogs.length;
    const uniqueQueriesSet = new Set(searchLogs.map((log) => log.query));
    const uniqueQueries = uniqueQueriesSet.size;

    const totalResultCount = searchLogs.reduce(
      (sum, log) => sum + log.resultCount,
      0,
    );
    const avgResultCount =
      totalSearches > 0 ? totalResultCount / totalSearches : 0;

    const zeroResultCount = searchLogs.filter(
      (log) => log.resultCount === 0,
    ).length;
    const zeroResultRate =
      totalSearches > 0 ? (zeroResultCount / totalSearches) * 100 : 0;

    const totalDuration = searchLogs.reduce(
      (sum, log) => sum + (log.durationMs || 0),
      0,
    );
    const durationCount = searchLogs.filter(
      (log) => log.durationMs !== null,
    ).length;
    const avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;

    // 3. 按日期分组统计
    const dailyMap = new Map<string, SearchLogDailyTrend>();

    for (const log of searchLogs) {
      const dateKey = getLocalDateString(log.createdAt);

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          searchCount: 0,
          uniqueVisitors: 0,
          zeroResultCount: 0,
          avgDuration: 0,
        });
      }

      const trend = dailyMap.get(dateKey)!;
      trend.searchCount++;
      if (log.resultCount === 0) {
        trend.zeroResultCount++;
      }
    }

    // 4. 计算每日唯一访客数和平均耗时
    for (const [dateKey, trend] of dailyMap.entries()) {
      const dayLogs = searchLogs.filter((log) => {
        const logDateKey = getLocalDateString(log.createdAt);
        return logDateKey === dateKey;
      });
      // 统计唯一的 visitorId（排除 null 值）
      const uniqueVisitorsSet = new Set(
        dayLogs
          .filter((log) => log.visitorId !== null)
          .map((log) => log.visitorId),
      );
      trend.uniqueVisitors = uniqueVisitorsSet.size;

      const dayDuration = dayLogs.reduce(
        (sum, log) => sum + (log.durationMs || 0),
        0,
      );
      const dayDurationCount = dayLogs.filter(
        (log) => log.durationMs !== null,
      ).length;
      trend.avgDuration =
        dayDurationCount > 0 ? dayDuration / dayDurationCount : 0;
    }

    // 5. 填充缺失的日期
    const dailyTrend: SearchLogDailyTrend[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateKey = getLocalDateString(currentDate);
      dailyTrend.push(
        dailyMap.get(dateKey) || {
          date: dateKey,
          searchCount: 0,
          uniqueVisitors: 0,
          zeroResultCount: 0,
          avgDuration: 0,
        },
      );
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // 6. 统计热门搜索词（原始搜索词）
    const queryFrequency = new Map<string, number>();
    for (const log of searchLogs) {
      queryFrequency.set(log.query, (queryFrequency.get(log.query) || 0) + 1);
    }

    const topQueries = Array.from(queryFrequency.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    // 7. 统计热门分词（token 频率统计）
    // 对每次搜索的 token 去重，防止单次搜索中的重复 token 影响统计
    const tokenFrequency = new Map<string, number>();
    for (const log of searchLogs) {
      // 先对本次搜索的 tokens 去重
      const uniqueTokens = new Set(log.tokens);
      // 然后遍历去重后的 tokens 进行统计
      for (const token of uniqueTokens) {
        tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      }
    }

    const topTokens = Array.from(tokenFrequency.entries())
      .map(([token, count]) => ({ token, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    // 8. 统计无结果热门词
    const zeroResultQueryFrequency = new Map<string, number>();
    for (const log of searchLogs.filter((l) => l.resultCount === 0)) {
      zeroResultQueryFrequency.set(
        log.query,
        (zeroResultQueryFrequency.get(log.query) || 0) + 1,
      );
    }

    const topZeroResultQueries = Array.from(zeroResultQueryFrequency.entries())
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // 9. 构建统计结果
    const stats: SearchLogStatsResult = {
      totalSearches,
      uniqueQueries,
      avgResultCount: Math.round(avgResultCount * 100) / 100,
      zeroResultRate: Math.round(zeroResultRate * 100) / 100,
      avgDuration: Math.round(avgDuration),
      dailyTrend,
      topQueries,
      topTokens,
      topZeroResultQueries,
      cached: false,
      generatedAt: new Date().toISOString(),
    };

    // 8. 缓存统计结果（1小时）
    const { setCache } = await import("@/lib/server/cache");
    await setCache(cacheKey, stats, { ttl: 3600 });

    return response.ok({ data: stats });
  } catch (error) {
    console.error("获取搜索日志统计失败:", error);
    return response.serverError({ message: "获取搜索日志统计失败" });
  }
}
