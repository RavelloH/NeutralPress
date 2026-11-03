import "server-only";

import type { ApiResponse } from "@repo/shared-types/api/common";
import type {
  BanIP,
  ClearRateLimit,
  EndpointStat,
  GetEndpointStats,
  GetIPList,
  GetRequestTrends,
  GetSecurityOverview,
  IPInfo,
  RequestTrendItem,
  SecurityOverviewData,
  UnbanIP,
} from "@repo/shared-types/api/security";
import {
  BanIPSchema,
  ClearRateLimitSchema,
  GetEndpointStatsSchema,
  GetIPListSchema,
  GetRequestTrendsSchema,
  GetSecurityOverviewSchema,
  UnbanIPSchema,
} from "@repo/shared-types/api/security";
import { headers } from "next/headers";

import { logAuditEvent } from "@/lib/server/audit";
import { authVerify } from "@/lib/server/auth-verify";
import { generateCacheKey, getCache, setCache } from "@/lib/server/cache";
import { resolveIpLocation } from "@/lib/server/ip-utils";
import limitControl from "@/lib/server/rate-limit";
import { RATE_LIMITS } from "@/lib/server/rate-limit";
import redis, { ensureRedisConnection } from "@/lib/server/redis";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

/**
 * 使用 SCAN 替代 KEYS 命令，避免阻塞 Redis
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      200,
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

/**
 * 获取安全概览数据
 */
export async function getSecurityOverview(
  params: GetSecurityOverview = {},
): Promise<ApiResponse<SecurityOverviewData | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getSecurityOverview"))) {
    return response.tooManyRequests() as ApiResponse<SecurityOverviewData | null>;
  }

  const validationError = validateData(params, GetSecurityOverviewSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<SecurityOverviewData | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<SecurityOverviewData | null>;
  }

  try {
    const CACHE_KEY = generateCacheKey("stat", "security");
    const CACHE_TTL = 5 * 60; // 5分钟缓存（安全数据需要相对实时）

    // 如果不是强制刷新，尝试从缓存获取
    if (!params.force) {
      const cachedData = await getCache<SecurityOverviewData>(CACHE_KEY, {
        ttl: CACHE_TTL,
      });

      if (cachedData) {
        return response.ok({
          data: cachedData,
        }) as ApiResponse<SecurityOverviewData | null>;
      }
    }

    await ensureRedisConnection();

    const currentTime = Date.now();
    const oneMinuteAgo = currentTime - 60000;
    const currentHour = Math.floor(currentTime / 3600000);

    // 获取所有速率限制键（新的 key 格式）
    const rateLimitKeys = await scanKeys("np:rate:ip:*");

    // 获取所有封禁键（新的 key 格式）
    const banKeys = await scanKeys("np:rate:ban:*");

    // 获取全局统计计数器（永久）
    const [totalSuccessStr, totalErrorStr] = await Promise.all([
      redis.get("np:rate:stat:success"),
      redis.get("np:rate:stat:error"),
    ]);
    const totalSuccess = totalSuccessStr ? parseInt(totalSuccessStr, 10) : 0;
    const totalError = totalErrorStr ? parseInt(totalErrorStr, 10) : 0;
    const totalRequests = totalSuccess + totalError;

    // 获取当前小时请求数（成功 + 错误）
    const [currentHourSuccessStr, currentHourErrorStr] = await Promise.all([
      redis.get(`np:rate:stat:hour:${currentHour}:success`),
      redis.get(`np:rate:stat:hour:${currentHour}:error`),
    ]);
    const currentHourRequests =
      (currentHourSuccessStr ? parseInt(currentHourSuccessStr, 10) : 0) +
      (currentHourErrorStr ? parseInt(currentHourErrorStr, 10) : 0);

    // 计算活跃IP和被限流IP（基于最近1分钟的请求）
    let activeIPs = 0;
    let rateLimitedIPs = 0;

    for (const key of rateLimitKeys) {
      const count = await redis.zcount(key, oneMinuteAgo, currentTime);
      if (count > 0) {
        activeIPs++;
        // 达到访客限制即算作受限（至少访客会被限流）
        if (count >= RATE_LIMITS.GUEST) {
          rateLimitedIPs++;
        }
      }
    }

    // 获取最近24小时的统计数据（使用 Pipeline 批量查询）
    let last24hSuccess = 0;
    let last24hError = 0;
    let last24hActiveHours = 0;
    const hourlyTrends: { hour: string; count: number }[] = [];

    {
      const pipeline = redis.pipeline();
      for (let i = 23; i >= 0; i--) {
        const targetHour = currentHour - i;
        pipeline.get(`np:rate:stat:hour:${targetHour}:success`);
        pipeline.get(`np:rate:stat:hour:${targetHour}:error`);
      }
      const results = await pipeline.exec();

      for (let i = 23; i >= 0; i--) {
        const idx = (23 - i) * 2;
        const successStr = results?.[idx]?.[1] as string | null;
        const errorStr = results?.[idx + 1]?.[1] as string | null;
        const success = successStr ? parseInt(successStr, 10) : 0;
        const error = errorStr ? parseInt(errorStr, 10) : 0;

        last24hSuccess += success;
        last24hError += error;

        if (success > 0 || error > 0) {
          last24hActiveHours++;
        }

        const targetHour = currentHour - i;
        const hourTimestamp = targetHour * 3600000;
        const date = new Date(hourTimestamp);
        hourlyTrends.push({
          hour: `${date.getHours().toString().padStart(2, "0")}:00`,
          count: success + error,
        });
      }
    }

    // 获取最近30天的统计数据（使用 Pipeline 批量查询）
    let last30dSuccess = 0;
    let last30dError = 0;
    const activeDaysSet = new Set<number>();

    {
      // 分批执行 Pipeline，每批最多 500 条命令
      const totalHours = 30 * 24;
      const batchSize = 250; // 每批 250 小时 = 500 条命令

      for (
        let batchStart = 0;
        batchStart < totalHours;
        batchStart += batchSize
      ) {
        const batchEnd = Math.min(batchStart + batchSize, totalHours);
        const pipeline = redis.pipeline();

        for (let i = batchStart; i < batchEnd; i++) {
          const targetHour = currentHour - (totalHours - 1 - i);
          pipeline.get(`np:rate:stat:hour:${targetHour}:success`);
          pipeline.get(`np:rate:stat:hour:${targetHour}:error`);
        }

        const results = await pipeline.exec();

        for (let i = 0; i < batchEnd - batchStart; i++) {
          const idx = i * 2;
          const successStr = results?.[idx]?.[1] as string | null;
          const errorStr = results?.[idx + 1]?.[1] as string | null;
          const success = successStr ? parseInt(successStr, 10) : 0;
          const error = errorStr ? parseInt(errorStr, 10) : 0;

          last30dSuccess += success;
          last30dError += error;

          if (success > 0 || error > 0) {
            const globalIdx = batchStart + i;
            const targetHour = currentHour - (totalHours - 1 - globalIdx);
            const dayIndex = Math.floor(targetHour / 24);
            activeDaysSet.add(dayIndex);
          }
        }
      }
    }

    const last30dActiveDays = activeDaysSet.size;

    const resultData: SecurityOverviewData = {
      activeIPs,
      bannedIPs: banKeys.length,
      currentHourRequests,
      hourlyTrends,
      rateLimitedIPs,
      totalRequests,
      totalSuccess,
      totalError,
      last24hSuccess,
      last24hError,
      last24hActiveHours,
      last30dSuccess,
      last30dError,
      last30dActiveDays,
      cache: false,
      updatedAt: new Date().toISOString(),
    };

    // 写入缓存
    const { after } = await import("next/server");
    after(async () => {
      await setCache(
        CACHE_KEY,
        { ...resultData, cache: true },
        { ttl: CACHE_TTL },
      );
    });

    return response.ok({
      data: resultData,
    }) as ApiResponse<SecurityOverviewData | null>;
  } catch (error) {
    console.error("获取安全概览失败:", error);
    return response.serverError({
      message: "获取安全概览失败",
    }) as ApiResponse<SecurityOverviewData | null>;
  }
}

/**
 * 获取IP列表
 */
type IPListResponse = {
  items: IPInfo[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function getIPList(
  params: GetIPList,
): Promise<ApiResponse<IPListResponse | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getIPList"))) {
    return response.tooManyRequests() as ApiResponse<IPListResponse | null>;
  }

  const validationError = validateData(params, GetIPListSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<IPListResponse | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<IPListResponse | null>;
  }

  try {
    await ensureRedisConnection();

    const {
      page = 1,
      pageSize = 20,
      filter = "all",
      sortBy = "requestCount",
      sortOrder = "desc",
      search,
    } = params;

    const currentTime = Date.now();
    const oneMinuteAgo = currentTime - 60000;

    // 使用新的 key 格式
    const [rateLimitKeys, banKeys] = await Promise.all([
      scanKeys("np:rate:ip:*"),
      scanKeys("np:rate:ban:*"),
    ]);

    // 创建封禁IP映射
    const bannedIPMap = new Map<string, { expiry: number; reason?: string }>();
    for (const key of banKeys) {
      const ip = key.replace("np:rate:ban:", "");
      const [ttl, reason] = await Promise.all([redis.ttl(key), redis.get(key)]);
      bannedIPMap.set(ip, {
        expiry: ttl > 0 ? currentTime + ttl * 1000 : 0,
        reason: reason || undefined,
      });
    }

    // 构建IP信息列表
    const allIPs: IPInfo[] = [];

    const oneDayAgo = currentTime - 24 * 60 * 60 * 1000;

    for (const key of rateLimitKeys) {
      const ip = key.replace("np:rate:ip:", "");
      const [realtimeCount, last24hCount, lastRequestScores] =
        await Promise.all([
          redis.zcount(key, oneMinuteAgo, currentTime),
          redis.zcount(key, oneDayAgo, currentTime),
          redis.zrevrange(key, 0, 0, "WITHSCORES"),
        ]);

      const lastRequest =
        lastRequestScores.length >= 2
          ? parseInt(lastRequestScores[1] as string, 10)
          : 0;
      const banInfo = bannedIPMap.get(ip);
      const locationInfo = resolveIpLocation(ip);

      allIPs.push({
        ip,
        requestCount: realtimeCount, // 兼容旧字段
        realtimeCount,
        last24hCount,
        lastRequest,
        isBanned: !!banInfo,
        banExpiry: banInfo?.expiry,
        banReason: banInfo?.reason,
        country: locationInfo?.country ?? undefined,
        province: locationInfo?.region ?? undefined,
        city: locationInfo?.city ?? undefined,
      });
    }

    // 添加只有封禁记录的IP
    for (const [ip, banInfo] of bannedIPMap) {
      if (!allIPs.find((item) => item.ip === ip)) {
        const locationInfo = resolveIpLocation(ip);
        allIPs.push({
          ip,
          requestCount: 0,
          realtimeCount: 0,
          last24hCount: 0,
          lastRequest: 0,
          isBanned: true,
          banExpiry: banInfo.expiry,
          banReason: banInfo.reason,
          country: locationInfo?.country ?? undefined,
          province: locationInfo?.region ?? undefined,
          city: locationInfo?.city ?? undefined,
        });
      }
    }

    // 筛选
    let filteredIPs = allIPs;
    if (filter === "banned") {
      filteredIPs = allIPs.filter((item) => item.isBanned);
    } else if (filter === "rate-limited") {
      // 达到访客限制即算作受限
      filteredIPs = allIPs.filter(
        (item) => item.requestCount >= RATE_LIMITS.GUEST,
      );
    } else if (filter === "active") {
      filteredIPs = allIPs.filter((item) => item.requestCount > 0);
    }

    if (search) {
      filteredIPs = filteredIPs.filter((item) => item.ip.includes(search));
    }

    // 排序
    filteredIPs.sort((a, b) => {
      let comparison = 0;
      if (sortBy === "ip") {
        comparison = a.ip.localeCompare(b.ip);
      } else if (sortBy === "requestCount" || sortBy === "realtimeCount") {
        comparison =
          (a.realtimeCount ?? a.requestCount) -
          (b.realtimeCount ?? b.requestCount);
      } else if (sortBy === "last24hCount") {
        comparison = (a.last24hCount ?? 0) - (b.last24hCount ?? 0);
      } else if (sortBy === "lastRequest") {
        comparison = a.lastRequest - b.lastRequest;
      }
      return sortOrder === "desc" ? -comparison : comparison;
    });

    // 分页
    const total = filteredIPs.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIndex = (page - 1) * pageSize;
    const items = filteredIPs.slice(startIndex, startIndex + pageSize);

    return response.ok({
      data: { items, total, page, pageSize, totalPages },
    }) as ApiResponse<IPListResponse | null>;
  } catch (error) {
    console.error("获取IP列表失败:", error);
    return response.serverError({
      message: "获取IP列表失败",
    }) as ApiResponse<IPListResponse | null>;
  }
}

/**
 * 封禁IP
 */
type BanIPResponse = { ip: string; bannedUntil: number; reason?: string };

export async function banIP(
  params: BanIP,
): Promise<ApiResponse<BanIPResponse | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "banIP"))) {
    return response.tooManyRequests() as ApiResponse<BanIPResponse | null>;
  }

  const validationError = validateData(params, BanIPSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<BanIPResponse | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<BanIPResponse | null>;
  }

  try {
    await ensureRedisConnection();

    const { ip, duration = 3600, reason } = params;
    // 使用新的 key 格式
    const banKey = `np:rate:ban:${ip}`;
    const bannedUntil = Date.now() + duration * 1000;

    await redis.set(banKey, reason || "管理员手动封禁", "EX", duration);

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "SECURITY_IP",
          resourceId: ip,
          value: {
            old: { banned: false },
            new: {
              banned: true,
              bannedUntil,
              duration,
              reason: reason || "管理员手动封禁",
            },
          },
          description: `管理员封禁 IP：${ip}`,
          metadata: {
            duration,
            hasReason: Boolean(reason),
          },
        },
      });
    } catch (error) {
      console.error("记录审计日志失败:", error);
    }

    return response.ok({
      data: { ip, bannedUntil, reason },
    }) as ApiResponse<BanIPResponse | null>;
  } catch (error) {
    console.error("封禁IP失败:", error);
    return response.serverError({
      message: "封禁IP失败",
    }) as ApiResponse<BanIPResponse | null>;
  }
}

/**
 * 解封IP
 */
type UnbanIPResponse = { ip: string; unbanned: boolean };

export async function unbanIP(
  params: UnbanIP,
): Promise<ApiResponse<UnbanIPResponse | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "unbanIP"))) {
    return response.tooManyRequests() as ApiResponse<UnbanIPResponse | null>;
  }

  const validationError = validateData(params, UnbanIPSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<UnbanIPResponse | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<UnbanIPResponse | null>;
  }

  try {
    await ensureRedisConnection();

    const { ip } = params;
    // 使用新的 key 格式
    const banKey = `np:rate:ban:${ip}`;
    const deleted = await redis.del(banKey);

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "SECURITY_IP",
          resourceId: ip,
          value: {
            old: { banned: true },
            new: { banned: false, unbanned: deleted > 0 },
          },
          description: `管理员解封 IP：${ip}`,
          metadata: {
            unbanned: deleted > 0,
          },
        },
      });
    } catch (error) {
      console.error("记录审计日志失败:", error);
    }

    return response.ok({
      data: { ip, unbanned: deleted > 0 },
    }) as ApiResponse<UnbanIPResponse | null>;
  } catch (error) {
    console.error("解封IP失败:", error);
    return response.serverError({
      message: "解封IP失败",
    }) as ApiResponse<UnbanIPResponse | null>;
  }
}

/**
 * 清除IP的速率限制记录
 */
type ClearRateLimitResponse = { ip: string; cleared: boolean };

export async function clearRateLimit(
  params: ClearRateLimit,
): Promise<ApiResponse<ClearRateLimitResponse | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "clearRateLimit"))) {
    return response.tooManyRequests() as ApiResponse<ClearRateLimitResponse | null>;
  }

  const validationError = validateData(params, ClearRateLimitSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<ClearRateLimitResponse | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<ClearRateLimitResponse | null>;
  }

  try {
    await ensureRedisConnection();

    const { ip } = params;
    // 使用新的 key 格式
    const key = `np:rate:ip:${ip}`;
    const deleted = await redis.del(key);

    try {
      await logAuditEvent({
        user: {
          uid: user.uid.toString(),
        },
        details: {
          action: "UPDATE",
          resourceType: "RATE_LIMIT",
          resourceId: ip,
          value: {
            old: { rateLimitCleared: false },
            new: { rateLimitCleared: deleted > 0 },
          },
          description: `管理员清除 IP 限流记录：${ip}`,
          metadata: {
            cleared: deleted > 0,
          },
        },
      });
    } catch (error) {
      console.error("记录审计日志失败:", error);
    }

    return response.ok({
      data: { ip, cleared: deleted > 0 },
    }) as ApiResponse<ClearRateLimitResponse | null>;
  } catch (error) {
    console.error("清除速率限制失败:", error);
    return response.serverError({
      message: "清除速率限制失败",
    }) as ApiResponse<ClearRateLimitResponse | null>;
  }
}

/**
 * 获取API端点统计
 * 使用24小时滑动窗口统计
 */
type EndpointStatsResponse = {
  endpoints: EndpointStat[];
  totalRequests: number;
  timeRange: { start: number; end: number };
};

export async function getEndpointStats(
  params: GetEndpointStats,
): Promise<ApiResponse<EndpointStatsResponse | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getEndpointStats"))) {
    return response.tooManyRequests() as ApiResponse<EndpointStatsResponse | null>;
  }

  const validationError = validateData(params, GetEndpointStatsSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as ApiResponse<EndpointStatsResponse | null>;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<EndpointStatsResponse | null>;
  }

  try {
    await ensureRedisConnection();

    const { hours = 24 } = params;
    const currentTime = Date.now();
    const startTime = currentTime - hours * 3600000;

    // 从 np:rate:endpoint ZSET 中获取所有在时间范围内的记录
    // 值格式:
    // 1. 旧版: apiName:timestamp
    // 2. 新版: apiName:timestamp:random
    // 分数: timestamp
    const allRecords = await redis.zrangebyscore(
      "np:rate:endpoint",
      startTime,
      currentTime,
    );

    // 统计每个端点的调用次数
    const endpointCounts = new Map<string, number>();

    for (const record of allRecords) {
      const segments = record.split(":");
      if (segments.length === 0) {
        continue;
      }

      const lastSegment = segments[segments.length - 1];
      const secondLastSegment = segments[segments.length - 2];
      const isNumeric = (value: string | undefined) =>
        !!value && /^\d+$/.test(value);

      let endpoint: string;
      // 新版格式: apiName:timestamp:random
      if (
        segments.length >= 3 &&
        isNumeric(secondLastSegment) &&
        isNumeric(lastSegment)
      ) {
        endpoint = segments.slice(0, -2).join(":");
      } else if (segments.length >= 2 && isNumeric(lastSegment)) {
        // 旧版格式: apiName:timestamp
        endpoint = segments.slice(0, -1).join(":");
      } else {
        // 兼容异常历史数据，避免直接丢弃
        endpoint = record;
      }

      if (!endpoint) {
        continue;
      }

      endpointCounts.set(endpoint, (endpointCounts.get(endpoint) || 0) + 1);
    }

    let totalRequests = 0;
    for (const count of endpointCounts.values()) {
      totalRequests += count;
    }

    const endpoints: EndpointStat[] = Array.from(endpointCounts.entries())
      .map(([endpoint, count]) => ({
        endpoint,
        count,
        percentage: totalRequests > 0 ? (count / totalRequests) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return response.ok({
      data: {
        endpoints,
        totalRequests,
        timeRange: {
          start: startTime,
          end: currentTime,
        },
      },
    }) as ApiResponse<EndpointStatsResponse | null>;
  } catch (error) {
    console.error("获取端点统计失败:", error);
    return response.serverError({
      message: "获取端点统计失败",
    }) as ApiResponse<EndpointStatsResponse | null>;
  }
}

/**
 * 获取请求趋势
 */
export async function getRequestTrends(
  params: GetRequestTrends,
): Promise<ApiResponse<RequestTrendItem[] | null>> {
  const response = new ResponseBuilder("serveraction");

  if (!(await limitControl(await headers(), "getRequestTrends"))) {
    return response.tooManyRequests() as ApiResponse<RequestTrendItem[] | null>;
  }

  const validationError = validateData(params, GetRequestTrendsSchema);
  if (validationError)
    return response.badRequest(validationError) as ApiResponse<
      RequestTrendItem[] | null
    >;

  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as ApiResponse<RequestTrendItem[] | null>;
  }

  try {
    await ensureRedisConnection();

    const { hours = 24, granularity = "hour" } = params;
    const currentTime = Date.now();
    const currentHour = Math.floor(currentTime / 3600000);
    const trends: RequestTrendItem[] = [];

    if (granularity === "hour") {
      // 使用 Pipeline 批量获取小时统计数据
      const pipeline = redis.pipeline();
      for (let i = hours - 1; i >= 0; i--) {
        const targetHour = currentHour - i;
        pipeline.get(`np:rate:stat:hour:${targetHour}:success`);
        pipeline.get(`np:rate:stat:hour:${targetHour}:error`);
      }
      const results = await pipeline.exec();

      for (let i = hours - 1; i >= 0; i--) {
        const idx = (hours - 1 - i) * 2;
        const successStr = results?.[idx]?.[1] as string | null;
        const errorStr = results?.[idx + 1]?.[1] as string | null;
        const success = successStr ? parseInt(successStr, 10) : 0;
        const error = errorStr ? parseInt(errorStr, 10) : 0;
        const count = success + error;

        const targetHour = currentHour - i;
        const hourTimestamp = targetHour * 3600000;
        const date = new Date(hourTimestamp);
        trends.push({
          time: date.toISOString(),
          timestamp: hourTimestamp,
          count,
          success,
          error,
        });
      }
    } else {
      // 分钟级别统计使用 np:rate:ip:* 数据（保留24小时）
      const rateLimitKeys = await scanKeys("np:rate:ip:*");
      const effectiveMinutes = Math.min(hours * 60, 60);

      for (let i = effectiveMinutes - 1; i >= 0; i--) {
        const minuteTimestamp =
          Math.floor(currentTime / 60000) * 60000 - i * 60000;
        const minuteStart = minuteTimestamp;
        const minuteEnd = minuteTimestamp + 60000;

        let count = 0;
        for (const key of rateLimitKeys) {
          const keyCount = await redis.zcount(key, minuteStart, minuteEnd);
          count += keyCount;
        }

        const date = new Date(minuteTimestamp);
        trends.push({
          time: date.toISOString(), // 返回完整 ISO 8601 时间戳
          timestamp: minuteTimestamp,
          count,
        });
      }
    }

    return response.ok({
      data: trends,
    }) as ApiResponse<RequestTrendItem[] | null>;
  } catch (error) {
    console.error("获取请求趋势失败:", error);
    return response.serverError({
      message: "获取请求趋势失败",
    }) as ApiResponse<RequestTrendItem[] | null>;
  }
}
