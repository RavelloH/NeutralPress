"use server";

import type {
  AnalyticsStatsData,
  ApiResponse,
  ApiResponseData,
  DailyPathTrend,
  DailyTrend,
  GetAnalyticsStats,
  GetAnalyticsStatsResponse,
  GetPageViews,
  GetPageViewsResponse,
  GetRealTimeStats,
  GetRealTimeStatsResponse,
  PageViewItem,
  PathStat,
  RealTimeDataPoint,
  RealTimeStatsData,
  StatItem,
  TrackPageView,
  TrackPageViewResponse,
} from "@repo/shared-types";
import {
  GetAnalyticsStatsSchema,
  GetPageViewsSchema,
  GetRealTimeStatsSchema,
  TrackPageViewSchema,
} from "@repo/shared-types";
import { readFileSync } from "fs";
import { headers } from "next/headers";
import type { NextResponse } from "next/server";
import { join } from "path";
import { UAParser } from "ua-parser-js";
import { isAIBot, isBot } from "ua-parser-js/helpers";

import {
  BATCH_SIZE,
  flushEventsToDatabase,
  REDIS_QUEUE_KEY,
  REDIS_VIEW_COUNT_KEY,
  withRetry,
} from "@/lib/server/analytics-flush";
import { authVerify } from "@/lib/server/auth-verify";
import { getClientIP, getClientUserAgent } from "@/lib/server/get-client-info";
import { resolveIpLocation } from "@/lib/server/ip-utils";
import prisma from "@/lib/server/prisma";
import limitControl from "@/lib/server/rate-limit";
import redis from "@/lib/server/redis";
import ResponseBuilder from "@/lib/server/response";
import { validateData } from "@/lib/server/validator";

import type { Prisma } from ".prisma/client";

type ActionEnvironment = "serverless" | "serveraction";
type ActionConfig = { environment?: ActionEnvironment };
type ActionResult<T extends ApiResponseData> =
  | NextResponse<ApiResponse<T>>
  | ApiResponse<T>;

/**
 * Lua 脚本：原子操作写入队列和更新计数器
 * 从独立文件加载
 */
const TRACK_PAGE_VIEW_SCRIPT = readFileSync(
  join(process.cwd(), "src/lib/server/lua-scripts/track-page-view.lua"),
  "utf-8",
);
const ANALYTICS_FLUSH_LOCK_KEY = "np:analytics:flush:lock";
const ANALYTICS_FLUSH_LOCK_TTL_MS = 30_000;
const RELEASE_ANALYTICS_FLUSH_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

async function releaseAnalyticsFlushLock(lockValue: string): Promise<void> {
  try {
    await withRetry(() =>
      redis.eval(
        RELEASE_ANALYTICS_FLUSH_LOCK_SCRIPT,
        1,
        ANALYTICS_FLUSH_LOCK_KEY,
        lockValue,
      ),
    );
  } catch (error) {
    console.error("释放 analytics flush 锁失败:", error);
  }
}

/**
 * 处理和规范化 referer
 * @param referer 原始 referer URL
 * @returns 规范化的 referer（外部域名）或 null（内部来源）
 */
async function normalizeReferer(
  referer: string | null | undefined,
): Promise<string | null> {
  if (!referer || !referer.trim()) {
    return null;
  }

  try {
    const refererUrl = new URL(referer);
    const refererHost = refererUrl.hostname;

    // 过滤本地地址
    if (
      refererHost === "localhost" ||
      refererHost === "127.0.0.1" ||
      refererHost.startsWith("192.168.") ||
      refererHost.startsWith("10.") ||
      refererHost.endsWith(".local")
    ) {
      return null;
    }

    // 获取当前站点的域名（从 headers 中获取）
    const headersList = await headers();
    const host = headersList.get("host");

    if (host) {
      const currentHost = host.split(":")[0]; // 移除端口号

      // 如果是同一域名，视为内部跳转，不记录
      if (refererHost === currentHost) {
        return null;
      }
    }

    // 返回协议 + 域名（不包含路径）
    return `${refererUrl.protocol}//${refererUrl.hostname}`;
  } catch {
    // 如果 URL 解析失败，返回 null
    return null;
  }
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type DateKeyParts = {
  year: number;
  month: number;
  day: number;
};

type ZonedDateTimeInput = DateKeyParts & {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

/**
 * 规范化统计时区配置
 */
function normalizeAnalyticsTimezone(rawTimezone: unknown): string {
  const timezone =
    typeof rawTimezone === "string" && rawTimezone.trim()
      ? rawTimezone.trim()
      : "UTC";

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

/**
 * 解析 YYYY-MM-DD 本地日期键
 */
function parseDateKey(dateKey: string): DateKeyParts | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }

  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * 本地日期加减天数
 */
function addDaysToDateKey(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;

  const base = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * 比较两个本地日期键的天数差（含首尾）
 */
function getInclusiveDayCount(
  startDateKey: string,
  endDateKey: string,
): number {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!start || !end) return 0;

  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.floor((endMs - startMs) / DAY_IN_MS) + 1;
}

/**
 * 获取日期在指定时区下的本地日期键（YYYY-MM-DD）
 */
function getDateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

/**
 * 获取给定 UTC 时间在指定时区下的偏移（毫秒）
 */
function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const utcMs = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    0,
  );
  return asUtcMs - utcMs;
}

/**
 * 指定时区下的本地时间 -> UTC 时间
 */
function zonedDateTimeToUtc(input: ZonedDateTimeInput, timeZone: string): Date {
  const utcGuessMs = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour,
    input.minute,
    input.second,
    input.millisecond,
  );

  let utcDate = new Date(utcGuessMs);
  const firstOffset = getTimezoneOffsetMs(utcDate, timeZone);
  utcDate = new Date(utcGuessMs - firstOffset);

  const secondOffset = getTimezoneOffsetMs(utcDate, timeZone);
  if (secondOffset !== firstOffset) {
    utcDate = new Date(utcGuessMs - secondOffset);
  }

  return utcDate;
}

/**
 * 指定时区下某本地日期的起始 UTC 时间
 */
function getUtcStartOfDateKey(dateKey: string, timeZone: string): Date | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;

  return zonedDateTimeToUtc(
    {
      ...parsed,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );
}

/**
 * 将本地日期键转换为归档表中的日期（UTC 零点）
 */
function dateKeyToArchiveDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * 追踪页面浏览
 */
export async function trackPageView(
  params: TrackPageView,
  serverConfig: { environment: "serverless" },
): Promise<NextResponse<TrackPageViewResponse>>;
export async function trackPageView(
  params: TrackPageView,
  serverConfig?: ActionConfig,
): Promise<TrackPageViewResponse>;
export async function trackPageView(
  params: TrackPageView,
  serverConfig?: ActionConfig,
): Promise<ActionResult<null>> {
  const response = new ResponseBuilder(
    serverConfig?.environment || "serveraction",
  );

  // 限流控制
  if (!(await limitControl(await headers(), "trackPageView"))) {
    return response.tooManyRequests();
  }

  // 参数验证
  const validationError = validateData(params, TrackPageViewSchema);
  if (validationError) return response.badRequest(validationError);

  // 获取服务端信息
  const ipAddress = await getClientIP();
  const userAgent = await getClientUserAgent();

  try {
    const { path, referer, visitorId, screenSize, language, timezone } = params;

    // 解析地理位置
    const location = resolveIpLocation(ipAddress);

    // 解析 User-Agent
    const parser = new UAParser(userAgent);
    const uaResult = parser.getResult();

    const browser = uaResult.browser.name || null;
    const browserVersion = uaResult.browser.version || null;
    const os = uaResult.os.name || null;
    const osVersion = uaResult.os.version || null;
    const isBotVisitor = isBot(uaResult) || isAIBot(uaResult);

    // 判断设备类型（机器人统一标记为 bot）
    let deviceType: string | null = null;
    if (isBotVisitor) {
      deviceType = "bot";
    } else if (uaResult.device.type) {
      deviceType = uaResult.device.type; // mobile, tablet 等
    } else if (uaResult.device.model || uaResult.device.vendor) {
      deviceType = "mobile";
    } else {
      deviceType = "desktop";
    }

    // 规范化 referer（过滤内部来源和本地地址）
    const normalizedReferer = await normalizeReferer(referer);

    // 构建 PageView 数据
    const pageViewData = {
      path,
      timestamp: new Date(), // 记录实际访问时间
      ipAddress,
      userAgent: userAgent !== "unknown" ? userAgent : null,
      referer: normalizedReferer,
      country: location?.country || null,
      region: location?.region || null,
      city: location?.city || null,
      browser,
      browserVersion,
      os,
      osVersion,
      deviceType,
      screenSize: screenSize || null,
      language: language || null,
      timezone: timezone || null,
      visitorId,
    };

    // 使用 Lua 脚本原子操作：写入队列 + 更新计数器
    const queueLength = (await withRetry(() =>
      redis.eval(
        TRACK_PAGE_VIEW_SCRIPT,
        2, // KEYS 数量
        REDIS_QUEUE_KEY, // KEYS[1]
        REDIS_VIEW_COUNT_KEY, // KEYS[2]
        JSON.stringify(pageViewData), // ARGV[1]
        path, // ARGV[2]
      ),
    )) as number;

    // 检查队列长度，是否需要批量写入数据库
    if (queueLength >= BATCH_SIZE) {
      const lockValue = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const flushLockResult = await withRetry(() =>
        redis.set(
          ANALYTICS_FLUSH_LOCK_KEY,
          lockValue,
          "PX",
          ANALYTICS_FLUSH_LOCK_TTL_MS,
          "NX",
        ),
      );

      if (flushLockResult === "OK") {
        try {
          const { after } = await import("next/server");
          // 异步执行批量写入，不阻塞响应
          after(async () => {
            try {
              await flushEventsToDatabase();
            } catch (error) {
              console.error("后台批量写入失败:", error);
            } finally {
              await releaseAnalyticsFlushLock(lockValue);
            }
          });
        } catch (error) {
          await releaseAnalyticsFlushLock(lockValue);
          throw error;
        }
      }
    }

    return response.ok({ message: "追踪成功" });
  } catch (error) {
    console.error("追踪页面浏览失败:", error);
    // 静默失败，不影响用户体验
    return response.ok({ message: "追踪成功" });
  }
}

/**
 * 聚合统计项辅助函数
 */
function aggregateStats(
  records: Array<Record<string, unknown>>,
  field: string,
): StatItem[] {
  const countMap = new Map<string, number>();

  for (const record of records) {
    let value = (record[field] as string | null) || "未知";

    // 统一处理所有表示"未知"的情况
    if (
      !value ||
      value === "unknown" ||
      value === "Unknown" ||
      value === "UNKNOWN" ||
      value.trim() === ""
    ) {
      value = "未知";
    }

    // 特殊处理 referer 字段：将空值显示为"直接访问"
    if (field === "referer" && value === "未知") {
      value = "直接访问";
    }

    // 对 referer 字段进行域名提取（处理历史数据中可能包含路径的情况）
    if (field === "referer" && value !== "未知" && value !== "直接访问") {
      try {
        const url = new URL(value);
        value = `${url.protocol}//${url.hostname}`;
      } catch {
        // 如果解析失败，保持原值
      }
    }

    countMap.set(value, (countMap.get(value) || 0) + 1);
  }

  const total = records.length;
  const items: StatItem[] = Array.from(countMap.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return items;
}

/**
 * 合并归档数据的统计项
 */
function mergeArchivedStats(
  currentStats: StatItem[],
  archivedJsonStats: Record<string, number>,
): StatItem[] {
  const mergedMap = new Map<string, number>();

  // 添加当前统计
  for (const item of currentStats) {
    mergedMap.set(item.name, item.count);
  }

  // 合并归档统计
  for (const [name, count] of Object.entries(archivedJsonStats)) {
    // 统一处理所有表示"未知"的情况
    let normalizedName = name;
    if (
      !name ||
      name === "unknown" ||
      name === "Unknown" ||
      name === "UNKNOWN" ||
      name.trim() === ""
    ) {
      normalizedName = "未知";
    }
    mergedMap.set(normalizedName, (mergedMap.get(normalizedName) || 0) + count);
  }

  // 重新计算百分比
  const total = Array.from(mergedMap.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  const items: StatItem[] = Array.from(mergedMap.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return items;
}

type AnalyticsQueryFilters = {
  search?: string;
  path?: string;
  visitorId?: string;
  country?: string;
  region?: string;
  city?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  referer?: string;
  screenSize?: string;
  language?: string;
  timestampStart?: string;
  timestampEnd?: string;
};

/**
 * 规范化文本筛选值（空串归一为 undefined）
 */
function normalizeFilterText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 解析筛选时间（无效时间返回 null）
 */
function parseFilterDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 是否启用了高级筛选（会影响归档数据是否可用）
 */
function hasAnalyticsFilters(filters: AnalyticsQueryFilters): boolean {
  return Boolean(
    normalizeFilterText(filters.search) ||
      normalizeFilterText(filters.path) ||
      normalizeFilterText(filters.visitorId) ||
      normalizeFilterText(filters.country) ||
      normalizeFilterText(filters.region) ||
      normalizeFilterText(filters.city) ||
      normalizeFilterText(filters.deviceType) ||
      normalizeFilterText(filters.browser) ||
      normalizeFilterText(filters.os) ||
      normalizeFilterText(filters.referer) ||
      normalizeFilterText(filters.screenSize) ||
      normalizeFilterText(filters.language) ||
      normalizeFilterText(filters.timestampStart) ||
      normalizeFilterText(filters.timestampEnd),
  );
}

type UnknownAwareField =
  | "country"
  | "region"
  | "city"
  | "deviceType"
  | "browser"
  | "os"
  | "screenSize"
  | "language";

/**
 * 维度筛选值为“未知”时，需要匹配 null/空串/unknown/未知 等历史值。
 */
function buildUnknownAwareDimensionFilter(
  field: UnknownAwareField,
  value: string,
): Prisma.PageViewWhereInput {
  const isUnknown = value === "未知";

  if (!isUnknown) {
    switch (field) {
      case "country":
        return { country: { contains: value, mode: "insensitive" } };
      case "region":
        return { region: { contains: value, mode: "insensitive" } };
      case "city":
        return { city: { contains: value, mode: "insensitive" } };
      case "deviceType":
        return { deviceType: { contains: value, mode: "insensitive" } };
      case "browser":
        return { browser: { contains: value, mode: "insensitive" } };
      case "os":
        return { os: { contains: value, mode: "insensitive" } };
      case "screenSize":
        return { screenSize: { contains: value, mode: "insensitive" } };
      case "language":
        return { language: { contains: value, mode: "insensitive" } };
      default:
        return {};
    }
  }

  switch (field) {
    case "country":
      return {
        OR: [
          { country: null },
          { country: "" },
          { country: "未知" },
          { country: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "region":
      return {
        OR: [
          { region: null },
          { region: "" },
          { region: "未知" },
          { region: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "city":
      return {
        OR: [
          { city: null },
          { city: "" },
          { city: "未知" },
          { city: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "deviceType":
      return {
        OR: [
          { deviceType: null },
          { deviceType: "" },
          { deviceType: "未知" },
          { deviceType: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "browser":
      return {
        OR: [
          { browser: null },
          { browser: "" },
          { browser: "未知" },
          { browser: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "os":
      return {
        OR: [
          { os: null },
          { os: "" },
          { os: "未知" },
          { os: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "screenSize":
      return {
        OR: [
          { screenSize: null },
          { screenSize: "" },
          { screenSize: "未知" },
          { screenSize: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    case "language":
      return {
        OR: [
          { language: null },
          { language: "" },
          { language: "未知" },
          { language: { equals: "unknown", mode: "insensitive" } },
        ],
      };
    default:
      return {};
  }
}

/**
 * 构建 PageView 查询条件（支持基础时间范围 + 高级筛选）
 */
function buildPageViewWhere(options: {
  baseTimeRange?: Prisma.DateTimeFilter;
  filters?: AnalyticsQueryFilters;
  excludeBots?: boolean;
}): Prisma.PageViewWhereInput {
  const { baseTimeRange, filters, excludeBots = false } = options;
  const conditions: Prisma.PageViewWhereInput[] = [];

  if (baseTimeRange) {
    conditions.push({ timestamp: baseTimeRange });
  }

  if (excludeBots) {
    conditions.push({
      OR: [{ deviceType: { not: "bot" } }, { deviceType: null }],
    });
  }

  const normalizedFilters: AnalyticsQueryFilters = {
    search: normalizeFilterText(filters?.search),
    path: normalizeFilterText(filters?.path),
    visitorId: normalizeFilterText(filters?.visitorId),
    country: normalizeFilterText(filters?.country),
    region: normalizeFilterText(filters?.region),
    city: normalizeFilterText(filters?.city),
    deviceType: normalizeFilterText(filters?.deviceType),
    browser: normalizeFilterText(filters?.browser),
    os: normalizeFilterText(filters?.os),
    referer: normalizeFilterText(filters?.referer),
    screenSize: normalizeFilterText(filters?.screenSize),
    language: normalizeFilterText(filters?.language),
    timestampStart: normalizeFilterText(filters?.timestampStart),
    timestampEnd: normalizeFilterText(filters?.timestampEnd),
  };

  if (normalizedFilters.search) {
    conditions.push({
      OR: [
        { path: { contains: normalizedFilters.search, mode: "insensitive" } },
        {
          visitorId: {
            contains: normalizedFilters.search,
            mode: "insensitive",
          },
        },
        {
          country: {
            contains: normalizedFilters.search,
            mode: "insensitive",
          },
        },
        { city: { contains: normalizedFilters.search, mode: "insensitive" } },
      ],
    });
  }

  if (normalizedFilters.path) {
    conditions.push({ path: normalizedFilters.path });
  }
  if (normalizedFilters.visitorId) {
    conditions.push({ visitorId: normalizedFilters.visitorId });
  }
  if (normalizedFilters.country) {
    conditions.push(
      buildUnknownAwareDimensionFilter("country", normalizedFilters.country),
    );
  }
  if (normalizedFilters.region) {
    conditions.push(
      buildUnknownAwareDimensionFilter("region", normalizedFilters.region),
    );
  }
  if (normalizedFilters.city) {
    conditions.push(
      buildUnknownAwareDimensionFilter("city", normalizedFilters.city),
    );
  }
  if (normalizedFilters.deviceType) {
    conditions.push(
      buildUnknownAwareDimensionFilter(
        "deviceType",
        normalizedFilters.deviceType,
      ),
    );
  }
  if (normalizedFilters.browser) {
    conditions.push(
      buildUnknownAwareDimensionFilter("browser", normalizedFilters.browser),
    );
  }
  if (normalizedFilters.os) {
    conditions.push(
      buildUnknownAwareDimensionFilter("os", normalizedFilters.os),
    );
  }
  if (normalizedFilters.referer) {
    if (normalizedFilters.referer === "直接访问") {
      conditions.push({
        OR: [{ referer: null }, { referer: "" }],
      });
    } else {
      conditions.push({
        referer: { contains: normalizedFilters.referer, mode: "insensitive" },
      });
    }
  }
  if (normalizedFilters.screenSize) {
    conditions.push(
      buildUnknownAwareDimensionFilter(
        "screenSize",
        normalizedFilters.screenSize,
      ),
    );
  }
  if (normalizedFilters.language) {
    conditions.push(
      buildUnknownAwareDimensionFilter("language", normalizedFilters.language),
    );
  }

  const filterStart = parseFilterDate(normalizedFilters.timestampStart);
  const filterEnd = parseFilterDate(normalizedFilters.timestampEnd);
  if (filterStart || filterEnd) {
    const timestampFilter: Prisma.DateTimeFilter = {};
    if (filterStart) timestampFilter.gte = filterStart;
    if (filterEnd) timestampFilter.lte = filterEnd;
    conditions.push({ timestamp: timestampFilter });
  }

  if (conditions.length === 0) {
    return {};
  }
  if (conditions.length === 1) {
    return conditions[0]!;
  }
  return { AND: conditions };
}

/**
 * 获取访问统计数据
 */
export async function getAnalyticsStats(
  params: GetAnalyticsStats,
): Promise<GetAnalyticsStatsResponse> {
  const response = new ResponseBuilder("serveraction");

  // 参数验证
  const validationError = validateData(params, GetAnalyticsStatsSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as unknown as GetAnalyticsStatsResponse;

  // 身份验证 - 仅管理员可访问
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as unknown as GetAnalyticsStatsResponse;
  }

  try {
    // 先同步 Redis 数据到数据库
    await flushEventsToDatabase();

    const {
      days,
      hours,
      startDate: customStartDate,
      endDate: customEndDate,
      search,
      path,
      visitorId,
      country,
      region,
      city,
      deviceType,
      browser,
      os: osFilter,
      referer,
      screenSize,
      language,
      timestampStart,
      timestampEnd,
    } = params;

    const queryFilters: AnalyticsQueryFilters = {
      search,
      path,
      visitorId,
      country,
      region,
      city,
      deviceType,
      browser,
      os: osFilter,
      referer,
      screenSize,
      language,
      timestampStart,
      timestampEnd,
    };
    const hasAdvancedFilters = hasAnalyticsFilters(queryFilters);

    const configs = await prisma.config.findMany({
      where: {
        key: {
          in: ["analytics.timezone", "analytics.precisionDays"],
        },
      },
    });
    const configMap = new Map(
      configs.map((item) => [
        item.key,
        (item.value as { default: unknown }).default,
      ]),
    );

    const analyticsTimezone = normalizeAnalyticsTimezone(
      configMap.get("analytics.timezone"),
    );

    const _precisionDays =
      typeof configMap.get("analytics.precisionDays") === "number"
        ? (configMap.get("analytics.precisionDays") as number)
        : 30;

    let startDate: Date;
    let endDate: Date;
    let calculatedDays: number;
    let isHourlyMode = false; // 是否为小时模式
    let rangeStartDayKey: string;
    let rangeEndDayKey: string;

    // 计算时间范围：
    // - 小时模式：滚动窗口，使用绝对 UTC 时间
    // - 天/自定义模式：按 analytics.timezone 的本地日边界
    const now = new Date();

    if (hours !== undefined) {
      // 使用小时模式（精确的小时范围）
      isHourlyMode = true;
      endDate = new Date(now.getTime());
      startDate = new Date(now.getTime() - hours * 60 * 60 * 1000);

      // 计算涵盖的天数（用于图表显示）
      calculatedDays = hours; // 在小时模式下，用小时数代替天数
      rangeStartDayKey = getDateKeyInTimezone(startDate, analyticsTimezone);
      rangeEndDayKey = getDateKeyInTimezone(endDate, analyticsTimezone);
    } else if (customStartDate && customEndDate) {
      // 使用自定义日期范围
      const startParsed = parseDateKey(customStartDate);
      const endParsed = parseDateKey(customEndDate);
      if (!startParsed || !endParsed) {
        return response.badRequest({
          message: "日期格式无效，请使用 YYYY-MM-DD",
        }) as unknown as GetAnalyticsStatsResponse;
      }

      rangeStartDayKey = customStartDate;
      rangeEndDayKey = customEndDate;

      const startUtc = getUtcStartOfDateKey(
        rangeStartDayKey,
        analyticsTimezone,
      );
      const endExclusiveUtc = getUtcStartOfDateKey(
        addDaysToDateKey(rangeEndDayKey, 1),
        analyticsTimezone,
      );
      if (!startUtc || !endExclusiveUtc) {
        return response.badRequest({
          message: "日期范围计算失败，请检查参数",
        }) as unknown as GetAnalyticsStatsResponse;
      }

      startDate = startUtc;
      endDate = new Date(endExclusiveUtc.getTime() - 1);
      calculatedDays = getInclusiveDayCount(rangeStartDayKey, rangeEndDayKey);
    } else {
      // 使用天数方式
      const dayCount = days || 30;
      calculatedDays = dayCount;

      rangeEndDayKey = getDateKeyInTimezone(now, analyticsTimezone);
      rangeStartDayKey = addDaysToDateKey(rangeEndDayKey, -(dayCount - 1));

      const startUtc = getUtcStartOfDateKey(
        rangeStartDayKey,
        analyticsTimezone,
      );
      const endExclusiveUtc = getUtcStartOfDateKey(
        addDaysToDateKey(rangeEndDayKey, 1),
        analyticsTimezone,
      );
      if (!startUtc || !endExclusiveUtc) {
        return response.serverError() as unknown as GetAnalyticsStatsResponse;
      }

      startDate = startUtc;
      endDate = new Date(endExclusiveUtc.getTime() - 1);
    }

    // 归档数据日期范围：
    // - 天/自定义模式：按本地日边界映射到归档日期键
    // - 小时模式：保留原有 UTC 逻辑（归档为天粒度，只能近似）
    let archiveStartDate: Date;
    let archiveEndDate: Date;
    if (isHourlyMode) {
      archiveStartDate = new Date(startDate);
      archiveEndDate = new Date(endDate.getTime() + DAY_IN_MS);
      archiveEndDate.setUTCHours(0, 0, 0, 0);
    } else {
      archiveStartDate = dateKeyToArchiveDate(rangeStartDayKey);
      archiveEndDate = dateKeyToArchiveDate(
        addDaysToDateKey(rangeEndDayKey, 1),
      );
    }

    // 1. 查询 PageView 数据（精确数据）
    // 注意：PageView 只包含未归档的数据，通常是最近 precisionDays 天的数据
    const pageViewWhere = buildPageViewWhere({
      baseTimeRange: {
        gte: startDate,
        lte: endDate,
      },
      filters: queryFilters,
      excludeBots: true,
    });
    const pageViews = await prisma.pageView.findMany({
      where: pageViewWhere,
      select: {
        path: true,
        timestamp: true,
        visitorId: true,
        referer: true,
        country: true,
        region: true,
        city: true,
        deviceType: true,
        browser: true,
        os: true,
        screenSize: true,
        language: true,
        timezone: true,
      },
    });

    // 2. 如果需要，查询归档数据
    let archivedData: Array<{
      date: Date;
      totalViews: number;
      uniqueVisitors: number;
      totalSessions: number;
      bounces: number;
      totalDuration: number;
      pathStats: Record<string, { views: number; visitors: number }> | null;
      refererStats: Record<string, number> | null;
      countryStats: Record<string, number> | null;
      regionStats: Record<string, number> | null;
      cityStats: Record<string, number> | null;
      deviceStats: Record<string, number> | null;
      browserStats: Record<string, number> | null;
      osStats: Record<string, number> | null;
      screenStats: Record<string, number> | null;
      languageStats: Record<string, number> | null;
      timezoneStats: Record<string, number> | null;
    }> = [];

    // 2. 查询归档数据（仅无高级筛选时启用）
    if (!hasAdvancedFilters) {
      const rawArchived = await prisma.pageViewArchive.findMany({
        where: {
          date: {
            gte: archiveStartDate,
            lt: archiveEndDate, // 使用 lt 而不是 lte
          },
        },
        select: {
          date: true,
          totalViews: true,
          uniqueVisitors: true,
          totalSessions: true,
          bounces: true,
          totalDuration: true,
          pathStats: true,
          refererStats: true,
          countryStats: true,
          regionStats: true,
          cityStats: true,
          deviceStats: true,
          browserStats: true,
          osStats: true,
          screenStats: true,
          languageStats: true,
          timezoneStats: true,
        },
      });
      archivedData = rawArchived.map((item) => ({
        ...item,
        pathStats: item.pathStats as Record<
          string,
          { views: number; visitors: number }
        > | null,
        refererStats: item.refererStats as Record<string, number> | null,
        countryStats: item.countryStats as Record<string, number> | null,
        regionStats: item.regionStats as Record<string, number> | null,
        cityStats: item.cityStats as Record<string, number> | null,
        deviceStats: item.deviceStats as Record<string, number> | null,
        browserStats: item.browserStats as Record<string, number> | null,
        osStats: item.osStats as Record<string, number> | null,
        screenStats: item.screenStats as Record<string, number> | null,
        languageStats: item.languageStats as Record<string, number> | null,
        timezoneStats: item.timezoneStats as Record<string, number> | null,
      }));
    }

    // 3. 计算概览数据
    const totalViewsFromPageView = pageViews.length;
    const totalViewsFromArchive = archivedData.reduce(
      (sum, item) => sum + item.totalViews,
      0,
    );
    const totalViews = totalViewsFromPageView + totalViewsFromArchive;

    const uniqueVisitorsFromPageView = new Set(
      pageViews.map((v) => v.visitorId),
    ).size;
    const uniqueVisitorsFromArchive = archivedData.reduce(
      (sum, item) => sum + item.uniqueVisitors,
      0,
    );
    const uniqueVisitors =
      uniqueVisitorsFromPageView + uniqueVisitorsFromArchive;

    // 今日访问（按 analytics.timezone）
    const todayDayKey = getDateKeyInTimezone(now, analyticsTimezone);
    const todayStartUtc = getUtcStartOfDateKey(todayDayKey, analyticsTimezone);
    const tomorrowStartUtc = getUtcStartOfDateKey(
      addDaysToDateKey(todayDayKey, 1),
      analyticsTimezone,
    );
    let todayViewsFromPageView = 0;
    let todayViewsFromArchive = 0;
    if (todayStartUtc && tomorrowStartUtc) {
      const todayArchiveDate = dateKeyToArchiveDate(todayDayKey);
      const todayPageViewWhere = buildPageViewWhere({
        baseTimeRange: {
          gte: todayStartUtc,
          lt: tomorrowStartUtc,
        },
        filters: queryFilters,
        excludeBots: true,
      });

      const [todayPageViewCount, todayArchive] = await Promise.all([
        prisma.pageView.count({
          where: todayPageViewWhere,
        }),
        hasAdvancedFilters
          ? Promise.resolve(null)
          : prisma.pageViewArchive.findUnique({
              where: { date: todayArchiveDate },
              select: { totalViews: true },
            }),
      ]);

      todayViewsFromPageView = todayPageViewCount;
      todayViewsFromArchive = todayArchive?.totalViews || 0;
    }

    const todayViews = todayViewsFromPageView + todayViewsFromArchive;

    const averageViews =
      calculatedDays > 0 ? Math.round(totalViews / calculatedDays) : 0;

    // 计算会话相关指标（基于 PageView 数据）
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟会话超时

    // 按访客ID分组并排序
    const visitorSessions = new Map<
      string,
      Array<{ path: string; timestamp: Date }>
    >();
    for (const view of pageViews) {
      if (!visitorSessions.has(view.visitorId)) {
        visitorSessions.set(view.visitorId, []);
      }
      visitorSessions.get(view.visitorId)!.push({
        path: view.path,
        timestamp: view.timestamp,
      });
    }

    let pageViewTotalSessions = 0;
    let pageViewBounces = 0; // 单页会话数
    let pageViewTotalDurationMs = 0; // 总停留时长（毫秒）
    let pageViewSessionsWithDuration = 0;

    // 分析每个访客的会话
    for (const views of visitorSessions.values()) {
      if (views.length === 0) continue;

      // 按时间排序
      views.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      let _sessionStart = 0;
      let sessionPageCount = 0;
      let sessionStartTime = views[0]!.timestamp.getTime();

      for (let i = 0; i < views.length; i++) {
        const currentView = views[i]!;
        const currentTime = currentView.timestamp.getTime();

        if (
          i === 0 ||
          currentTime - views[i - 1]!.timestamp.getTime() > SESSION_TIMEOUT
        ) {
          // 新会话开始
          if (i > 0) {
            // 保存上一个会话的统计
            pageViewTotalSessions++;
            if (sessionPageCount === 1) {
              pageViewBounces++;
            }
            if (sessionPageCount > 1) {
              // 计算会话停留时长（从第一个页面到最后一个页面的时间）
              const duration =
                views[i - 1]!.timestamp.getTime() - sessionStartTime;
              pageViewTotalDurationMs += duration;
              pageViewSessionsWithDuration++;
            }
          }
          _sessionStart = i;
          sessionPageCount = 1;
          sessionStartTime = currentTime;
        } else {
          sessionPageCount++;
        }
      }

      // 保存最后一个会话
      pageViewTotalSessions++;
      if (sessionPageCount === 1) {
        pageViewBounces++;
      }
      if (sessionPageCount > 1) {
        const duration =
          views[views.length - 1]!.timestamp.getTime() - sessionStartTime;
        pageViewTotalDurationMs += duration;
        pageViewSessionsWithDuration++;
      }
    }

    // 合并归档数据中的会话指标
    const archivedTotalSessions = archivedData.reduce(
      (sum, item) => sum + item.totalSessions,
      0,
    );
    const archivedBounces = archivedData.reduce(
      (sum, item) => sum + item.bounces,
      0,
    );
    const archivedTotalDurationSeconds = archivedData.reduce(
      (sum, item) => sum + item.totalDuration,
      0,
    );
    const archivedSessionsWithDuration = archivedData.reduce((sum, item) => {
      // 归档数据未单独存 sessionsWithDuration，可由 totalSessions - bounces 推导
      return sum + Math.max(item.totalSessions - item.bounces, 0);
    }, 0);

    const totalSessions = pageViewTotalSessions + archivedTotalSessions;
    const bounces = pageViewBounces + archivedBounces;
    const sessionsWithDuration =
      pageViewSessionsWithDuration + archivedSessionsWithDuration;
    const totalDurationSeconds =
      pageViewTotalDurationMs / 1000 + archivedTotalDurationSeconds;

    const bounceRate = totalSessions > 0 ? (bounces / totalSessions) * 100 : 0;
    const averageDuration =
      sessionsWithDuration > 0
        ? Math.round(totalDurationSeconds / sessionsWithDuration)
        : 0;
    const pageViewsPerSession =
      totalSessions > 0 ? totalViews / totalSessions : 0;

    // 4. 计算每日趋势
    const dayStartIsoCache = new Map<string, string>();
    const getDayStartIsoByDateKey = (dateKey: string): string => {
      const cached = dayStartIsoCache.get(dateKey);
      if (cached) return cached;

      const utcStart = getUtcStartOfDateKey(dateKey, analyticsTimezone);
      const iso = utcStart
        ? utcStart.toISOString()
        : new Date(`${dateKey}T00:00:00.000Z`).toISOString();
      dayStartIsoCache.set(dateKey, iso);
      return iso;
    };

    const getDayStartIsoByDate = (date: Date): string => {
      return getDayStartIsoByDateKey(
        getDateKeyInTimezone(date, analyticsTimezone),
      );
    };

    const dailyTrendMap = new Map<
      string,
      { views: number; visitors: Set<string>; archivedUniqueVisitors: number }
    >();

    if (isHourlyMode) {
      // 小时模式：按小时初始化
      const totalHours = calculatedDays; // 在小时模式下，calculatedDays 实际存储的是小时数
      // 包含当前小时，所以是 <= totalHours
      for (let i = 0; i <= totalHours; i++) {
        const hourDate = new Date(startDate.getTime() + i * 60 * 60 * 1000);
        const hourKey = hourDate.toISOString().substring(0, 13) + ":00:00.000Z"; // YYYY-MM-DDTHH:00:00.000Z 格式
        dailyTrendMap.set(hourKey, {
          views: 0,
          visitors: new Set(),
          archivedUniqueVisitors: 0,
        });
      }
    } else {
      // 天模式：按天初始化
      for (let i = 0; i < calculatedDays; i++) {
        const dateKey = addDaysToDateKey(rangeStartDayKey, i);
        dailyTrendMap.set(getDayStartIsoByDateKey(dateKey), {
          views: 0,
          visitors: new Set(),
          archivedUniqueVisitors: 0,
        });
      }
    }

    // 聚合 PageView 数据
    for (const view of pageViews) {
      let timeKey: string;
      if (isHourlyMode) {
        // 小时精度：取到小时级别
        timeKey = view.timestamp.toISOString().substring(0, 13) + ":00:00.000Z";
      } else {
        // 天精度：取 analytics.timezone 的当天零点
        timeKey = getDayStartIsoByDate(view.timestamp);
      }
      const trend = dailyTrendMap.get(timeKey);
      if (trend) {
        trend.views++;
        trend.visitors.add(view.visitorId);
      }
    }

    // 聚合归档数据（仅在天模式下使用）
    if (!isHourlyMode) {
      for (const archive of archivedData) {
        const archiveDateKey = archive.date.toISOString().slice(0, 10);
        const dateKey = getDayStartIsoByDateKey(archiveDateKey);
        const trend = dailyTrendMap.get(dateKey);
        if (trend) {
          trend.views += archive.totalViews;
          // 注意: 归档数据的 uniqueVisitors 是聚合后的，无法精确累加
          // 这里简化处理，直接加上归档的独立访客数
          trend.archivedUniqueVisitors += archive.uniqueVisitors;
        }
      }
    }

    const dailyTrend: DailyTrend[] = Array.from(dailyTrendMap.entries())
      .map(([date, data]) => ({
        date,
        views: data.views,
        uniqueVisitors: data.visitors.size + data.archivedUniqueVisitors,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 5. 计算热门路径
    const pathCountMap = new Map<string, number>();
    for (const view of pageViews) {
      pathCountMap.set(view.path, (pathCountMap.get(view.path) || 0) + 1);
    }
    // 从归档数据的 pathStats 中提取路径统计
    for (const archive of archivedData) {
      if (archive.pathStats) {
        for (const [path, stats] of Object.entries(archive.pathStats)) {
          pathCountMap.set(path, (pathCountMap.get(path) || 0) + stats.views);
        }
      }
    }

    const totalPathViews = Array.from(pathCountMap.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    const topPaths: PathStat[] = Array.from(pathCountMap.entries())
      .map(([path, count]) => ({
        path,
        count,
        percentage: totalPathViews > 0 ? (count / totalPathViews) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // 5.5. 计算每日路径趋势（用于堆叠柱状图）
    const dailyPathTrendMap = new Map<string, Record<string, number>>();

    // 获取 Top 10 路径用于显示
    const top10PathsSet = new Set(topPaths.slice(0, 10).map((p) => p.path));

    // 初始化所有时间点
    if (isHourlyMode) {
      // 小时模式：按小时初始化
      // 包含当前小时，所以是 <= calculatedDays
      for (let i = 0; i <= calculatedDays; i++) {
        const hourDate = new Date(startDate.getTime() + i * 60 * 60 * 1000);
        const hourKey = hourDate.toISOString().substring(0, 13) + ":00:00.000Z"; // YYYY-MM-DDTHH:00:00.000Z 格式
        dailyPathTrendMap.set(hourKey, {});
      }
    } else {
      // 天模式：按天初始化
      for (let i = 0; i < calculatedDays; i++) {
        const dateKey = addDaysToDateKey(rangeStartDayKey, i);
        dailyPathTrendMap.set(getDayStartIsoByDateKey(dateKey), {});
      }
    }

    // 聚合 PageView 数据
    for (const view of pageViews) {
      if (top10PathsSet.has(view.path)) {
        let timeKey: string;
        if (isHourlyMode) {
          timeKey =
            view.timestamp.toISOString().substring(0, 13) + ":00:00.000Z";
        } else {
          timeKey = getDayStartIsoByDate(view.timestamp);
        }
        const pathViews = dailyPathTrendMap.get(timeKey);
        if (pathViews) {
          pathViews[view.path] = (pathViews[view.path] || 0) + 1;
        }
      }
    }

    // 聚合归档数据（注意：归档数据只有总数，无法按路径分解）
    // 这里简化处理，归档数据不计入路径趋势图

    const dailyPathTrend: DailyPathTrend[] = Array.from(
      dailyPathTrendMap.entries(),
    )
      .map(([date, pathViews]) => ({
        date,
        pathViews,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 6. 聚合多维度统计
    // 从 PageView 聚合
    let countries = aggregateStats(pageViews, "country");
    let regions = aggregateStats(pageViews, "region");
    let cities = aggregateStats(pageViews, "city");
    let devices = aggregateStats(pageViews, "deviceType");
    let browsers = aggregateStats(pageViews, "browser");
    let os = aggregateStats(pageViews, "os");
    let referers = aggregateStats(pageViews, "referer");
    let screenSizes = aggregateStats(pageViews, "screenSize");
    let languages = aggregateStats(pageViews, "language");
    let timezones = aggregateStats(pageViews, "timezone");

    // 合并归档数据
    if (archivedData.length > 0) {
      const mergedCountryStats: Record<string, number> = {};
      const mergedRegionStats: Record<string, number> = {};
      const mergedCityStats: Record<string, number> = {};
      const mergedDeviceStats: Record<string, number> = {};
      const mergedBrowserStats: Record<string, number> = {};
      const mergedOsStats: Record<string, number> = {};
      const mergedRefererStats: Record<string, number> = {};
      const mergedScreenStats: Record<string, number> = {};
      const mergedLanguageStats: Record<string, number> = {};
      const mergedTimezoneStats: Record<string, number> = {};

      for (const archive of archivedData) {
        if (archive.countryStats) {
          for (const [key, value] of Object.entries(archive.countryStats)) {
            mergedCountryStats[key] = (mergedCountryStats[key] || 0) + value;
          }
        }
        if (archive.regionStats) {
          for (const [key, value] of Object.entries(archive.regionStats)) {
            mergedRegionStats[key] = (mergedRegionStats[key] || 0) + value;
          }
        }
        if (archive.cityStats) {
          for (const [key, value] of Object.entries(archive.cityStats)) {
            mergedCityStats[key] = (mergedCityStats[key] || 0) + value;
          }
        }
        if (archive.deviceStats) {
          for (const [key, value] of Object.entries(archive.deviceStats)) {
            mergedDeviceStats[key] = (mergedDeviceStats[key] || 0) + value;
          }
        }
        if (archive.browserStats) {
          for (const [key, value] of Object.entries(archive.browserStats)) {
            mergedBrowserStats[key] = (mergedBrowserStats[key] || 0) + value;
          }
        }
        if (archive.osStats) {
          for (const [key, value] of Object.entries(archive.osStats)) {
            mergedOsStats[key] = (mergedOsStats[key] || 0) + value;
          }
        }
        if (archive.refererStats) {
          for (const [key, value] of Object.entries(archive.refererStats)) {
            let normalizedKey = key;

            // 将空值、"未知"、"null"、"direct" 统一为"直接访问"
            if (
              !key ||
              key === "未知" ||
              key === "unknown" ||
              key === "null" ||
              key === "direct" ||
              key.trim() === ""
            ) {
              normalizedKey = "直接访问";
            } else {
              // 对归档数据中的 referer 也进行域名提取
              try {
                const url = new URL(key);
                normalizedKey = `${url.protocol}//${url.hostname}`;
              } catch {
                // 如果解析失败，保持原值
              }
            }

            mergedRefererStats[normalizedKey] =
              (mergedRefererStats[normalizedKey] || 0) + value;
          }
        }
        if (archive.screenStats) {
          for (const [key, value] of Object.entries(archive.screenStats)) {
            mergedScreenStats[key] = (mergedScreenStats[key] || 0) + value;
          }
        }
        if (archive.languageStats) {
          for (const [key, value] of Object.entries(archive.languageStats)) {
            mergedLanguageStats[key] = (mergedLanguageStats[key] || 0) + value;
          }
        }
        if (archive.timezoneStats) {
          for (const [key, value] of Object.entries(archive.timezoneStats)) {
            mergedTimezoneStats[key] = (mergedTimezoneStats[key] || 0) + value;
          }
        }
      }

      countries = mergeArchivedStats(countries, mergedCountryStats);
      regions = mergeArchivedStats(regions, mergedRegionStats);
      cities = mergeArchivedStats(cities, mergedCityStats);
      devices = mergeArchivedStats(devices, mergedDeviceStats);
      browsers = mergeArchivedStats(browsers, mergedBrowserStats);
      os = mergeArchivedStats(os, mergedOsStats);
      referers = mergeArchivedStats(referers, mergedRefererStats);
      screenSizes = mergeArchivedStats(screenSizes, mergedScreenStats);
      languages = mergeArchivedStats(languages, mergedLanguageStats);
      timezones = mergeArchivedStats(timezones, mergedTimezoneStats);
    }

    const data: AnalyticsStatsData = {
      overview: {
        totalViews,
        uniqueVisitors,
        todayViews,
        averageViews,
        totalSessions,
        averageDuration,
        bounceRate,
        pageViewsPerSession,
      },
      dailyTrend,
      dailyPathTrend,
      topPaths,
      countries,
      regions,
      cities,
      devices,
      browsers,
      os,
      referers,
      screenSizes,
      languages,
      timezones,
    };

    return response.ok({ data }) as unknown as GetAnalyticsStatsResponse;
  } catch (error) {
    console.error("获取访问统计失败:", error);
    return response.serverError() as unknown as GetAnalyticsStatsResponse;
  }
}

/**
 * 获取页面浏览记录（分页）
 */
export async function getPageViews(
  params: GetPageViews,
  config?: ActionConfig,
): Promise<ActionResult<PageViewItem[]>> {
  const response = new ResponseBuilder(config?.environment || "serveraction");

  // 参数验证
  const validationError = validateData(params, GetPageViewsSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as unknown as GetPageViewsResponse;

  // 身份验证 - 仅管理员可访问
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as unknown as GetPageViewsResponse;
  }

  try {
    const {
      page = 1,
      pageSize = 25,
      sortBy,
      sortOrder,
      search,
      path,
      visitorId,
      country,
      region,
      city,
      deviceType,
      browser,
      os,
      referer,
      screenSize,
      language,
      timestampStart,
      timestampEnd,
    } = params;

    // 构建 where 条件
    const where = buildPageViewWhere({
      filters: {
        search,
        path,
        visitorId,
        country,
        region,
        city,
        deviceType,
        browser,
        os,
        referer,
        screenSize,
        language,
        timestampStart,
        timestampEnd,
      },
    });

    // 构建 orderBy
    const orderBy: Record<string, "asc" | "desc"> = {};
    if (sortBy && sortOrder) {
      orderBy[sortBy] = sortOrder;
    } else {
      // 默认按时间倒序
      orderBy.timestamp = "desc";
    }

    // 查询总数
    const total = await prisma.pageView.count({ where });

    // 分页查询
    const pageViews = await prisma.pageView.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        timestamp: true,
        path: true,
        visitorId: true,
        ipAddress: true,
        userAgent: true,
        referer: true,
        country: true,
        region: true,
        city: true,
        deviceType: true,
        browser: true,
        browserVersion: true,
        os: true,
        osVersion: true,
        duration: true,
        screenSize: true,
        language: true,
        timezone: true,
      },
    });

    const totalPages = Math.ceil(total / pageSize);

    return response.ok({
      data: pageViews,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }) as unknown as GetPageViewsResponse;
  } catch (error) {
    console.error("获取页面浏览记录失败:", error);
    return response.serverError() as unknown as GetPageViewsResponse;
  }
}

/**
 * 获取实时访问统计数据（最近N分钟，每分钟一个数据点）
 */
export async function getRealTimeStats(
  params: GetRealTimeStats,
): Promise<GetRealTimeStatsResponse> {
  const response = new ResponseBuilder("serveraction");

  // 参数验证
  const validationError = validateData(params, GetRealTimeStatsSchema);
  if (validationError)
    return response.badRequest(
      validationError,
    ) as unknown as GetRealTimeStatsResponse;

  // 身份验证 - 仅管理员可访问
  const user = await authVerify({
    allowedRoles: ["ADMIN"],
    accessToken: params.access_token,
  });

  if (!user) {
    return response.unauthorized() as unknown as GetRealTimeStatsResponse;
  }

  try {
    // 先同步 Redis 数据到数据库
    await flushEventsToDatabase();

    const {
      minutes = 30,
      search,
      path,
      visitorId,
      country,
      region,
      city,
      deviceType,
      browser,
      os,
      referer,
      screenSize,
      language,
      timestampStart,
      timestampEnd,
    } = params;

    // 计算时间范围
    const now = new Date();
    const startTime = new Date(now.getTime() - minutes * 60 * 1000);

    // 查询 PageView 数据
    const pageViewsWhere = buildPageViewWhere({
      baseTimeRange: {
        gte: startTime,
        lte: now,
      },
      filters: {
        search,
        path,
        visitorId,
        country,
        region,
        city,
        deviceType,
        browser,
        os,
        referer,
        screenSize,
        language,
        timestampStart,
        timestampEnd,
      },
      excludeBots: true,
    });

    const pageViews = await prisma.pageView.findMany({
      where: pageViewsWhere,
      select: {
        timestamp: true,
        visitorId: true,
      },
      orderBy: {
        timestamp: "asc",
      },
    });

    // 按分钟聚合数据
    const minuteMap = new Map<
      string,
      { views: number; visitors: Set<string> }
    >();

    // 初始化所有分钟桶（包含当前分钟）
    for (let i = 0; i <= minutes; i++) {
      const minuteTime = new Date(startTime.getTime() + i * 60 * 1000);
      // 格式化为 YYYY-MM-DDTHH:mm:00.000Z
      const minuteKey = new Date(
        minuteTime.getFullYear(),
        minuteTime.getMonth(),
        minuteTime.getDate(),
        minuteTime.getHours(),
        minuteTime.getMinutes(),
        0,
        0,
      ).toISOString();
      minuteMap.set(minuteKey, { views: 0, visitors: new Set() });
    }

    // 聚合数据
    let totalViews = 0;
    const allVisitors = new Set<string>();

    for (const view of pageViews) {
      // 将时间戳舍入到分钟
      const minuteTime = new Date(
        view.timestamp.getFullYear(),
        view.timestamp.getMonth(),
        view.timestamp.getDate(),
        view.timestamp.getHours(),
        view.timestamp.getMinutes(),
        0,
        0,
      );
      const minuteKey = minuteTime.toISOString();

      const bucket = minuteMap.get(minuteKey);
      if (bucket) {
        bucket.views++;
        bucket.visitors.add(view.visitorId);
        totalViews++;
        allVisitors.add(view.visitorId);
      }
    }

    // 转换为数组
    const dataPoints: RealTimeDataPoint[] = Array.from(minuteMap.entries())
      .map(([time, data]) => ({
        time,
        views: data.views,
        visitors: data.visitors.size,
      }))
      .sort((a, b) => a.time.localeCompare(b.time));

    const data: RealTimeStatsData = {
      dataPoints,
      totalViews,
      uniqueVisitors: allVisitors.size,
    };

    return response.ok({ data }) as unknown as GetRealTimeStatsResponse;
  } catch (error) {
    console.error("获取实时访问统计失败:", error);
    return response.serverError() as unknown as GetRealTimeStatsResponse;
  }
}

/**
 * 批量获取页面访问量（纯 Redis，无需认证，但有速率限制）
 */
export async function batchGetViewCounts(
  paths: string[],
): Promise<Array<{ path: string; count: number }>> {
  // 速率限制，防止匿名客户端滥用
  if (!(await limitControl(await headers(), "batchGetViewCounts"))) {
    throw new Error("请求过于频繁，请稍后再试");
  }

  try {
    // 参数验证：最多 20 个路径
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20) {
      throw new Error("路径列表必须包含 1-20 个元素");
    }

    // 从 Redis Hash 批量获取
    const counts = await redis.hmget(REDIS_VIEW_COUNT_KEY, ...paths);

    // 构建返回结果
    const result = paths.map((path, index) => ({
      path,
      count: parseInt(counts[index] || "0", 10),
    }));

    return result;
  } catch (error) {
    console.error("批量获取访问量失败:", error);
    throw error;
  }
}
