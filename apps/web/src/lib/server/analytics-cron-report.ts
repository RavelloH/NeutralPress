import "server-only";

import type { CronTriggerType } from "@repo/shared-types/api/cron";

import AnalyticsDigestEmail, {
  type AnalyticsDigestTopItem,
  type AnalyticsDigestTrend,
} from "@/emails/templates/AnalyticsDigestEmail";
import { renderEmail } from "@/emails/utils";
import type { FlushEventsResult } from "@/lib/server/analytics-flush";
import { getConfigs } from "@/lib/server/config-cache";
import { sendEmail } from "@/lib/server/email";
import { sendNotice } from "@/lib/server/notice";
import prisma from "@/lib/server/prisma";

type AnalyticsReportMode = "NONE" | "NOTICE" | "EMAIL" | "NOTICE_EMAIL";
type AnalyticsReportCycle = "daily" | "weekly" | "monthly";

type Recipient = {
  uid: number;
  username: string;
  nickname: string | null;
  email: string;
  emailVerified: boolean;
};

type Range = {
  start: string;
  endExclusive: string;
};

type RangeStats = {
  totalViews: number;
  uniqueVisitors: number;
  topPaths: AnalyticsDigestTopItem[];
  topReferers: AnalyticsDigestTopItem[];
};

export type AnalyticsReportCycleResult = {
  cycle: AnalyticsReportCycle;
  periodLabel: string;
  noticeSent: number;
  emailSent: number;
  errorCount: number;
};

export type AnalyticsReportDispatchResult = {
  mode: AnalyticsReportMode;
  timezone: string;
  recipientCount: number;
  cycleResults: AnalyticsReportCycleResult[];
  noticeSent: number;
  emailSent: number;
  errors: string[];
};

function toInt(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getCurrentLocalDate(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((item) => item.type === "year")?.value;
    const month = parts.find((item) => item.type === "month")?.value;
    const day = parts.find((item) => item.type === "day")?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (error) {
    console.error("Analytics report: timezone parse failed", error);
  }

  return new Date().toISOString().slice(0, 10);
}

function localDateToDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addLocalDays(date: string, days: number): string {
  const base = localDateToDate(date);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function getWeekday(date: string): number {
  return localDateToDate(date).getUTCDay();
}

function getMonthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function getPrevMonthStart(date: string): string {
  const monthStart = localDateToDate(getMonthStart(date));
  monthStart.setUTCMonth(monthStart.getUTCMonth() - 1);
  return monthStart.toISOString().slice(0, 10);
}

function getCycleRange(cycle: AnalyticsReportCycle, today: string): Range {
  if (cycle === "daily") {
    return {
      start: addLocalDays(today, -1),
      endExclusive: today,
    };
  }

  if (cycle === "weekly") {
    const weekday = getWeekday(today);
    const daysSinceMonday = (weekday + 6) % 7;
    const weekStart = addLocalDays(today, -daysSinceMonday);
    return {
      start: addLocalDays(weekStart, -7),
      endExclusive: weekStart,
    };
  }

  const monthStart = getMonthStart(today);
  return {
    start: getPrevMonthStart(today),
    endExclusive: monthStart,
  };
}

function getPreviousRange(cycle: AnalyticsReportCycle, current: Range): Range {
  if (cycle === "monthly") {
    const prevStart = getPrevMonthStart(current.start);
    return {
      start: prevStart,
      endExclusive: current.start,
    };
  }

  const days =
    Math.max(
      1,
      Math.round(
        (localDateToDate(current.endExclusive).getTime() -
          localDateToDate(current.start).getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    ) || 1;
  return {
    start: addLocalDays(current.start, -days),
    endExclusive: current.start,
  };
}

function formatCycleLabel(cycle: AnalyticsReportCycle): string {
  if (cycle === "daily") return "日报";
  if (cycle === "weekly") return "周报";
  return "月报";
}

function formatPeriodLabel(range: Range): string {
  const endDate = addLocalDays(range.endExclusive, -1);
  if (range.start === endDate) {
    return range.start;
  }
  return `${range.start} ~ ${endDate}`;
}

function normalizeUidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedup = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized) continue;
    if (!/^\d+$/.test(normalized)) continue;
    dedup.add(normalized);
  }

  return Array.from(dedup);
}

function normalizeReportMode(value: unknown): AnalyticsReportMode {
  if (
    value === "NONE" ||
    value === "NOTICE" ||
    value === "EMAIL" ||
    value === "NOTICE_EMAIL"
  ) {
    return value;
  }
  return "NONE";
}

function normalizeReferer(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized === "未知" ||
    normalized === "unknown" ||
    normalized === "null" ||
    normalized === "direct"
  ) {
    return "直接访问";
  }

  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return normalized;
  }
}

function toTopItems(
  entries: Iterable<[string, number]>,
  limit: number,
): AnalyticsDigestTopItem[] {
  return Array.from(entries)
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function parseArchivePathStats(value: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }

  for (const [path, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const viewsRaw = (raw as { views?: unknown }).views;
    const views = toInt(viewsRaw);
    if (views <= 0) continue;

    map.set(path, (map.get(path) || 0) + views);
  }

  return map;
}

function parseArchiveRefererStats(value: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return map;
  }

  for (const [rawReferer, rawCount] of Object.entries(value)) {
    const count = toInt(rawCount);
    if (count <= 0) continue;
    const referer = normalizeReferer(rawReferer);
    map.set(referer, (map.get(referer) || 0) + count);
  }

  return map;
}

async function collectRangeStats(
  range: Range,
  timezone: string,
  includeTop: boolean,
): Promise<RangeStats> {
  const startTs = `${range.start} 00:00:00`;
  const endTs = `${range.endExclusive} 00:00:00`;

  const rawTotalRows = await prisma.$queryRaw<
    Array<{ total_views: bigint; unique_visitors: bigint }>
  >`
    SELECT
      COUNT(*)::bigint AS total_views,
      COUNT(DISTINCT "visitorId")::bigint AS unique_visitors
    FROM "PageView"
    WHERE "timestamp" >= ((${startTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
      AND "timestamp" < ((${endTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
      AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
  `;

  const archiveRows = await prisma.pageViewArchive.findMany({
    where: {
      date: {
        gte: localDateToDate(range.start),
        lt: localDateToDate(range.endExclusive),
      },
    },
    select: {
      totalViews: true,
      uniqueVisitors: true,
      pathStats: true,
      refererStats: true,
    },
  });

  const rawTotal = rawTotalRows[0];
  const totalViews =
    toInt(rawTotal?.total_views) +
    archiveRows.reduce((sum, row) => sum + row.totalViews, 0);
  const uniqueVisitors =
    toInt(rawTotal?.unique_visitors) +
    archiveRows.reduce((sum, row) => sum + row.uniqueVisitors, 0);

  if (!includeTop) {
    return {
      totalViews,
      uniqueVisitors,
      topPaths: [],
      topReferers: [],
    };
  }

  const [rawPaths, rawReferers] = await Promise.all([
    prisma.$queryRaw<Array<{ path: string; count: bigint }>>`
      SELECT "path", COUNT(*)::bigint AS count
      FROM "PageView"
      WHERE "timestamp" >= ((${startTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND "timestamp" < ((${endTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      GROUP BY "path"
    `,
    prisma.$queryRaw<Array<{ referer: string | null; count: bigint }>>`
      SELECT "referer", COUNT(*)::bigint AS count
      FROM "PageView"
      WHERE "timestamp" >= ((${startTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND "timestamp" < ((${endTs}::timestamp AT TIME ZONE ${timezone}) AT TIME ZONE 'UTC')
        AND ("deviceType" IS NULL OR "deviceType" <> 'bot')
      GROUP BY "referer"
    `,
  ]);

  const pathMap = new Map<string, number>();
  for (const row of rawPaths) {
    const path = row.path || "/";
    const count = toInt(row.count);
    if (count <= 0) continue;
    pathMap.set(path, (pathMap.get(path) || 0) + count);
  }
  for (const row of archiveRows) {
    const archivePathMap = parseArchivePathStats(row.pathStats);
    for (const [path, count] of archivePathMap.entries()) {
      pathMap.set(path, (pathMap.get(path) || 0) + count);
    }
  }

  const refererMap = new Map<string, number>();
  for (const row of rawReferers) {
    const normalized = normalizeReferer(row.referer || "直接访问");
    const count = toInt(row.count);
    if (count <= 0) continue;
    refererMap.set(normalized, (refererMap.get(normalized) || 0) + count);
  }
  for (const row of archiveRows) {
    const archiveRefererMap = parseArchiveRefererStats(row.refererStats);
    for (const [referer, count] of archiveRefererMap.entries()) {
      refererMap.set(referer, (refererMap.get(referer) || 0) + count);
    }
  }

  return {
    totalViews,
    uniqueVisitors,
    topPaths: toTopItems(pathMap.entries(), 5),
    topReferers: toTopItems(refererMap.entries(), 5),
  };
}

function createTrend(current: number, previous: number): AnalyticsDigestTrend {
  if (previous <= 0) {
    if (current <= 0) {
      return {
        symbol: "■",
        text: "较上一周期持平（0）",
        color: "flat",
      };
    }
    return {
      symbol: "▲",
      text: `较上一周期增加 ${current}`,
      color: "up",
    };
  }

  const delta = current - previous;
  if (delta === 0) {
    return {
      symbol: "■",
      text: "较上一周期持平（0.0%）",
      color: "flat",
    };
  }

  const ratio = (Math.abs(delta) / previous) * 100;
  const symbol: AnalyticsDigestTrend["symbol"] = delta > 0 ? "▲" : "▼";
  return {
    symbol,
    text: `较上一周期${delta > 0 ? "上升" : "下降"} ${ratio.toFixed(1)}%`,
    color: delta > 0 ? "up" : "down",
  };
}

function buildFlushSummaryLines(result: FlushEventsResult): string[] {
  return [
    `刷写入库：${result.flushedCount} 条`,
    `访问量缓存同步：${result.syncedViewCountRows} 条`,
    `归档日期组：${result.archivedDateGroups} 组`,
    `归档后删除原始访问记录：${result.archivedRawPageViewDeleted} 条`,
    `清理过期归档：${result.expiredArchiveDeleted} 条`,
  ];
}

function formatGeneratedAtLabel(timezone: string): string {
  try {
    return new Date().toLocaleString("zh-CN", {
      timeZone: timezone,
      hour12: false,
    });
  } catch {
    return new Date().toISOString();
  }
}

function buildNoticeContent(input: {
  periodLabel: string;
  timezone: string;
  current: RangeStats;
  totalViewsTrend: AnalyticsDigestTrend;
  uniqueVisitorsTrend: AnalyticsDigestTrend;
  flushSummaryLines: string[];
}): string {
  const topPathText =
    input.current.topPaths.length > 0
      ? input.current.topPaths
          .map((item) => `${item.name}(${item.count})`)
          .join("，")
      : "暂无";
  const topRefererText =
    input.current.topReferers.length > 0
      ? input.current.topReferers
          .map((item) => `${item.name}(${item.count})`)
          .join("，")
      : "暂无";

  const flushSummaryText = input.flushSummaryLines.join("；");

  return [
    `统计区间：${input.periodLabel} (${input.timezone})`,
    "",
    `总浏览量：${input.current.totalViews}（${input.totalViewsTrend.symbol} ${input.totalViewsTrend.text}）`,
    `独立访客：${input.current.uniqueVisitors}（${input.uniqueVisitorsTrend.symbol} ${input.uniqueVisitorsTrend.text}）`,
    "",
    `热门页面：${topPathText}`,
    "",
    `来源统计：${topRefererText}`,
    "",
    `整理结果：${flushSummaryText}`,
  ].join("\n");
}

async function resolveRecipients(notifyUids: string[]): Promise<Recipient[]> {
  const parsedUids = notifyUids
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0);

  if (parsedUids.length > 0) {
    return prisma.user.findMany({
      where: {
        uid: {
          in: parsedUids,
        },
        deletedAt: null,
      },
      select: {
        uid: true,
        username: true,
        nickname: true,
        email: true,
        emailVerified: true,
      },
    });
  }

  return prisma.user.findMany({
    where: {
      role: {
        in: ["ADMIN", "EDITOR"],
      },
      deletedAt: null,
    },
    select: {
      uid: true,
      username: true,
      nickname: true,
      email: true,
      emailVerified: true,
    },
  });
}

function shouldRunCycle(
  cycle: AnalyticsReportCycle,
  today: string,
  enabledMap: Record<AnalyticsReportCycle, boolean>,
): boolean {
  if (!enabledMap[cycle]) return false;
  if (cycle === "daily") return true;
  if (cycle === "weekly") return getWeekday(today) === 1;
  return today.endsWith("-01");
}

export async function dispatchAnalyticsCronReports(params: {
  triggerType: CronTriggerType;
  flushResult: FlushEventsResult;
}): Promise<AnalyticsReportDispatchResult> {
  const [
    modeRaw,
    dailyEnabled,
    weeklyEnabled,
    monthlyEnabled,
    notifyAdminUidRaw,
    timezoneRaw,
    siteTitleRaw,
    siteUrlRaw,
  ] = await getConfigs([
    "cron.task.analytics.report.mode",
    "cron.task.analytics.report.daily.enable",
    "cron.task.analytics.report.weekly.enable",
    "cron.task.analytics.report.monthly.enable",
    "cron.task.analytics.report.notifyAdmin.uid",
    "analytics.timezone",
    "site.title",
    "site.url",
  ]);

  const mode = normalizeReportMode(modeRaw);
  const timezone =
    typeof timezoneRaw === "string" && timezoneRaw.trim().length > 0
      ? timezoneRaw.trim()
      : "UTC";
  const today = getCurrentLocalDate(timezone);
  const notifyUids = normalizeUidList(notifyAdminUidRaw);
  const siteTitle =
    typeof siteTitleRaw === "string" && siteTitleRaw.trim().length > 0
      ? siteTitleRaw.trim()
      : "NeutralPress";
  const siteUrl =
    typeof siteUrlRaw === "string" && siteUrlRaw.trim().length > 0
      ? siteUrlRaw.trim().replace(/\/+$/, "")
      : "";
  const reportLink = siteUrl ? `${siteUrl}/admin/analytics` : undefined;

  const result: AnalyticsReportDispatchResult = {
    mode,
    timezone,
    recipientCount: 0,
    cycleResults: [],
    noticeSent: 0,
    emailSent: 0,
    errors: [],
  };

  if (mode === "NONE") {
    return result;
  }

  const enabledMap: Record<AnalyticsReportCycle, boolean> = {
    daily: Boolean(dailyEnabled),
    weekly: Boolean(weeklyEnabled),
    monthly: Boolean(monthlyEnabled),
  };
  const dueCycles = (
    ["daily", "weekly", "monthly"] as AnalyticsReportCycle[]
  ).filter((cycle) => shouldRunCycle(cycle, today, enabledMap));

  if (dueCycles.length === 0) {
    return result;
  }

  const recipients = await resolveRecipients(notifyUids);
  result.recipientCount = recipients.length;
  if (recipients.length === 0) {
    result.errors.push("访问统计报告未发送：未找到可用管理员接收人");
    return result;
  }

  const flushSummaryLines = buildFlushSummaryLines(params.flushResult);

  for (const cycle of dueCycles) {
    const range = getCycleRange(cycle, today);
    const previousRange = getPreviousRange(cycle, range);
    const periodLabel = formatPeriodLabel(range);

    const [currentStats, previousStats] = await Promise.all([
      collectRangeStats(range, timezone, true),
      collectRangeStats(previousRange, timezone, false),
    ]);
    const totalViewsTrend = createTrend(
      currentStats.totalViews,
      previousStats.totalViews,
    );
    const uniqueVisitorsTrend = createTrend(
      currentStats.uniqueVisitors,
      previousStats.uniqueVisitors,
    );

    const title = `访问统计整理${formatCycleLabel(cycle)}（${periodLabel}）`;
    const content = buildNoticeContent({
      periodLabel,
      timezone,
      current: currentStats,
      totalViewsTrend,
      uniqueVisitorsTrend,
      flushSummaryLines,
    });

    let cycleNoticeSent = 0;
    let cycleEmailSent = 0;
    let cycleErrorCount = 0;

    const sendNoticeChannel = mode === "NOTICE" || mode === "NOTICE_EMAIL";
    const sendEmailChannel = mode === "EMAIL" || mode === "NOTICE_EMAIL";

    if (sendNoticeChannel) {
      await Promise.all(
        recipients.map(async (recipient) => {
          try {
            await sendNotice(recipient.uid, title, content, reportLink, {
              skipEmail: true,
            });
            cycleNoticeSent += 1;
          } catch (error) {
            cycleErrorCount += 1;
            result.errors.push(
              `发送通知失败(uid=${recipient.uid}, cycle=${cycle}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }

    if (sendEmailChannel) {
      await Promise.all(
        recipients.map(async (recipient) => {
          if (!recipient.email || !recipient.emailVerified) {
            return;
          }

          try {
            const component = AnalyticsDigestEmail({
              username: recipient.nickname || recipient.username,
              title,
              periodLabel,
              timezone,
              generatedAtLabel: formatGeneratedAtLabel(timezone),
              totalViews: currentStats.totalViews,
              uniqueVisitors: currentStats.uniqueVisitors,
              totalViewsTrend,
              uniqueVisitorsTrend,
              flushSummaryLines,
              topPaths: currentStats.topPaths,
              topReferers: currentStats.topReferers,
              siteName: siteTitle,
              siteUrl: siteUrl || undefined,
            });
            const { html, text } = await renderEmail(component);

            const emailResult = await sendEmail({
              to: recipient.email,
              subject: title,
              html,
              text,
            });

            if (emailResult.success) {
              cycleEmailSent += 1;
            } else {
              cycleErrorCount += 1;
              result.errors.push(
                `发送邮件失败(uid=${recipient.uid}, cycle=${cycle}): ${emailResult.error || "unknown error"}`,
              );
            }
          } catch (error) {
            cycleErrorCount += 1;
            result.errors.push(
              `发送邮件失败(uid=${recipient.uid}, cycle=${cycle}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }),
      );
    }

    result.noticeSent += cycleNoticeSent;
    result.emailSent += cycleEmailSent;
    result.cycleResults.push({
      cycle,
      periodLabel,
      noticeSent: cycleNoticeSent,
      emailSent: cycleEmailSent,
      errorCount: cycleErrorCount,
    });
  }

  return result;
}
